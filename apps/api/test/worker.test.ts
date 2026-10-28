import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "../src/worker.js";
import {
  DockerEngine,
  DockerError,
  type ContainerInfo,
  type NetworkInfo,
} from "../src/docker.js";
import type { DB } from "../src/db.js";
import { config } from "../src/config.js";
const id = "22222222-2222-4222-8222-222222222222";
const instance = {
  id,
  challenge_id: id,
  scope: "practice",
  owner_key: "u:test",
  kind: "dynamic_container",
  spec: {
    image: "nebuctf/test",
    port: 8080,
    cpu: 500,
    memory: 256,
    ttl: 1800,
    access_mode: "port",
  },
};
class FakeDocker extends DockerEngine {
  container: ContainerInfo | undefined;
  network: NetworkInfo | undefined;
  created = 0;
  started = 0;
  removed = 0;
  connected = 0;
  spec: Record<string, unknown> | undefined;
  networkSpec: Record<string, unknown> | undefined;
  gateway: ContainerInfo = {
    Id: "gateway",
    Config: { Labels: { "io.nebuctf.gateway": "true" } },
    State: { Running: true, Status: "running" },
    NetworkSettings: { Ports: {}, Networks: {} },
  };
  override async inspectImage() {
    return {};
  }
  override async inspectContainer(name: string) {
    if (name === config.GATEWAY_CONTAINER) return this.gateway;
    if (!this.container) throw new DockerError(404);
    return this.container;
  }
  override async inspectNetwork() {
    if (!this.network) throw new DockerError(404);
    return this.network;
  }
  override async createNetwork(spec: Record<string, unknown>) {
    this.networkSpec = spec;
    this.network = {
      Id: "network",
      Labels: spec.Labels as Record<string, string>,
      Containers: {},
    };
    return {};
  }
  override async createContainer(spec: Record<string, unknown>) {
    this.spec = spec;
    this.created++;
    this.container = {
      Id: id,
      Config: { Labels: spec.Labels as Record<string, string> },
      State: { Running: false, Status: "created" },
      NetworkSettings: {
        Ports: { "8080/tcp": [{ HostPort: "32001" }] },
        Networks: { [`nebuctf-${id}`]: { IPAddress: "172.18.0.2" } },
      },
    };
    return { Id: id };
  }
  override async startContainer() {
    this.started++;
    this.container!.State = { Running: true, Status: "running" };
  }
  override async removeContainer() {
    this.removed++;
    this.container = undefined;
  }
  override async removeNetwork() {
    this.network = undefined;
  }
  override async connectNetwork(name: string) {
    this.connected++;
    this.gateway.NetworkSettings.Networks[name] = { IPAddress: "172.18.0.3" };
    this.network!.Containers = { gateway: { Name: config.GATEWAY_CONTAINER } };
  }
  override async disconnectNetwork(name: string) {
    delete this.gateway.NetworkSettings.Networks[name];
    this.network!.Containers = {};
  }
}
function database(accept = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db: DB = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return (accept ? [{ id }] : []) as any;
    },
    transaction: (fn) => fn(db),
    close: async () => {},
  };
  return { db, calls };
}
test("worker startup is idempotent and uses the allocated Docker port", async () => {
  const { db, calls } = database(),
    docker = new FakeDocker(),
    worker = new Worker(db, docker);
  await worker.start(instance);
  await worker.start(instance);
  assert.equal(docker.created, 1);
  assert.equal(docker.started, 1);
  assert.ok(
    calls.some((c) => c.params?.[1] === `${config.CHALLENGE_HOST}:32001`),
  );
  await worker.cleanup(instance);
  assert.equal(docker.container, undefined);
  assert.equal(docker.network, undefined);
});
test("worker cleans up when a stop request wins the startup race", async () => {
  const { db } = database(false),
    docker = new FakeDocker();
  await new Worker(db, docker).start(instance);
  assert.equal(docker.created, 1);
  assert.equal(docker.removed, 1);
  assert.equal(docker.network, undefined);
});
test("domain worker creates an internal network, connects only trusted gateway, and stores private route", async () => {
  const { db, calls } = database(),
    docker = new FakeDocker(),
    worker = new Worker(db, docker);
  await worker.start({
    ...instance,
    spec: { ...instance.spec, access_mode: "domain" },
  });
  assert.equal(docker.networkSpec?.Internal, true);
  assert.equal(docker.connected, 1);
  const update = calls.find((c) => c.sql.includes("status='running'"));
  assert.equal(update?.params?.[3], "172.18.0.2");
  assert.equal(update?.params?.[4], 8080);
  assert.equal(
    update?.params?.[1],
    `${config.DOMAIN_SCHEME}://${id}.${config.CHALLENGE_DOMAIN}`,
  );
  await worker.cleanup(instance);
  assert.equal(docker.network, undefined);
});
test("worker refuses to delete a container not owned by the instance", async () => {
  const { db } = database(),
    docker = new FakeDocker();
  await docker.createContainer({
    Labels: { "io.nebuctf.instance": "someone-else" },
  });
  await assert.rejects(
    () => new Worker(db, docker).cleanup(instance),
    /ownership mismatch/,
  );
  assert.equal(docker.removed, 0);
});

