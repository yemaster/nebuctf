import { mkdir, chmod, readdir, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { resourceUsage } from "./resource-usage.js";
import { lock } from "./db.js";
import type { DB, Row } from "./db.js";
import { DockerEngine, DockerError } from "./docker.js";
import { getSetting } from "./settings.js";

const label = "io.nebuctf.capture",
  MiB = 1048576;
const absent = (e: unknown) => e instanceof DockerError && e.statusCode === 404;
export const captureFilename = /^[0-9]{13}-[0-9a-f-]{36}\.pcap$/;
export async function sampleTraffic(
  db: DB,
  docker: DockerEngine,
  iid: string,
  now = new Date(),
  spec?: { topology?: { services: { name: string }[] } },
) {
  const names = [
    `nebuctf-${iid}`,
    ...(spec?.topology?.services ?? []).map(
      (service) => `nebuctf-${iid}-${service.name}`,
    ),
  ];
  const stats = await Promise.all(
    names.map((name) => docker.containerStats(name)),
  );
  const networks = stats.flatMap((entry) =>
    Object.values(entry.networks ?? {}),
  );
  if (!networks.length) return;
  const rx = networks.reduce((n, v) => n + v.rx_bytes, 0),
    tx = networks.reduce((n, v) => n + v.tx_bytes, 0);
  if (![rx, tx].every((n) => Number.isSafeInteger(n) && n >= 0)) return;
  await db.transaction(async (db) => {
    await db.query(
      "INSERT INTO instance_traffic(instance_id) VALUES($1) ON CONFLICT DO NOTHING",
      [iid],
    );
    const [old] = await db.query(
      "SELECT * FROM instance_traffic WHERE instance_id=$1 FOR UPDATE",
      [iid],
    );
    if (old!.sampled_at && new Date(old!.sampled_at).getTime() >= now.getTime())
      return;
    const seconds = old!.sampled_at
      ? Math.max(
          1,
          (now.getTime() - new Date(old!.sampled_at).getTime()) / 1000,
        )
      : 0;
    // Counters can reset after Docker restarts; keep accumulated totals monotonic.
    const received =
      rx >= Number(old!.last_rx) ? rx - Number(old!.last_rx) : rx;
    const sent = tx >= Number(old!.last_tx) ? tx - Number(old!.last_tx) : tx;
    await db.query(
      "UPDATE instance_traffic SET rx_bytes=rx_bytes+$2,tx_bytes=tx_bytes+$3,last_rx=$4,last_tx=$5,rx_rate=$6,tx_rate=$7,sampled_at=$8 WHERE instance_id=$1",
      [
        iid,
        received,
        sent,
        rx,
        tx,
        seconds ? received / seconds : 0,
        seconds ? sent / seconds : 0,
        now,
      ],
    );
    if (seconds)
      await db.query(
        "INSERT INTO traffic_samples(instance_id,bucket,rx_bytes,tx_bytes) VALUES($1,date_trunc('minute',$2::timestamptz),$3,$4) ON CONFLICT(instance_id,bucket) DO UPDATE SET rx_bytes=traffic_samples.rx_bytes+excluded.rx_bytes,tx_bytes=traffic_samples.tx_bytes+excluded.tx_bytes",
        [iid, now, received, sent],
      );
  });
}
export async function indexCaptureFiles(db: DB, iid: string) {
  let names: string[];
  try {
    names = await readdir(join(config.TRAFFIC_DIR, iid));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const files = names
    .filter((name) => captureFilename.test(name))
    .slice(0, 256);
  const records: {
    id: string;
    instance_id: string;
    name: string;
    size: number;
    created_at: string;
  }[] = [];
  for (const name of files) {
    try {
      const stat = await lstat(join(config.TRAFFIC_DIR, iid, name));
      if (!stat.isFile() || stat.size < 24 || stat.size > 5 * MiB) continue;
      records.push({
        id: crypto.randomUUID(),
        instance_id: iid,
        name,
        size: stat.size,
        created_at: new Date(Number(name.slice(0, 13))).toISOString(),
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  if (records.length)
    await db.query(
      "INSERT INTO traffic_files(id,instance_id,name,size,created_at) SELECT id,instance_id,name,size,created_at FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,instance_id uuid,name text,size bigint,created_at timestamptz) ON CONFLICT(instance_id,name) DO NOTHING",
      [JSON.stringify(records)],
    );
  await db.query(
    "DELETE FROM traffic_files WHERE instance_id=$1 AND name<>ALL($2::text[])",
    [iid, files],
  );
}
export async function stopCapture(db: DB, docker: DockerEngine, iid: string) {
  const name = `nebuctf-capture-${iid}`;
  try {
    const info = await docker.inspectContainer(name);
    if (info.Config.Labels[label] !== iid)
      throw Error("capture ownership mismatch");
    if (info.State.Running) await docker.stopContainer(name);
    await docker.removeContainer(name);
  } catch (e) {
    if (!absent(e)) throw e;
  }
  await indexCaptureFiles(db, iid);
  await db.query(
    "UPDATE instance_traffic SET capture_status='stopped',capture_reserved=0 WHERE instance_id=$1",
    [iid],
  );
}
export async function finishTraffic(db: DB, docker: DockerEngine, iid: string) {
  const [row] = await db.query(
    "SELECT instance_id FROM instance_traffic WHERE instance_id=$1",
    [iid],
  );
  if (!row) return;
  await sampleTraffic(db, docker, iid).catch(() => {});
  await stopCapture(db, docker, iid);
}
export class TrafficWorker {
  private job: Promise<void> | undefined;
  private next = 0;
  constructor(
    private db: DB,
    private docker = new DockerEngine(),
  ) {}
  tick() {
    if (this.job || Date.now() < this.next) return;
    this.next = Date.now() + 10000;
    this.job = this.cycle()
      .catch((e) => console.error("traffic cycle failed", (e as Error).message))
      .finally(() => {
        this.job = undefined;
      });
  }
  async drain() {
    await this.job;
  }
  async cycle() {
    const policy = await getSetting(this.db, "traffic");
    this.next = Date.now() + policy.sample_seconds * 1000;
    const rows = await this.db.query(
      `SELECT i.id,i.container_id,i.spec,c.traffic_mode,t.capture_status,t.capture_config FROM instances i JOIN contests c ON c.id::text=i.scope LEFT JOIN instance_traffic t ON t.instance_id=i.id WHERE i.status='running' AND i.resource_type='container' AND i.owner_key LIKE 't:%' ORDER BY t.sampled_at NULLS FIRST,i.id`,
    );
    const eligible = policy.enabled
      ? rows.filter((i) => i.traffic_mode !== "off")
      : [];
    const desired = new Set(
      eligible
        .filter(
          (i) =>
            i.traffic_mode === "capture" ||
            (i.traffic_mode === "inherit" && policy.capture_enabled),
        )
        .map((i) => i.id),
    );
    const existing = await this.docker.listContainers(label);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Keep existing captures first so sampling order never causes capture churn.
    const existingIds = new Set(existing.map((c) => c.Labels[label]));
    const order = [...desired].sort(
      (a, b) =>
        Number(existingIds.has(b)) - Number(existingIds.has(a)) ||
        a.localeCompare(b),
    );
    const slots = Math.min(
      policy.capture_limit,
      Math.floor(policy.total_mib / policy.instance_mib),
    );
    const selected = new Set(order.slice(0, slots));
    const signature = JSON.stringify([policy.instance_mib, policy.snap_length]);
    for (const c of existing) {
      const iid = c.Labels[label]!;
      if (!/^[0-9a-f-]{36}$/.test(iid ?? "")) continue;
      const row = byId.get(iid);
      if (!selected.has(iid) || row?.capture_config !== signature)
        await stopCapture(this.db, this.docker, iid);
    }
    const samples = eligible.slice(0, 2000);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, samples.length) }, async () => {
        while (cursor < samples.length) {
          const row = samples[cursor++]!;
          await sampleTraffic(
            this.db,
            this.docker,
            row.id,
            new Date(),
            row.spec,
          ).catch(() => {});
        }
      }),
    );
    // Closed files are immutable; the capture process uses bounded rotation and never exposes .part files.
    for (const c of existing)
      if (/^[0-9a-f-]{36}$/.test(c.Labels[label] ?? ""))
        await indexCaptureFiles(this.db, c.Labels[label]!);
    const expired = await this.db.query(
      "SELECT id,instance_id,name FROM traffic_files WHERE created_at<now()-$1::int*interval '1 day' ORDER BY created_at LIMIT 1000",
      [policy.retention_days],
    );
    for (const file of expired) await this.removeFile(file);
    await this.db.query(
      "DELETE FROM traffic_samples WHERE (instance_id,bucket) IN (SELECT instance_id,bucket FROM traffic_samples WHERE bucket<now()-$1::int*interval '1 day' ORDER BY bucket LIMIT 5000)",
      [policy.retention_days],
    );
    // Apply smaller quotas to stored captures too, reclaiming oldest closed files.
    // Partial files are bounded by the reservations below and are never indexed.
    const [stored] = await this.db.query(
      "SELECT coalesce(sum(size),0)::bigint bytes FROM traffic_files",
    );
    let bytes = Number(stored!.bytes);
    if (bytes > policy.total_mib * MiB) {
      const oldest = await this.db.query(
        "SELECT id,instance_id,name,size FROM traffic_files ORDER BY created_at,id LIMIT 4096",
      );
      for (const file of oldest) {
        if (bytes <= policy.total_mib * MiB) break;
        await this.removeFile(file);
        bytes -= Number(file.size);
      }
    }
    const active = await this.docker.listContainers(label);
    const activeIds = new Set<string>();
    for (const container of active) {
      const iid = container.Labels[label]!;
      const info = await this.docker.inspectContainer(container.Id);
      if (selected.has(iid) && info.State.Running) activeIds.add(iid);
      else await stopCapture(this.db, this.docker, iid);
    }
    // Recover reservations after a worker/Docker interruption.
    await this.db.query(
      "UPDATE instance_traffic SET capture_reserved=0,capture_status='stopped' WHERE capture_status IN ('running','starting') AND instance_id<>ALL($1::uuid[])",
      [[...activeIds]],
    );
    const budgetQuery = `SELECT coalesce(sum(greatest(coalesce(f.bytes,0),t.capture_reserved)),0)::bigint used FROM instance_traffic t LEFT JOIN (SELECT instance_id,sum(size) bytes FROM traffic_files GROUP BY instance_id) f USING(instance_id)`;
    for (const iid of [...activeIds].reverse()) {
      const [budget] = await this.db.query(budgetQuery);
      if (Number(budget!.used) <= policy.total_mib * MiB) break;
      await stopCapture(this.db, this.docker, iid);
      activeIds.delete(iid);
    }
    let imageAvailable: boolean | undefined;
    for (const row of eligible) {
      if (!desired.has(row.id)) continue;
      await this.db.query(
        "INSERT INTO instance_traffic(instance_id) VALUES($1) ON CONFLICT DO NOTHING",
        [row.id],
      );
      if (activeIds.has(row.id)) continue;
      if (!selected.has(row.id)) {
        await this.state(row.id, "queued", "采集并发或容量已满");
        continue;
      }
      if (imageAvailable === undefined) {
        try {
          await this.docker.inspectImage(config.TRAFFIC_IMAGE);
          imageAvailable = true;
        } catch {
          imageAvailable = false;
        }
      }
      if (!imageAvailable) {
        await this.state(row.id, "failed", "采集镜像不可用");
        continue;
      }
      // Reserve under the same lock as environment creation; captures count towards CPU/memory.
      const reservation = await this.db.transaction(async (tx) => {
        await lock(tx);
        const [budget] = await tx.query(
          `SELECT coalesce(sum(greatest(coalesce(f.bytes,0),t.capture_reserved)),0)::bigint used FROM instance_traffic t LEFT JOIN (SELECT instance_id,sum(size) bytes FROM traffic_files GROUP BY instance_id) f USING(instance_id)`,
        );
        const [own] = await tx.query(
          "SELECT coalesce(sum(size),0)::bigint bytes FROM traffic_files WHERE instance_id=$1",
          [row.id],
        );
        if (
          Number(budget!.used) -
            Number(own!.bytes) +
            policy.instance_mib * MiB >
          policy.total_mib * MiB
        )
          return "limited";
        const usage = await resourceUsage(tx);
        const containers = await getSetting(tx, "containers");
        if (
          containers.max_instances !== null &&
          usage.n + 1 > containers.max_instances
        )
          return "queued";
        if (
          usage.memory + 64 > config.MAX_MEMORY ||
          usage.cpu + 100 > config.MAX_CPU
        )
          return "queued";
        const [running] = await tx.query(
          "SELECT id FROM instances WHERE id=$1 AND status='running'",
          [row.id],
        );
        if (!running) return "stopped";
        await tx.query(
          "UPDATE instance_traffic SET capture_status='starting',capture_error=NULL,capture_config=$2,capture_reserved=$3 WHERE instance_id=$1",
          [row.id, signature, policy.instance_mib * MiB],
        );
        return "starting";
      });
      if (reservation !== "starting") {
        await this.state(
          row.id,
          reservation,
          reservation === "limited"
            ? "抓包存储已满"
            : reservation === "queued"
              ? "采集资源预算不足"
              : null,
        );
        continue;
      }
      const name = `nebuctf-capture-${row.id}`;
      try {
        await mkdir(join(config.TRAFFIC_DIR, row.id), { recursive: true });
        await chmod(join(config.TRAFFIC_DIR, row.id), 0o777);
        const created = await this.docker.createContainer({
          name,
          Image: config.TRAFFIC_IMAGE,
          Env: [
            `MAX_MIB=${policy.instance_mib}`,
            `SNAP_LENGTH=${policy.snap_length}`,
          ],
          Labels: { [label]: row.id },
          HostConfig: {
            NetworkMode: `container:${row.container_id}`,
            ReadonlyRootfs: true,
            CapDrop: ["ALL"],
            CapAdd: ["NET_RAW", "SETUID", "SETGID", "KILL"],
            SecurityOpt: ["no-new-privileges:true"],
            Memory: 64 * MiB,
            MemorySwap: 64 * MiB,
            NanoCpus: 100000000,
            PidsLimit: 16,
            Mounts: [
              {
                Type: "volume",
                Source: config.TRAFFIC_VOLUME,
                Target: "/capture",
                VolumeOptions: { Subpath: row.id },
              },
            ],
            LogConfig: {
              Type: "json-file",
              Config: { "max-size": "1m", "max-file": "1" },
            },
          },
        });
        await this.docker.startContainer(created.Id);
        activeIds.add(row.id);
        await this.state(row.id, "running", null);
      } catch (e) {
        await stopCapture(this.db, this.docker, row.id).catch(() => {});
        await this.state(
          row.id,
          "failed",
          absent(e) ? "采集镜像未部署" : "采集启动失败",
        );
      }
    }
  }
  private async state(id: string, status: string, error: string | null) {
    await this.db.query(
      "UPDATE instance_traffic SET capture_status=$2,capture_error=$3 WHERE instance_id=$1",
      [id, status, error],
    );
  }
  private async removeFile(file: Row) {
    if (captureFilename.test(file.name))
      await unlink(join(config.TRAFFIC_DIR, file.instance_id, file.name)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        },
      );
    await this.db.query("DELETE FROM traffic_files WHERE id=$1", [file.id]);
  }
}
