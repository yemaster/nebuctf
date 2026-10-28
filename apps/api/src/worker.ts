import { queuePriority, queueReady } from "./resource-queue.js";
import { recordIssuedFlags } from "./contest-monitor.js";
import { flagEnvironment } from "./flag-environment.js";
import { DockerEngine, readArtifact } from "./docker.js";
export { readArtifact } from "./docker.js";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DB, Row } from "./db.js";
import { config } from "./config.js";
import { storage, validateImage } from "./resources.js";
import { cleanDockerMessage } from "./image-reference.js";
const label = "io.nebuctf.instance";
export function containerConfig(i: Row): Record<string, any> {
  const generator = i.kind === "dynamic_attachment",
    port = `${i.spec.port}/tcp`;
  return {
    name: `nebuctf-${i.id}`,
    Image: i.spec.image,
    User: "65534:65534",
    Env: flagEnvironment(i),
    Labels: { [label]: i.id },
    NetworkDisabled: generator,
    ExposedPorts: generator ? {} : { [port]: {} },
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
        ...(i.spec.awd
          ? { "/run/nebuctf": "rw,noexec,nosuid,nodev,size=1m,mode=1777" }
          : {}),
        ...(generator
          ? { "/output": "rw,noexec,nosuid,nodev,size=24m,mode=1777" }
          : {}),
      },
      PortBindings:
        generator || i.spec.access_mode === "domain"
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
    try {
      const name = `nebuctf-${i.id}`;
      const info = await this.docker.inspectContainer(name);
      if (info.Config.Labels?.[label] !== i.id)
        throw Error("container ownership mismatch");
      await this.docker.removeContainer(name);
    } catch (e) {
      if (!notFound(e)) throw e;
    }
    try {
      const name = `nebuctf-${i.id}`;
      const info = await this.docker.inspectNetwork(name);
      if (info.Labels?.[label] !== i.id)
        throw Error("network ownership mismatch");
      if (
        info.Labels["io.nebuctf.access"] === "domain" &&
        Object.values(info.Containers ?? {}).some(
          (c) => c.Name === config.GATEWAY_CONTAINER,
        )
      ) {
        try {
          await this.docker.disconnectNetwork(name, config.GATEWAY_CONTAINER);
        } catch (e) {
          if (!notFound(e)) throw e;
        }
      }
      await this.docker.removeNetwork(name);
    } catch (e) {
      if (!notFound(e)) throw e;
    }
    for (const filename of [i.id, `${i.id}.tmp`])
      await unlink(join(storage(), filename)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        },
      );
  }
  async start(i: Row) {
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
    await this.docker.inspectImage(i.spec.image);
    if (i.kind !== "dynamic_attachment") {
      try {
        const info = await this.docker.inspectNetwork(`nebuctf-${i.id}`);
        if (info.Labels?.[label] !== i.id)
          throw Error("network ownership mismatch");
      } catch (e) {
        if (!notFound(e)) throw e;
        await this.docker.createNetwork({
          Name: `nebuctf-${i.id}`,
          Driver: "bridge",
          Internal: i.spec.access_mode === "domain",
          Labels: {
            [label]: i.id,
            "io.nebuctf.access": i.spec.access_mode ?? "port",
          },
          Options: {
            "com.docker.network.bridge.enable_icc":
              i.spec.access_mode === "domain" || i.spec.awd ? "true" : "false",
            "com.docker.network.bridge.name": `${i.spec.access_mode === "domain" ? "nctd" : "nctf"}-${i.id.replaceAll("-", "").slice(0, 10)}`,
          },
        });
      }
      if (i.spec.access_mode === "domain") {
        const gateway = await this.docker.inspectContainer(
          config.GATEWAY_CONTAINER,
        );
        if (gateway.Config.Labels["io.nebuctf.gateway"] !== "true")
          throw Error("untrusted gateway container");
        if (!gateway.NetworkSettings.Networks[`nebuctf-${i.id}`])
          await this.docker.connectNetwork(
            `nebuctf-${i.id}`,
            config.GATEWAY_CONTAINER,
          );
      }
    }
    const name = `nebuctf-${i.id}`;
    try {
      const info = await this.docker.inspectContainer(name);
      if (info.Config.Labels?.[label] !== i.id)
        throw Error("container ownership mismatch");
    } catch (e) {
      if (!notFound(e)) throw e;
      await this.docker.createContainer(containerConfig(i));
    }
    let info = await this.docker.inspectContainer(name);
    if (!info.State.Running && info.State.Status === "created")
      await this.docker.startContainer(name);
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
      await this.docker.removeContainer(name);
      const rows = await this.db.query(
        "UPDATE instances SET status='ready',expires_at=CASE WHEN owner_key='shared' THEN max_expires_at ELSE LEAST(now()+(spec->>'ttl')::int * interval '1 second',max_expires_at) END,artifact_size=$1,updated_at=now() WHERE id=$2 AND status='starting' AND expires_at>now() RETURNING id",
        [artifact.length, i.id],
      );
      if (!rows.length) await this.cleanup(i);
      else await recordIssuedFlags(this.db, i);
    } else {
      info = await this.docker.inspectContainer(name);
      const healthDeadline = Date.now() + 30000;
      while (
        info.State.Running &&
        info.State.Health?.Status === "starting" &&
        Date.now() < healthDeadline
      ) {
        await delay(500);
        info = await this.docker.inspectContainer(name);
      }
      if (!info.State.Running) throw Error("container exited");
      if (info.State.Health && info.State.Health.Status !== "healthy")
        throw Error("container health check failed");
      const domain = i.spec.access_mode === "domain";
      const binding = info.NetworkSettings.Ports[`${i.spec.port}/tcp`]?.[0];
      const internalHost =
        info.NetworkSettings.Networks[`nebuctf-${i.id}`]?.IPAddress;
      if (domain ? !internalHost : !binding)
        throw Error("instance endpoint missing");
      const endpoint = domain
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
      else await recordIssuedFlags(this.db, i);
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
        const c = await this.docker.inspectContainer(`nebuctf-${i.id}`);
        if (!c.State.Running) throw Error("exited");
        if (i.spec.access_mode === "domain") {
          const gateway = await this.docker.inspectContainer(
            config.GATEWAY_CONTAINER,
          );
          if (gateway.Config.Labels?.["io.nebuctf.gateway"] !== "true")
            throw Error("untrusted gateway container");
          if (!gateway.NetworkSettings.Networks[`nebuctf-${i.id}`])
            await this.docker.connectNetwork(
              `nebuctf-${i.id}`,
              config.GATEWAY_CONTAINER,
            );
        }
      } catch (e) {
        if (notFound(e) || (e as Error).message === "exited")
          await this.db.query(
            "UPDATE instances SET status='stopping',error='环境意外退出',updated_at=now() WHERE id=$1 AND status='running'",
            [i.id],
          );
        else throw e;
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
