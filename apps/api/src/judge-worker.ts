import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DockerEngine } from "./docker.js";
import type { DB, Row } from "./db.js";
import { containerConfig } from "./worker.js";
import { dynamicFlag } from "./security.js";
import { validateImage } from "./resources.js";
import { patchStorage } from "./judge.js";
import { readPatch, patchContext } from "./patch-archive.js";
import { creditSolve } from "./solve.js";
import { ownerPermissions, requirePermission } from "./group-permissions.js";

const label = "io.nebuctf.judge";
export async function runChecker(
  docker: DockerEngine,
  options: {
    id: string;
    image: string;
    network: string;
    host: string;
    port: number;
    flag: string;
    mode: string;
    timeout: number;
    cpu?: number;
    memory?: number;
    labels: Record<string, string>;
  },
) {
  validateImage(options.image);
  const config = containerConfig({
    id: options.id,
    challenge_id: "",
    kind: "static_container",
    spec: {
      image: options.image,
      port: 8080,
      cpu: options.cpu ?? 250,
      memory: options.memory ?? 128,
      access_mode: "domain",
      flag_mode: "static",
    },
  });
  config.name = options.id;
  config.Labels = options.labels;
  config.ExposedPorts = {};
  config.HostConfig.PortBindings = {};
  config.HostConfig.NetworkMode = options.network;
  config.Env = [
    `TARGET_HOST=${options.host}`,
    `TARGET_PORT=${options.port}`,
    `EXPECTED_FLAG=${options.flag}`,
    `CHECK_MODE=${options.mode}`,
    `CHECK_TIMEOUT=${Math.max(1, options.timeout - 1)}`,
  ];
  const c = await docker.createContainer(config);
  try {
    await docker.startContainer(c.Id);
    return (await docker.waitContainer(c.Id, options.timeout * 1000))
      .StatusCode;
  } finally {
    await docker.removeContainer(c.Id).catch(() => {});
  }
}
export class JudgeWorker {
  private jobs = new Map<string, Promise<void>>();
  constructor(
    private db: DB,
    private docker = new DockerEngine(),
  ) {}
  async drain() {
    await Promise.allSettled(this.jobs.values());
  }
  private async cleanup(job: Row, keepImage = false) {
    for (const suffix of ["target", "functional", "defense"]) {
      const name = `nebuctf-judge-${job.id}-${suffix}`;
      try {
        const info = await this.docker.inspectContainer(name);
        if (info.Config.Labels?.[label] !== job.id)
          throw Error("judge ownership mismatch");
        await this.docker.removeContainer(name);
      } catch (e) {
        if ((e as any).statusCode !== 404) throw e;
      }
    }
    try {
      const info = await this.docker.inspectNetwork(`nebuctf-judge-${job.id}`);
      if (info.Labels?.[label] !== job.id)
        throw Error("judge network ownership mismatch");
      await this.docker.removeNetwork(info.Id);
    } catch (e) {
      if ((e as any).statusCode !== 404) throw e;
    }
    if (!keepImage)
      await this.docker.removeImage(`nebuctf-patch:${job.id}`).catch((e) => {
        if (![404, 409].includes(e.statusCode)) throw e;
      });
    await unlink(join(patchStorage(), job.patch_id)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  async tick() {
    const leftovers = await this.db.query(
      "SELECT * FROM judge_jobs WHERE cleanup_pending AND status IN ('failed','passed','cancelled') ORDER BY created_at LIMIT 10",
    );
    for (const job of leftovers) {
      await this.cleanup(
        job,
        job.status === "passed" && job.spec.type === "awd",
      );
      await this.db.query(
        "UPDATE judge_jobs SET cleanup_pending=false WHERE id=$1",
        [job.id],
      );
    }
    const interrupted = await this.db.query(
      "SELECT * FROM judge_jobs WHERE status IN ('building','checking')",
    );
    for (const job of interrupted)
      if (!this.jobs.has(job.id)) {
        await this.cleanup(job);
        await this.db.query(
          "UPDATE judge_jobs SET status='failed',error='校验任务中断，请重新提交',finished_at=now(),updated_at=now() WHERE id=$1",
          [job.id],
        );
      }
    const queued = await this.db.query(
      "SELECT * FROM judge_jobs WHERE status='queued' ORDER BY created_at LIMIT $1",
      [Math.max(0, 2 - this.jobs.size)],
    );
    for (const job of queued) {
      if (this.jobs.has(job.id)) continue;
      const work = this.run(job)
        .catch(() => {})
        .finally(() => this.jobs.delete(job.id));
      this.jobs.set(job.id, work);
    }
    const expired = await this.db.query(
      "SELECT j.* FROM judge_jobs j LEFT JOIN contests g ON g.id::text=j.scope WHERE j.status='passed' AND j.spec->>'type'='awd' AND (g.ends_at<now()-interval '10 minutes' OR j.scope='practice') AND j.result->>'image' IS NOT NULL LIMIT 20",
    );
    for (const job of expired) {
      await this.cleanup(job);
      await this.db.query(
        "UPDATE judge_jobs SET result=result-'image' WHERE id=$1",
        [job.id],
      );
    }
  }
  async run(job: Row) {
    let keep = false;
    const remaining = () => {
      const ms = new Date(job.deadline_at).getTime() - Date.now();
      if (ms < 1000) throw Error("补丁校验超时，请重新提交");
      return Math.min(job.spec.patch.timeout, Math.floor(ms / 1000));
    };
    try {
      const claimed = await this.db.query(
        "UPDATE judge_jobs SET status='building',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",
        [job.id],
      );
      if (!claimed.length) return;
      remaining();
      const permissions = await ownerPermissions(
        this.db,
        job.scope,
        job.owner_key,
        job.challenge_id,
      );
      requirePermission(permissions, "view");
      requirePermission(permissions, "submit");
      requirePermission(permissions, "resources");
      const base = job.spec.container,
        patch = job.spec.patch;
      validateImage(base.image);
      validateImage(patch.checker_image);
      const info = (await this.docker.inspectImage(base.image)) as any;
      if (info.Config?.OnBuild?.length)
        throw Error("基础镜像不能包含 ONBUILD 指令");
      const files = readPatch(
        await readFile(join(patchStorage(), job.patch_id)),
      );
      const image = await this.docker.buildPatch(
        `nebuctf-patch:${job.id}`,
        patchContext(info.Id, patch.patch_root, files),
        { [label]: job.id },
      );
      remaining();
      await this.db.query(
        "UPDATE judge_jobs SET status='checking',updated_at=now() WHERE id=$1",
        [job.id],
      );
      const network = `nebuctf-judge-${job.id}`;
      await this.docker.createNetwork({
        Name: network,
        Internal: true,
        Labels: { [label]: job.id },
      });
      const [attack] = await this.db.query(
        "SELECT id FROM challenge_parts WHERE challenge_id=$1 AND role='attack'",
        [job.challenge_id],
      );
      const flag = dynamicFlag(
        job.challenge_id,
        job.scope,
        job.owner_key,
        attack?.id,
      );
      const target = containerConfig({
        id: job.id,
        challenge_id: job.challenge_id,
        scope: job.scope,
        owner_key: job.owner_key,
        kind: "dynamic_container",
        spec: {
          ...base,
          image,
          access_mode: "domain",
          parts: attack ? [attack.id] : [],
          flag_mode: "dynamic",
          ...(job.spec.flag_environment ?? {}),
        },
      });
      target.name = network + "-target";
      target.Labels = { [label]: job.id };
      target.HostConfig.NetworkMode = network;
      target.HostConfig.PortBindings = {};
      target.HostConfig.Tmpfs["/run/nebuctf"] =
        "rw,nosuid,nodev,noexec,size=1m,mode=1777";
      const created = await this.docker.createContainer(target);
      await this.docker.startContainer(created.Id);
      if (job.spec.type === "awd")
        await this.docker.writeFlag(created.Id, flag);
      const inspected = await this.docker.inspectContainer(created.Id),
        host = inspected.NetworkSettings.Networks[network]?.IPAddress;
      if (!host) throw Error("校验环境不可用");
      for (const mode of ["functional", "defense"]) {
        const result = await runChecker(this.docker, {
          id: network + "-" + mode,
          image: patch.checker_image,
          network,
          host,
          port: base.port,
          flag,
          mode,
          timeout: remaining(),
          cpu: patch.cpu,
          memory: patch.memory,
          labels: { [label]: job.id },
        });
        if (result !== 0)
          throw Error(
            mode === "functional"
              ? "功能检查未通过，请检查服务是否正常"
              : "安全检查未通过，请继续修复漏洞",
          );
      }
      remaining();
      await this.db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          JSON.stringify([job.scope, job.challenge_id, job.owner_key]),
        ]);
        const permissions = await ownerPermissions(
          tx,
          job.scope,
          job.owner_key,
          job.challenge_id,
        );
        requirePermission(permissions, "view");
        requirePermission(permissions, "submit");
        requirePermission(permissions, "resources");
        const [challenge] = await tx.query(
          "SELECT * FROM challenges WHERE id=$1",
          [job.challenge_id],
        );
        if (job.spec.type === "awdp") {
          const [defense] = await tx.query(
            "SELECT * FROM challenge_parts WHERE challenge_id=$1 AND role='defense'",
            [job.challenge_id],
          );
          if (!defense) throw Error("防守计分配置缺失");
          await creditSolve(
            tx,
            {
              ...challenge,
              contest_scoring: job.spec.contest_scoring,
              contest_practice: job.spec.contest_practice,
            },
            job.scope,
            job.owner_key,
            job.requested_by,
            defense,
          );
        }
        await tx.query(
          "UPDATE judge_jobs SET status='passed',result=$2,finished_at=now(),updated_at=now() WHERE id=$1",
          [
            job.id,
            JSON.stringify({
              functional: true,
              defense: true,
              ...(job.spec.type === "awd" ? { image } : {}),
            }),
          ],
        );
        if (job.spec.type === "awd")
          await tx.query(
            "UPDATE instances SET status='stopping',updated_at=now() WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND status IN ('queued','starting','running')",
            [job.challenge_id, job.scope, job.owner_key],
          );
      });
      keep = job.spec.type === "awd";
    } catch (e) {
      const allowed = [
        "补丁校验超时，请重新提交",
        "基础镜像不能包含 ONBUILD 指令",
        "功能检查未通过，请检查服务是否正常",
        "安全检查未通过，请继续修复漏洞",
        "校验环境不可用",
        "比赛中没有此题",
        "当前组别没有此题的作答权限",
        "当前组别没有此题的靶机与附件使用权限",
      ];
      const error = allowed.includes((e as Error).message)
        ? (e as Error).message
        : "补丁构建或校验失败，请检查补丁后重试";
      await this.db.query(
        "UPDATE judge_jobs SET status='failed',error=$2,finished_at=now(),updated_at=now() WHERE id=$1",
        [job.id, error],
      );
    } finally {
      await this.cleanup(job, keep);
      await this.db.query(
        "UPDATE judge_jobs SET cleanup_pending=false WHERE id=$1",
        [job.id],
      );
    }
  }
}
