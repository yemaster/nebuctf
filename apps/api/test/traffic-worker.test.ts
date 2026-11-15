import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../src/db.js";
import { DockerEngine, DockerError } from "../src/docker.js";
import { config } from "../src/config.js";
import { getSetting, saveSetting } from "../src/settings.js";
import {
  TrafficWorker,
  indexCaptureFiles,
  sampleTraffic,
} from "../src/traffic-worker.js";
import { resourceUsage } from "../src/resource-usage.js";

test("capture worker preserves slots, enforces budgets, retains closed files and stops revoked captures", async (t) => {
  const db = await openDB(true),
    directory = await mkdtemp(join(tmpdir(), "nebu-capture-")),
    old = config.TRAFFIC_DIR;
  config.TRAFFIC_DIR = directory;
  t.after(async () => {
    await db.close();
    config.TRAFFIC_DIR = old;
    await rm(directory, { recursive: true, force: true });
  });
  const uid = crypto.randomUUID(),
    team = crypto.randomUUID(),
    cid = crypto.randomUUID(),
    contest = crypto.randomUUID(),
    ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'capture','capture@test.test','test')",
    [uid],
  );
  await db.query(
    "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Capture team',$2,'test')",
    [team, uid],
  );
  await db.query(
    "INSERT INTO challenges(id,title,category,difficulty,kind) VALUES($1,'Capture','Web','入门','dynamic_container')",
    [cid],
  );
  await db.query(
    "INSERT INTO contests(id,title,starts_at,ends_at,traffic_mode) VALUES($1,'Capture',now(),now()+interval '1 hour','capture')",
    [contest],
  );
  // Different owners keep the existing active-resource uniqueness constraint meaningful.
  for (const [n, iid] of ids.entries())
    await db.query(
      "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,resource_type,status,container_id,spec,expires_at,max_expires_at) VALUES($1::uuid,$2,$3,$4,$5,'dynamic_container','container','running',$1::text,$6,now()+interval '1 hour',now()+interval '2 hours')",
      [
        iid,
        cid,
        contest,
        `t:${n ? crypto.randomUUID() : team}`,
        uid,
        JSON.stringify({ cpu: 100, memory: 64 }),
      ],
    );
  const containers = new Map<string, any>(),
    specs: any[] = [];
  let available = true,
    started = 0,
    stopped = 0;
  const docker = {
    listContainers: async () =>
      [...containers.values()].map((c) => ({
        Id: c.Id,
        Labels: c.Config.Labels,
      })),
    containerStats: async () => ({
      networks: { eth0: { rx_bytes: 200, tx_bytes: 100 } },
    }),
    inspectImage: async () => {
      if (!available) throw new DockerError(404);
      return {};
    },
    inspectContainer: async (name: string) => {
      const c = containers.get(name);
      if (!c) throw new DockerError(404);
      return c;
    },
    createContainer: async (spec: any) => {
      specs.push(spec);
      containers.set(spec.name, {
        Id: spec.name,
        Config: { Labels: spec.Labels },
        State: { Running: false },
      });
      return { Id: spec.name };
    },
    startContainer: async (name: string) => {
      containers.get(name).State.Running = true;
      started++;
    },
    stopContainer: async (name: string) => {
      containers.get(name).State.Running = false;
      stopped++;
    },
    removeContainer: async (name: string) => {
      containers.delete(name);
    },
  } as unknown as DockerEngine;
  const worker = new TrafficWorker(db, docker),
    policy = {
      ...(await getSetting(db, "traffic")),
      capture_enabled: true,
      capture_limit: 1,
      instance_mib: 8,
      total_mib: 64,
    };
  await saveSetting(db, "traffic", policy);
  await worker.cycle();
  assert.equal(started, 1);
  assert.equal(containers.size, 1);
  assert.equal(specs[0].HostConfig.NetworkMode, `container:${ids[0]}`);
  assert.equal(specs[0].HostConfig.Memory, 64 * 1048576);
  assert.equal(specs[0].HostConfig.Mounts[0].VolumeOptions.Subpath, ids[0]);
  assert(!specs[0].HostConfig.Privileged);
  const usage = await resourceUsage(db);
  assert.equal(usage.memory, 192);
  assert.equal(usage.cpu, 300);
  await worker.cycle();
  assert.equal(started, 1, "polling order must not restart captures");
  assert.equal(stopped, 0);
  const file = `${Date.now() - 8 * 86400000}-${crypto.randomUUID()}.pcap`;
  await writeFile(join(directory, ids[0], file), Buffer.alloc(24));
  await indexCaptureFiles(db, ids[0]);
  await worker.cycle();
  assert(
    !(await readdir(join(directory, ids[0]))).includes(file),
    "expired files are removed",
  );
  await saveSetting(db, "traffic", { ...policy, enabled: false });
  await worker.cycle();
  assert.equal(containers.size, 0);
  assert.equal((await resourceUsage(db)).memory, 128);
  available = false;
  await saveSetting(db, "traffic", policy);
  await worker.cycle();
  assert.equal(
    (
      await db.query(
        "SELECT capture_status FROM instance_traffic WHERE instance_id=$1",
        [ids[0]],
      )
    )[0]!.capture_status,
    "failed",
  );
  assert.equal(
    (await resourceUsage(db)).memory,
    128,
    "failed captures release reservation",
  );
  available = true;
  await worker.cycle();
  assert.equal(containers.size, 1);
  await db.query("UPDATE instances SET status='stopping' WHERE id=$1", [
    ids[0],
  ]);
  await worker.cycle();
  assert(!containers.has(`nebuctf-capture-${ids[0]}`));
  assert(
    containers.has(`nebuctf-capture-${ids[1]}`),
    "released slot serves next environment",
  );
  await db.query("UPDATE contests SET traffic_mode='stats' WHERE id=$1", [
    contest,
  ]);
  await worker.cycle();
  assert.equal(
    containers.size,
    0,
    "statistics-only policy stops packet collection",
  );
});

