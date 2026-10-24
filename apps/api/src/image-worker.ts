import { resourceProfiles } from "./challenge-model.js";
import { DockerEngine, type PullEvent } from "./docker.js";
import type { DB, Row } from "./db.js";
import { validateImage } from "./resources.js";
import {
  imageReference,
  imageKey,
  cleanDockerMessage,
} from "./image-reference.js";

type Layer = { id: string; status: string; current: number; total: number };
export class ImageWorker {
  private active?: Promise<void>;
  private controller?: AbortController;
  private initialized = false;
  private lastSync = 0;
  constructor(
    private db: DB,
    private docker = new DockerEngine(),
  ) {}
  async sync() {
    try {
      const images = await this.docker.listImages();
      const challenges = await this.db.query(
        "SELECT * FROM challenges WHERE image<>'' OR resources IS NOT NULL OR patch_config IS NOT NULL",
      );
      const tracked = await this.db.query("SELECT image FROM docker_images");
      const local = new Map<string, { image_id: string; size: number }>();
      const wanted = new Set(tracked.map((r) => r.image as string));
      for (const image of images)
        for (const ref of [
          ...(image.RepoTags ?? []),
          ...(image.RepoDigests ?? []),
        ]) {
          if (!imageReference.safeParse(ref).success) continue;
          local.set(imageKey(ref), { image_id: image.Id, size: image.Size });
          try {
            validateImage(ref);
            wanted.add(imageKey(ref));
          } catch {}
        }
      const refs = new Map<string, { id: string; title: string }[]>();
      for (const c of challenges) {
        const profiles = resourceProfiles(c);
        for (const image of new Set(
          [
            profiles.container?.image,
            profiles.attachment?.image,
            c.patch_config?.checker_image,
            c.awd_config?.checker_image,
          ].filter(Boolean),
        )) {
          const key = imageKey(image);
          wanted.add(key);
          refs.set(key, [
            ...(refs.get(key) ?? []),
            { id: c.id, title: c.title },
          ]);
        }
      }
      const rows = [...wanted].map((image) => ({
        image,
        present: local.has(image),
        image_id: local.get(image)?.image_id ?? null,
        size: local.get(image)?.size ?? null,
        challenges: refs.get(image) ?? [],
      }));
      await this.db.transaction(async (tx) => {
        if (rows.length)
          await tx.query(
            `INSERT INTO docker_images(image,present,image_id,size,challenges,checked_at)
          SELECT image,present,image_id,size,challenges,now() FROM jsonb_to_recordset($1::jsonb) AS x(image text,present boolean,image_id text,size bigint,challenges jsonb)
          ON CONFLICT(image) DO UPDATE SET present=excluded.present,image_id=excluded.image_id,size=excluded.size,challenges=excluded.challenges,checked_at=now()`,
            [JSON.stringify(rows)],
          );
        await tx.query(
          "INSERT INTO docker_worker_status(id,checked_at,error) VALUES(1,now(),NULL) ON CONFLICT(id) DO UPDATE SET checked_at=now(),error=NULL",
        );
      });
      this.lastSync = Date.now();
    } catch (error) {
      await this.db.query(
        "INSERT INTO docker_worker_status(id,error) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET error=$1",
        [cleanDockerMessage((error as Error).message)],
      );
      throw error;
    }
  }
  async tick() {
    if (!this.initialized) {
      await this.db.query(
        "UPDATE docker_image_pulls SET status='failed',error='Worker 已重启，请重新拉取',finished_at=now(),updated_at=now() WHERE status='pulling'",
      );
      this.initialized = true;
    }
    if (Date.now() - this.lastSync > 10000) await this.sync();
    if (this.active) return;
    const job = await this.db.transaction(async (tx) => {
      // A failed progress write can outlive its in-memory task. The elected
      // scheduler has no active pull here, so these rows can safely be retried.
      await tx.query(
        "UPDATE docker_image_pulls SET status='failed',error='拉取任务中断，请重试',finished_at=now(),updated_at=now() WHERE status='pulling'",
      );
      const [row] = await tx.query(
        "SELECT * FROM docker_image_pulls WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (row)
        await tx.query(
          "UPDATE docker_image_pulls SET status='pulling',updated_at=now() WHERE id=$1",
          [row.id],
        );
      return row;
    });
    if (!job) return;
    this.controller = new AbortController();
    this.active = this.pull(job, this.controller.signal)
      .catch((error) =>
        console.error(
          "image pull persistence failed",
          cleanDockerMessage((error as Error).message),
        ),
      )
      .finally(() => {
        this.active = undefined;
        this.controller = undefined;
      });
  }
  private async pull(job: Row, signal: AbortSignal) {
    const layers = new Map<string, Layer>();
    const logs: { time: string; message: string }[] = [];
    const log = (message: string) => {
      logs.push({
        time: new Date().toISOString(),
        message: cleanDockerMessage(message),
      });
      if (logs.length > 200) logs.shift();
    };
    let dirty = false,
      pending: Promise<void> | undefined;
    const flush = async () => {
      if (pending) await pending;
      if (!dirty) return;
      dirty = false;
      pending = this.db
        .query(
          "UPDATE docker_image_pulls SET layers=$2,logs=$3,updated_at=now() WHERE id=$1 AND status='pulling'",
          [job.id, JSON.stringify([...layers.values()]), JSON.stringify(logs)],
        )
        .then(() => {});
      try {
        await pending;
      } finally {
        pending = undefined;
      }
    };
    const timer = setInterval(() => {
      void flush().catch((error) => {
        console.error(
          "image progress persistence failed",
          (error as Error).message,
        );
        this.controller?.abort();
      });
    }, 1000);
    timer.unref();
    try {
      imageReference.parse(job.reference);
      validateImage(job.reference);
      log(`开始拉取 ${job.reference}`);
      dirty = true;
      await this.docker.pullImage(
        job.reference,
        (event: PullEvent) => {
          const status = cleanDockerMessage(event.status),
            id = cleanDockerMessage(event.id).slice(0, 100);
          if (id) {
            const previous = layers.get(id);
            if (!previous && layers.size >= 256) return;
            const number = (n: unknown) =>
              typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
            layers.set(id, {
              id,
              status,
              current: number(event.progressDetail?.current),
              total: number(event.progressDetail?.total),
            });
            if (previous?.status !== status) log(`${id}: ${status}`);
          } else if (status) log(status);
          dirty = true;
        },
        signal,
      );
      await this.docker.inspectImage(job.reference);
      await this.sync();
      log("镜像已就绪");
      dirty = true;
      await flush();
      await this.db.query(
        "UPDATE docker_image_pulls SET status='succeeded',finished_at=now(),updated_at=now() WHERE id=$1",
        [job.id],
      );
    } catch (error) {
      const message = signal.aborted
        ? "拉取已中断，请重试"
        : cleanDockerMessage((error as Error).message);
      log(message);
      dirty = true;
      await flush();
      await this.db.query(
        "UPDATE docker_image_pulls SET status='failed',error=$2,finished_at=now(),updated_at=now() WHERE id=$1",
        [job.id, message],
      );
    } finally {
      clearInterval(timer);
    }
  }
  async stop() {
    this.controller?.abort();
    await this.active;
  }
}