test("worker starts TTL at readiness, honors absolute deadlines and marks startup timeouts failed", async () => {
  const { openDB } = await import("../src/db.js");
  const db = await openDB(true);
  const docker = new FakeDocker();
  try {
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,'worker','worker@example.test','unused')",
      [id],
    );
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind) VALUES($1,'worker','Web','入门','dynamic_container')",
      [id],
    );
    await db.query(
      "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,created_at,expires_at,max_expires_at) VALUES($1,$1,'practice','u:test',$1,'dynamic_container','starting',$2,now()-interval '4 minutes',now()+interval '1 minute',now()+interval '4 hours')",
      [id, JSON.stringify(instance.spec)],
    );
    const worker = new Worker(db, docker);
    await worker.start(instance);
    let [row] = await db.query("SELECT * FROM instances WHERE id=$1", [id]);
    assert.equal(row!.status, "running");
    assert.ok(new Date(row!.expires_at).getTime() - Date.now() > 1790_000);
    await db.query(
      "UPDATE instances SET status='starting',expires_at=now()+interval '1 minute',max_expires_at=now()+interval '20 seconds' WHERE id=$1",
      [id],
    );
    await worker.start(instance);
    [row] = await db.query("SELECT * FROM instances WHERE id=$1", [id]);
    assert.equal(
      new Date(row!.expires_at).getTime(),
      new Date(row!.max_expires_at).getTime(),
    );
    await db.query(
      "UPDATE instances SET status='starting',expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    await worker.tick();
    [row] = await db.query("SELECT * FROM instances WHERE id=$1", [id]);
    assert.equal(row!.status, "failed");
    assert.match(row!.error, /启动超时/);
    assert.equal(docker.container, undefined);
    assert.equal(docker.network, undefined);
  } finally {
    await db.close();
  }
});

test("terminal starts without flags or a published endpoint and uses normal cleanup", async () => {
  const { db, calls } = database(),
    docker = new FakeDocker(),
    worker = new Worker(db, docker);
  const terminal = {
    ...instance,
    challenge_id: null,
    kind: "terminal",
    spec: { image: "nebuctf/terminal:local", cpu: 250, memory: 128, ttl: 1800 },
  };
  await worker.start(terminal);
  const update = calls.find((c) => c.sql.includes("status='running'"));
  assert.equal(update?.params?.[1], null);
  assert.deepEqual((docker.spec!.HostConfig as any).PortBindings, {});
  assert.deepEqual(docker.spec!.Cmd, ["sleep", "infinity"]);
  assert.equal(calls.filter((c) => c.sql.includes("issued_flags")).length, 0);
  await worker.cleanup(terminal);
  assert.equal(docker.container, undefined);
  assert.equal(docker.network, undefined);
});
