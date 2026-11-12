import { notifyContest } from "./activity-events.js";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DockerEngine } from "./docker.js";
import type { DB, Row } from "./db.js";
import { containerConfig } from "./worker.js";
import { flagForInstance } from "./flag-environment.js";
import { validateImage } from "./resources.js";
import { patchStorage } from "./judge.js";
import { readUpdatePackage, patchContext } from "./patch-archive.js";
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
    for (const suffix of ["target", "update", "functional", "defense"]) {
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
    for (const suffix of keepImage ? ["-source"] : ["", "-source"])
      await this.docker
        .removeImage(`nebuctf-patch:${job.id}${suffix}`)
        .catch((e) => {
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
          "UPDATE judge_jobs SET status='failed',error='校验任务中断，请重新提交',result=result || '{\"verdict\":\"error\"}',finished_at=now(),updated_at=now() WHERE id=$1",
          [job.id],
        );
        await notifyContest(this.db, job.scope).catch(() => {});
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
    let keep = false,
      verdict = "error";
    const remaining = (limit = job.spec.patch.timeout) => {
      const ms = new Date(job.deadline_at).getTime() - Date.now();
      if (ms < 1000) throw Error("补丁校验超时，请重新提交");
      return Math.min(limit, Math.floor(ms / 1000));
    };
    try {
      const claimed = await this.db.query(
        'UPDATE judge_jobs SET status=\'building\',result=\'{"verdict":"checking","stage":"building"}\',updated_at=now() WHERE id=$1 AND status=\'queued\' RETURNING id',
        [job.id],
      );
      if (!claimed.length) return;
      await notifyContest(this.db, job.scope).catch(() => {});
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
      const files = readUpdatePackage(
        await readFile(join(patchStorage(), job.patch_id)),
      );
      const source = await this.docker.buildPatch(
        `nebuctf-patch:${job.id}-source`,
        patchContext(info.Id, files),
        { [label]: job.id },
      );
      await this.db.query(
        'UPDATE judge_jobs SET result=result || \'{"stage":"updating"}\',updated_at=now() WHERE id=$1',
        [job.id],
      );
      await notifyContest(this.db, job.scope).catch(() => {});
      const updater = containerConfig({
        id: job.id,
        challenge_id: job.challenge_id,
        kind: "static_container",
        spec: { ...base, image: source, cpu: patch.cpu, memory: patch.memory },
      });
      updater.name = `nebuctf-judge-${job.id}-update`;
      updater.Labels = { [label]: job.id };
      updater.User = "0:0";
      updater.Entrypoint = ["/bin/sh"];
      updater.Cmd = ["-eu", "/.nebuctf-update/update.sh"];
      updater.WorkingDir = patch.patch_root;
      updater.Env = ["PATCH_DIR=/.nebuctf-update"];
      updater.NetworkDisabled = true;
      updater.ExposedPorts = {};
      updater.HostConfig.NetworkMode = "none";
      updater.HostConfig.PortBindings = {};
      updater.HostConfig.ReadonlyRootfs = false;
      const update = await this.docker.createContainer(updater);
      const updateTimeout = remaining(patch.update_timeout ?? 30);
      await this.docker.startContainer(update.Id);
      let updateExit: number;
      try {
        updateExit = (
          await this.docker.waitContainer(update.Id, updateTimeout * 1000)
        ).StatusCode;
      } catch (e) {
        if (
          ["Docker API timeout", "Docker API deadline"].includes(
            (e as Error).message,
          )
        ) {
          verdict = "update_error";
          throw Error("更新脚本执行超时，请检查脚本后重新提交");
        }
        throw e;
      }
      if (updateExit !== 0) {
        verdict = "update_error";
        await this.db.query(
          "UPDATE judge_jobs SET result=result || jsonb_build_object('update_exit_code',$2::int),updated_at=now() WHERE id=$1",
          [job.id, updateExit],
        );
        throw Error(`更新脚本执行失败（退出码 ${updateExit}）`);
      }
      remaining();
      // Restore service startup metadata; never persist the updater's root shell or environment.
      const image = await this.docker.commitPatch(update.Id, job.id, {
        ...info.Config,
        Entrypoint: info.Config?.Entrypoint ?? [],
        Cmd: info.Config?.Cmd ?? [],
        Env: info.Config?.Env ?? [],
        WorkingDir: info.Config?.WorkingDir ?? "",
        User: "65534:65534",
        Labels: { ...info.Config?.Labels, [label]: job.id },
      });
      await this.docker.removeContainer(update.Id);
      await this.db.query(
        "UPDATE judge_jobs SET result=result || '{\"update\":true}',updated_at=now() WHERE id=$1",
        [job.id],
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
      const flag = flagForInstance(
        {
          challenge_id: job.challenge_id,
          scope: job.scope,
          owner_key: job.owner_key,
          spec: job.spec.flag_environment ?? {},
        },
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
        await this.db.query(
          "UPDATE judge_jobs SET result=result || jsonb_build_object('stage',$2::text),updated_at=now() WHERE id=$1",
          [job.id, mode],
        );
        await notifyContest(this.db, job.scope).catch(() => {});
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
        if (result !== 0) {
          verdict =
            result === 1
              ? mode === "functional"
                ? "service_error"
                : "exploit_success"
              : "error";
          throw Error(
            result !== 1
              ? "检查器执行异常，请联系管理员"
              : mode === "functional"
                ? "功能检查未通过，请检查服务是否正常"
                : "安全检查未通过，请继续修复漏洞",
          );
        }
        await this.db.query(
          "UPDATE judge_jobs SET result=result || jsonb_build_object($2::text,true),updated_at=now() WHERE id=$1",
          [job.id, mode],
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
              verdict: "defended",
              stage: "complete",
              update: true,
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
      await notifyContest(this.db, job.scope).catch(() => {});
    } catch (e) {
      const allowed = [
        "补丁校验超时，请重新提交",
        "基础镜像不能包含 ONBUILD 指令",
        "功能检查未通过，请检查服务是否正常",
        "安全检查未通过，请继续修复漏洞",
        "校验环境不可用",
        "检查器执行异常，请联系管理员",
        "比赛中没有此题",
        "当前组别没有此题的作答权限",
        "当前组别没有此题的靶机与附件使用权限",
      ];
      const error =
        verdict === "update_error" || allowed.includes((e as Error).message)
          ? (e as Error).message
          : "补丁构建或校验失败，请检查补丁后重试";
      await this.db.query(
        "UPDATE judge_jobs SET status='failed',error=$2,result=result || jsonb_build_object('verdict',$3::text),finished_at=now(),updated_at=now() WHERE id=$1",
        [job.id, error, verdict],
      );
      await notifyContest(this.db, job.scope).catch(() => {});
    } finally {
      await this.cleanup(job, keep);
      await this.db.query(
        "UPDATE judge_jobs SET cleanup_pending=false WHERE id=$1",
        [job.id],
      );
    }
  }
}
