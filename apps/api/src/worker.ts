import { queuePriority, queueReady } from "./resource-queue.js";
import { recordIssuedFlags } from "./contest-monitor.js";
import {
  flagEnvironment,
  serviceFlagEnvironments,
  flagTargets,
} from "./flag-environment.js";
import { finishTraffic } from "./traffic-worker.js";
import { DockerEngine, readArtifact } from "./docker.js";
import {
  cleanupContainerGroup,
  createContainerGroup,
  startContainerGroup,
  reconcileContainerGroup,
  mergeEnvironment,
  type ContainerGroupOptions,
} from "./container-runtime.js";
export { readArtifact } from "./docker.js";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DB, Row } from "./db.js";
import { config } from "./config.js";
import { storage, validateImage } from "./resources.js";
import { cleanDockerMessage } from "./image-reference.js";
import { contestLogicState } from "./contest-logic.js";
import { isContestPractice } from "./contest-practice.js";
const label = "io.nebuctf.instance";
export function containerConfig(i: Row): Record<string, any> {
  const terminal = i.kind === "terminal",
    generator = i.kind === "dynamic_attachment",
    port = `${i.spec.port}/tcp`;
  return {
    name: `nebuctf-${i.id}`,
    Image: i.spec.image,
    User: "65534:65534",
    Env: terminal
      ? ["HOME=/home/player", "TERM=xterm-256color", "LANG=C.UTF-8"]
      : mergeEnvironment(i.spec.environment, flagEnvironment(i, "main")),
    ...(terminal
      ? { Cmd: ["sleep", "infinity"], WorkingDir: "/home/player" }
      : {}),
    ...(!terminal && i.spec.command ? { Cmd: i.spec.command } : {}),
    Labels: { [label]: i.id },
    NetworkDisabled: generator,
    ExposedPorts: generator || terminal ? {} : { [port]: {} },
    HostConfig: {
      NetworkMode: generator ? "none" : `nebuctf-${i.id}`,
      Memory: i.spec.memory * 1024 * 1024,
      MemorySwap: i.spec.memory * 1024 * 1024,
      NanoCpus: i.spec.cpu * 1e6,
      PidsLimit: 128,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      Privileged: false,
      RestartPolicy: { Name: "no" },
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,nodev,size=32m,mode=1777",
        ...(terminal
          ? {
              "/home/player":
                "rw,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=700",
            }
          : {}),
        ...(i.spec.awd && flagTargets(i).includes("main")
          ? { "/run/nebuctf": "rw,noexec,nosuid,nodev,size=1m,mode=1777" }
          : {}),
        ...(generator
          ? { "/output": "rw,noexec,nosuid,nodev,size=24m,mode=1777" }
          : {}),
      },
      PortBindings:
        generator || terminal || i.spec.access_mode === "domain"
          ? {}
          : {
              [port]: [
                {
                  HostIp: config.CHALLENGE_BIND,
                  // Docker reserves one free port atomically within this range.
                  HostPort: config.CHALLENGE_PORT_RANGE,
                },
              ],
            },
      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "1m", "max-file": "2" },
      },
      Ulimits: [{ Name: "nofile", Soft: 1024, Hard: 1024 }],
    },
  };
}
function groupOptions(i: Row): ContainerGroupOptions {
  return {
    namespace: `nebuctf-${i.id}`,
    ownerLabel: label,
    ownerId: i.id,
    primary: containerConfig(i),
    topology: i.kind === "dynamic_attachment" ? undefined : i.spec?.topology,
    flagEnvironments: i.kind === "terminal" ? {} : serviceFlagEnvironments(i),
    flagFiles: i.spec?.awd ? flagTargets(i) : undefined,
    gateway: config.GATEWAY_CONTAINER,
    accessMode: i.spec?.access_mode,
    legacyIcc: Boolean(i.spec?.awd),
    waitForPrimary: i.kind !== "dynamic_attachment",
  };
}
const notFound = (e: unknown) =>
  (e as { statusCode?: number }).statusCode === 404;