test("environment traffic totals include helper services without counting previous samples twice", async (t) => {
  const db = await openDB(true),
    iid = crypto.randomUUID(),
    uid = crypto.randomUUID(),
    cid = crypto.randomUUID();
  t.after(() => db.close());
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'topology-traffic','topology-traffic@test.test','test')",
    [uid],
  );
  await db.query(
    "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash) VALUES($1,'Topology traffic','Web','入门','dynamic_container','')",
    [cid],
  );
  await db.query(
    "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,resource_type,status,spec,expires_at,max_expires_at) VALUES($1,$2,'practice',$3,$4,'dynamic_container','container','running',$5,now()+interval '1 hour',now()+interval '2 hours')",
    [iid, cid, `u:${uid}`, uid, JSON.stringify({ cpu: 100, memory: 64 })],
  );
  let sample = 0;
  const counters = [
    { main: [100, 40], db: [200, 80] },
    { main: [140, 50], db: [260, 100] },
  ];
  const docker = {
    containerStats: async (name: string) => {
      const entry = counters[sample]!;
      const [rx_bytes, tx_bytes] = name.endsWith("-db") ? entry.db : entry.main;
      return { networks: { eth0: { rx_bytes, tx_bytes } } };
    },
  } as unknown as DockerEngine;
  const spec = { topology: { services: [{ name: "db" }] } };
  const start = new Date("2026-11-14T00:00:00Z");
  await sampleTraffic(db, docker, iid, start, spec);
  sample = 1;
  await sampleTraffic(
    db,
    docker,
    iid,
    new Date(start.getTime() + 10_000),
    spec,
  );
  const [row] = await db.query(
    "SELECT rx_bytes,tx_bytes,rx_rate,tx_rate FROM instance_traffic WHERE instance_id=$1",
    [iid],
  );
  assert.equal(Number(row!.rx_bytes), 400);
  assert.equal(Number(row!.tx_bytes), 150);
  assert.equal(Number(row!.rx_rate), 10);
  assert.equal(Number(row!.tx_rate), 3);
});