export class Worker {
  private jobs = new Map<string, Promise<void>>();
  async drain() {
    await Promise.allSettled(this.jobs.values());
  }
  async ping() {
    await this.docker.ping();
  }
  constructor(
    private db: DB,
    private docker: DockerEngine = new DockerEngine(),
  ) {}
  async cleanup(i: Row) {
    if (
      i.scope !== "practice" &&
      i.scope !== "test" &&
      i.owner_key?.startsWith("t:") &&
      i.resource_type === "container"
    )
      await finishTraffic(this.db, this.docker, i.id);
    await cleanupContainerGroup(this.docker, {
      namespace: `nebuctf-${i.id}`,
      ownerLabel: label,
      ownerId: i.id,
      gateway: config.GATEWAY_CONTAINER,
      topology: i.spec?.topology,
    });
    for (const filename of [i.id, `${i.id}.tmp`])
      await unlink(join(storage(), filename)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        },
      );
  }
  async start(i: Row) {
    try {
      await this.provision(i);
    } catch (error) {
      try {
        await this.cleanup(i);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "instance creation and cleanup failed",
        );
      }
      throw error;
    }
  }
  private async requireContestLogic(i: Row) {
    if (
      i.scope === "practice" ||
      i.scope === "test" ||
      !i.challenge_id ||
      !i.owner_key?.startsWith("t:")
    )
      return;
    const [contest] = await this.db.query(
      "SELECT practice_mode,ends_at FROM contests WHERE id=$1",
      [i.scope],
    );
    if (isContestPractice(contest)) return;
    const state = await contestLogicState(this.db, i.scope, i.owner_key);
    if (!state.has(i.challenge_id) || state.get(i.challenge_id) === null)
      throw Error("赛题尚未解锁或已选择其他互斥题目");
  }
  private async provision(i: Row) {
    await this.requireContestLogic(i);
    if (i.spec.patch_job_id) {
      const [patch] = await this.db.query(
        "SELECT id FROM judge_jobs WHERE id=$1 AND status='passed' AND scope=$2 AND owner_key=$3 AND challenge_id=$4 AND result->>'image'=$5",
        [
          i.spec.patch_job_id,
          i.scope,
          i.owner_key,
          i.challenge_id,
          i.spec.image,
        ],
      );
      if (!patch) throw Error("补丁镜像校验记录无效");
    } else validateImage(i.spec.image);
    const name = `nebuctf-${i.id}`;
    const options = groupOptions(i);
    await createContainerGroup(this.docker, options);
    // Creation can be slow; recheck before starting, without touching running instances.
    await this.requireContestLogic(i);
    let info = await startContainerGroup(this.docker, options);
    if (i.kind === "dynamic_attachment") {
      const deadline = Date.now() + 60000;
      let archive: Buffer | undefined;
      while (Date.now() < deadline) {
        info = await this.docker.inspectContainer(name);
        if (!info.State.Running)
          throw Error("generator exited before artifact collection");
        try {
          archive = await this.docker.archive(name);
          break;
        } catch (e) {
          if (!notFound(e)) throw e;
        }
        await delay(500);
      }
      if (!archive) throw Error("generator timeout");
      const artifact = readArtifact(archive);
      await mkdir(storage(), { recursive: true });
      const tmp = join(storage(), `${i.id}.tmp`);
      await writeFile(tmp, artifact, { mode: 0o600 });
      await rename(tmp, join(storage(), i.id));
      await cleanupContainerGroup(this.docker, groupOptions(i));
      const rows = await this.db.query(
        "UPDATE instances SET status='ready',expires_at=CASE WHEN owner_key='shared' THEN max_expires_at ELSE LEAST(now()+(spec->>'ttl')::int * interval '1 second',max_expires_at) END,artifact_size=$1,updated_at=now() WHERE id=$2 AND status='starting' AND expires_at>now() RETURNING id",
        [artifact.length, i.id],
      );
      if (!rows.length) await this.cleanup(i);
      else if (i.kind !== "terminal") await recordIssuedFlags(this.db, i);
    } else {
      info = await this.docker.inspectContainer(name);
      const domain = i.spec.access_mode === "domain";
      const binding = info.NetworkSettings.Ports[`${i.spec.port}/tcp`]?.[0];
      const internalHost =
        info.NetworkSettings.Networks[`nebuctf-${i.id}`]?.IPAddress;
      if (i.kind !== "terminal" && (domain ? !internalHost : !binding))
        throw Error("instance endpoint missing");
      const endpoint =
        i.kind === "terminal"
          ? null
          : domain
            ? `${config.DOMAIN_SCHEME}://${i.id}.${config.CHALLENGE_DOMAIN}`
            : `${config.CHALLENGE_HOST}:${binding!.HostPort}`;
      const rows = await this.db.query(
        "UPDATE instances SET status='running',expires_at=CASE WHEN owner_key='shared' THEN max_expires_at ELSE LEAST(now()+(spec->>'ttl')::int * interval '1 second',max_expires_at) END,container_id=$1,endpoint=$2,upstream_host=$4,upstream_port=$5,updated_at=now() WHERE id=$3 AND status='starting' AND expires_at>now() RETURNING id",
        [
          info.Id,
          endpoint,
          i.id,
          domain ? internalHost : null,
          domain ? i.spec.port : null,
        ],
      );
      if (!rows.length) await this.cleanup(i);
      else if (i.kind !== "terminal") await recordIssuedFlags(this.db, i);
    }
  }
  async tick() {
    await this.db.query(
      "UPDATE instances SET error=CASE WHEN status IN ('queued','starting') THEN '环境启动超时，请重试' ELSE error END,status='stopping',updated_at=now() WHERE status IN ('queued','starting','running','ready') AND expires_at<=now()",
    );
    const stopping = await this.db.query(
      "SELECT * FROM instances WHERE status='stopping' ORDER BY updated_at LIMIT 20",
    );
    for (const i of stopping) {
      if (this.jobs.has(i.id)) continue;
      try {
        await this.cleanup(i);
        await this.db.query(
          "UPDATE instances SET status=CASE WHEN error IS NULL THEN 'stopped' ELSE 'failed' END,endpoint=NULL,updated_at=now() WHERE id=$1 AND status='stopping'",
          [i.id],
        );
      } catch (e) {
        console.error("cleanup retry", i.id, (e as Error).message);
      }
    }
    const free = 4 - this.jobs.size;
    for (let slot = 0; slot < free; slot++) {
      const i = await this.db.transaction(async (tx) => {
        const [row] = await tx.query(
          `SELECT i.* FROM instances i WHERE (i.status='queued' OR (i.status='starting' AND i.updated_at<now()-interval '2 minutes')) AND i.id<>ALL($1::uuid[]) AND ${queueReady("i")} ORDER BY ${queuePriority("i")},i.created_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT 1`,
          [[...this.jobs.keys()]],
        );
        if (row)
          await tx.query(
            "UPDATE instances SET status='starting',updated_at=now() WHERE id=$1",
            [row.id],
          );
        return row;
      });
      if (!i) break;
      const job = this.start(i)
        .catch(async (e) => {
          console.error("provision failed", i.id, (e as Error).message);
          await this.db.query(
            "UPDATE instances SET status='stopping',error=$2,updated_at=now() WHERE id=$1 AND status='starting'",
            [
              i.id,
              i.scope === "test"
                ? cleanDockerMessage((e as Error).message)
                : "环境创建失败，请联系管理员检查镜像或资源",
            ],
          );
        })
        .catch((e) =>
          console.error(
            "provision persistence failed",
            i.id,
            (e as Error).message,
          ),
        )
        .finally(() => {
          this.jobs.delete(i.id);
        });
      this.jobs.set(i.id, job);
    }
  }
  async reconcile() {
    const running = await this.db.query(
      "SELECT * FROM instances WHERE status='running'",
    );
    for (const i of running) {
      try {
        await reconcileContainerGroup(this.docker, groupOptions(i));
      } catch (e) {
        if (
          notFound(e) ||
          /container exited:|ownership mismatch|untrusted gateway|unexpected container network/.test(
            (e as Error).message,
          )
        ) {
          await this.db.query(
            "UPDATE instances SET status='stopping',error='环境意外退出',updated_at=now() WHERE id=$1 AND status='running'",
            [i.id],
          );
          // Do not leave a reachable primary behind after a dependency has failed.
          await this.cleanup(i);
        } else throw e;
      }
    }
    // Remove resources left by a crash after database state was lost or rolled back.
    const containers = await this.docker.listContainers(label);
    for (const c of containers) {
      const iid = c.Labels[label];
      if (!iid || !/^[0-9a-f-]{36}$/.test(iid)) continue;
      const [i] = await this.db.query(
        "SELECT status FROM instances WHERE id::text=$1",
        [iid],
      );
      if (!i || ["stopped", "failed"].includes(i.status))
        await this.cleanup({ id: iid });
    }
    const networks = await this.docker.listNetworks(label);
    for (const n of networks) {
      const iid = n.Labels?.[label];
      if (!iid || !/^[0-9a-f-]{36}$/.test(iid)) continue;
      const [i] = await this.db.query(
        "SELECT status FROM instances WHERE id::text=$1",
        [iid],
      );
      if (!i || ["stopped", "failed"].includes(i.status))
        await this.cleanup({ id: iid });
    }
  }
}
