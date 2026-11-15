import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { makeTar } from "../src/patch-archive.js";
import {
  containerInput,
  generatorInput,
  resourceProfiles,
  runtimeResourceProfiles,
} from "../src/challenge-model.js";
import {
  containerFootprint,
  containerProfileSnapshot,
  topologyInput,
} from "../src/container-topology.js";
import { publicChallenge } from "../src/context.js";
import { buildApp } from "../src/app.js";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { defaults, saveSetting } from "../src/settings.js";
import { allocationPlan } from "../src/container-policy.js";
import { resourceUsage } from "../src/resource-usage.js";
import { contestResourcePolicy } from "../src/contest-resource-limits.js";
import {
  exportContent,
  importContent,
  validateContent,
} from "../src/content-transfer.js";
import { imageKey } from "../src/image-reference.js";

async function testDatabase() {
  if (process.env.TEST_POSTGRES !== "1") {
    const db = await openDB(true);
    return { db, close: () => db.close() };
  }
  if (!config.DATABASE_URL) throw Error("TEST_POSTGRES requires DATABASE_URL");
  const original = config.DATABASE_URL;
  const admin = new pg.Pool({ connectionString: original, max: 1 });
  const schema = `topology_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${schema}`);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    config.DATABASE_URL = url.toString();
    const db = await openDB();
    return {
      db,
      close: async () => {
        try {
          await db.close();
        } finally {
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
          await admin.end();
        }
      },
    };
  } catch (error) {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  } finally {
    config.DATABASE_URL = original;
  }
}

const topology = {
  networks: [
    { name: "default", internal: false },
    { name: "backend", internal: true },
  ],
  primary_networks: ["default", "backend"],
  services: [
    {
      name: "database",
      image: "nebuctf/database:1",
      cpu: 300,
      memory: 128,
      command: ["database", "--foreground"],
      environment: { DB_PASSWORD: "private" },
      networks: ["backend"],
      depends_on: [],
      inject_flag: false,
    },
    {
      name: "cache",
      image: "nebuctf/cache:1",
      cpu: 200,
      memory: 64,
      networks: ["backend"],
      depends_on: ["database"],
      inject_flag: true,
    },
  ],
};
const profile = containerInput.parse({
  image: "nebuctf/main:1",
  cpu: 500,
  memory: 256,
  ttl: 300,
  command: ["server", "--foreground"],
  environment: { APP_SECRET: "not-public" },
  topology,
});

test("topology validates graph boundaries and preserves complete runtime profiles", () => {
  assert.deepEqual(profile.topology, topology);
  assert.deepEqual(containerFootprint(profile), {
    containers: 3,
    cpu: 1000,
    memory: 448,
  });
  const legacy = containerInput.parse({ image: "nebuctf/legacy:1" });
  assert.deepEqual(containerFootprint(legacy), {
    containers: 1,
    cpu: 500,
    memory: 256,
  });
  assert.deepEqual(containerProfileSnapshot(legacy), {});
  const internalTopology = {
    ...topology,
    networks: topology.networks.map((network) => ({
      ...network,
      internal: true,
    })),
  };
  assert.equal(
    containerInput.safeParse({ ...profile, topology: internalTopology })
      .success,
    false,
  );
  assert.equal(
    containerInput.safeParse({
      ...profile,
      topology: internalTopology,
      access_mode: "domain",
    }).success,
    true,
  );
  assert.equal(
    generatorInput.safeParse({
      image: profile.image,
      cpu: profile.cpu,
      memory: profile.memory,
      ttl: profile.ttl,
      topology,
    }).success,
    false,
  );
  assert.deepEqual(
    generatorInput.parse({
      image: "nebuctf/generator:1",
      cpu: 500,
      memory: 256,
      ttl: 1800,
      mode: "private",
      protocol: "http",
      access_mode: "port",
      port: 8080,
      use_platform_ttl: true,
    }),
    { image: "nebuctf/generator:1", cpu: 500, memory: 256, ttl: 1800 },
  );
  const snapshot = containerProfileSnapshot(profile);
  snapshot.command![0] = "changed";
  snapshot.environment!.APP_SECRET = "changed";
  snapshot.topology!.services[0]!.command![0] = "changed";
  snapshot.topology!.services[0]!.environment!.DB_PASSWORD = "changed";
  snapshot.topology!.networks[0]!.internal = true;
  assert.equal(profile.command![0], "server");
  assert.equal(profile.environment!.APP_SECRET, "not-public");
  assert.equal(profile.topology!.services[0]!.command![0], "database");
  assert.equal(
    profile.topology!.services[0]!.environment!.DB_PASSWORD,
    "private",
  );
  assert.equal(profile.topology!.networks[0]!.internal, false);
  const row = { resources: { container: profile, attachment: null } };
  assert.deepEqual(resourceProfiles(row).container, profile);
  assert.deepEqual(
    runtimeResourceProfiles(row),
    runtimeResourceProfiles({
      resources: {
        container: { ...profile, protocol: "nc" },
        attachment: null,
      },
    }),
  );
  assert.notDeepEqual(
    runtimeResourceProfiles(row),
    runtimeResourceProfiles({
      resources: {
        container: { ...profile, topology: snapshot.topology },
        attachment: null,
      },
    }),
  );
  assert.deepEqual(publicChallenge(row).resources, {
    container: { mode: "private", protocol: "http" },
    attachment: false,
  });
  const withoutFlag = {
    ...topology,
    services: topology.services.map(
      ({ inject_flag: _flag, ...service }) => service,
    ),
  };
  assert.equal(
    topologyInput.parse(withoutFlag).services[0]!.inject_flag,
    false,
  );

  const invalidTopologies: unknown[] = [
    { ...topology, networks: [{ name: "other", internal: false }] },
    { ...topology, primary_networks: ["backend"] },
    { ...topology, primary_networks: ["default", "default"] },
    { ...topology, networks: [...topology.networks, topology.networks[0]] },
    {
      ...topology,
      networks: Array.from({ length: 5 }, (_, n) => ({
        name: n ? `net-${n}` : "default",
        internal: false,
      })),
    },
    { ...topology, services: [...topology.services, topology.services[0]] },
    {
      ...topology,
      services: Array.from({ length: 8 }, (_, n) => ({
        ...topology.services[0],
        name: `service-${n}`,
      })),
    },
  ];
  for (const override of [
    { name: "main" },
    { name: "UPPER" },
    { name: "a".repeat(25) },
    { networks: [] },
    { networks: ["missing"] },
    { networks: ["backend", "backend"] },
    { depends_on: ["main"] },
    { depends_on: ["missing"] },
    { depends_on: ["database"] },
    { depends_on: ["cache", "cache"] },
    { depends_on: ["cache"] },
    { cpu: 99 },
    { cpu: 4001 },
    { memory: 31 },
    { memory: 4097 },
    { image: "bad image" },
    { privileged: true },
  ])
    invalidTopologies.push({
      ...topology,
      services: [
        { ...topology.services[0], ...override },
        topology.services[1],
      ],
    });
  for (const invalid of invalidTopologies)
    assert.equal(
      topologyInput.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  for (const runtime of [
    { command: Array(33).fill("x") },
    { command: ["x".repeat(1025)] },
    { command: ["x\0"] },
    { command: "sh -c true" },
    { environment: { lower: "x" } },
    { environment: { "A-B": "x" } },
    { environment: { A: "x\0" } },
    { environment: { A: "x".repeat(2049) } },
    {
      environment: Object.fromEntries(
        Array.from({ length: 33 }, (_, n) => [`KEY_${n}`, "x"]),
      ),
    },
  ]) {
    assert.equal(
      containerInput.safeParse({ ...profile, ...runtime }).success,
      false,
    );
    assert.equal(
      containerInput.safeParse({
        ...profile,
        topology: {
          ...topology,
          services: [{ ...topology.services[0], ...runtime }],
        },
      }).success,
      false,
    );
  }
});

test("physical reservations retain logical owner and contest quotas through stopping", async (t) => {
  const { db, close } = await testDatabase();
  t.after(close);
  const uid = crypto.randomUUID(),
    owner = `u:${uid}`,
    cid = crypto.randomUUID(),
    iid = crypto.randomUUID();
  const contest = crypto.randomUUID();
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'topology-quota','topology-quota@test.invalid','test')",
    [uid],
  );
  await db.query(
    "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash) VALUES($1,'Topology','Web','入门','dynamic_container','')",
    [cid],
  );
  await db.query(
    "INSERT INTO contests(id,title,starts_at,ends_at,resource_limits) VALUES($1,'Topology',now(),now()+interval '1 hour',$2)",
    [contest, JSON.stringify({ containers_per_team: 2, containers_total: 2 })],
  );
  await db.query(
    "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','stopping',$6,now()+interval '5 minutes',now()+interval '1 hour')",
    [iid, cid, contest, owner, uid, JSON.stringify({ ...profile, awd: true })],
  );
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 4,
    cpu: 1250,
    memory: 576,
    owned: 1,
  });
  const quota = await contestResourcePolicy(db, contest, owner, "container");
  assert.equal(quota!.team_used, 1);
  assert.equal(quota!.total_used, 1);
  assert.equal(quota!.blocked, null);
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 6,
    max_owner_instances: 2,
  });
  await assert.rejects(
    () =>
      allocationPlan(db, contest, owner, {
        ...profile,
        resource_type: "container",
      }),
    /资源池已满/,
  );
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 7,
    max_owner_instances: 2,
  });
  assert.deepEqual(
    (
      await allocationPlan(db, contest, owner, {
        ...profile,
        resource_type: "container",
      })
    ).replacements,
    [],
  );
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 7,
    max_owner_instances: 1,
  });
  await assert.rejects(
    () =>
      allocationPlan(db, contest, owner, {
        ...profile,
        resource_type: "container",
      }),
    /数量上限/,
  );
  const jid = crypto.randomUUID();
  await db.query(
    "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'checking',$1,'patch.tar.gz',$6,now()+interval '5 minutes')",
    [
      jid,
      cid,
      contest,
      owner,
      uid,
      JSON.stringify({ container: profile, patch: { cpu: 500, memory: 256 } }),
    ],
  );
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 8,
    cpu: 2750,
    memory: 1280,
    owned: 2,
  });
  await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [iid]);
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 4,
    cpu: 1500,
    memory: 704,
    owned: 1,
  });
  await db.query("UPDATE judge_jobs SET status='passed' WHERE id=$1", [jid]);
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 4,
    cpu: 1500,
    memory: 704,
    owned: 1,
  });
  await db.query("UPDATE judge_jobs SET cleanup_pending=false WHERE id=$1", [
    jid,
  ]);
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 0,
    cpu: 0,
    memory: 0,
    owned: 0,
  });
  await db.query(
    "INSERT INTO instance_traffic(instance_id,capture_status) VALUES($1,'running')",
    [iid],
  );
  assert.deepEqual(await resourceUsage(db, owner), {
    n: 1,
    cpu: 100,
    memory: 64,
    owned: 0,
  });
  await db.query(
    "UPDATE instance_traffic SET capture_status='off' WHERE instance_id=$1",
    [iid],
  );

  await db.query(
    "UPDATE instances SET scope='practice',status='running',spec=$2 WHERE id=$1",
    [iid, JSON.stringify(profile)],
  );
  await saveSetting(db, "containers", {
    ...defaults.containers,
    auto_destroy: true,
    max_instances: 3,
    max_owner_instances: 1,
  });
  const replacement = await allocationPlan(db, "practice", owner, {
    ...profile,
    resource_type: "container",
  });
  assert.deepEqual(
    replacement.replacements.map((row) => row.id),
    [iid],
  );
});

test("API and archive consumers preserve topology and reject every helper image", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "nebuctf-topology-"));
  const originalStorage = config.DATA_DIR;
  config.DATA_DIR = folder;
  const { db, close } = await testDatabase();
  const app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await close();
    config.DATA_DIR = originalStorage;
    await rm(folder, { recursive: true, force: true });
  });
  const uid = crypto.randomUUID(),
    token = crypto.randomUUID();
  await db.query(
    "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,'topology-admin','topology-admin@test.invalid','test','admin')",
    [uid],
  );
  await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')", [
    digest(token),
    uid,
  ]);
  const headers = {
    cookie: `${sessionCookie}=${token}`,
    origin: config.APP_ORIGIN,
    "x-csrf-protection": "1",
  };
  const input = {
    title: "Topology",
    category: "Web",
    difficulty: "入门",
    published: true,
    practice: true,
    flag_mode: "dynamic",
    resources: {
      container: profile,
      attachment: {
        image: "nebuctf/generator:1",
        cpu: 100,
        memory: 32,
        ttl: 300,
      },
    },
  };
  const invalid = structuredClone(input);
  invalid.resources.container.topology!.services[1]!.image =
    "untrusted/cache:1";
  const rejected = await app.inject({
    method: "POST",
    url: "/api/admin/challenges",
    headers,
    payload: invalid,
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/challenges",
    headers,
    payload: input,
  });
  assert.equal(created.statusCode, 200, created.body);
  const cid = created.json().id;
  const exported = await exportContent(db, "challenge", cid);
  assert.deepEqual(
    exported.manifest.challenges[0]!.config.resources!.container,
    profile,
  );
  const tampered = structuredClone(exported.manifest);
  tampered.challenges[0]!.config.resources!.container!.topology!.services[1]!.image =
    "untrusted/cache:1";
  assert.throws(() => validateContent(tampered, exported.files), /前缀/);
  const imported = await importContent(
    db,
    uid,
    exported.manifest,
    exported.files,
    { title: "Imported topology", flags: {} },
  );
  const [copy] = await db.query(
    "SELECT resources FROM challenges WHERE title='Imported topology'",
  );
  assert.ok(imported);
  assert.deepEqual(copy!.resources.container, profile);

  const allocated = await app.inject({
    method: "POST",
    url: `/api/challenges/${cid}/instances`,
    headers,
    payload: { scope: "practice" },
  });
  assert.equal(allocated.statusCode, 200, allocated.body);
  const [instance] = await db.query("SELECT spec FROM instances WHERE id=$1", [
    allocated.json().id,
  ]);
  assert.deepEqual(
    containerProfileSnapshot(instance!.spec),
    containerProfileSnapshot(profile),
  );
  await db.query(
    "INSERT INTO docker_worker_status(id,checked_at,error) VALUES(1,now(),NULL) ON CONFLICT(id) DO UPDATE SET checked_at=now(),error=NULL",
  );
  await db.query("INSERT INTO docker_images(image,present) VALUES($1,true)", [
    imageKey(profile.image),
  ]);
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 5,
    max_owner_instances: 2,
  });
  const denied = await app.inject({
    method: "POST",
    url: `/api/admin/challenges/${cid}/test-instance`,
    headers,
    payload: {},
  });
  assert.equal(denied.statusCode, 409, denied.body);
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 6,
    max_owner_instances: 2,
  });
  const preview = await app.inject({
    method: "POST",
    url: `/api/admin/challenges/${cid}/test-instance`,
    headers,
    payload: { environment: { PREVIEW: "yes" }, topology },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const [testInstance] = await db.query(
    "SELECT spec FROM instances WHERE id=$1",
    [preview.json().id],
  );
  assert.deepEqual(testInstance!.spec.command, profile.command);
  assert.deepEqual(testInstance!.spec.environment, { PREVIEW: "yes" });
  assert.deepEqual(testInstance!.spec.topology, topology);
  assert.deepEqual(instance!.spec.environment, profile.environment);
  const deniedOverride = await app.inject({
    method: "POST",
    url: `/api/admin/challenges/${cid}/test-instance`,
    headers,
    payload: { topology: invalid.resources.container.topology },
  });
  assert.equal(deniedOverride.statusCode, 400, deniedOverride.body);
  const deniedGenerator = await app.inject({
    method: "POST",
    url: `/api/admin/challenges/${cid}/test-instance`,
    headers,
    payload: { resource_type: "attachment", topology },
  });
  assert.equal(deniedGenerator.statusCode, 400, deniedGenerator.body);
  const defense = await app.inject({
    method: "POST",
    url: "/api/admin/challenges",
    headers,
    payload: {
      ...input,
      title: "Defense topology",
      challenge_type: "awdp",
      resources: { container: profile, attachment: null },
      patch_config: { checker_image: "nebuctf/checker:1" },
      parts: ["attack", "defense"].map((role) => ({
        title: role,
        role,
        initial_points: 100,
        minimum_points: 100,
      })),
    },
  });
  assert.equal(defense.statusCode, 200, defense.body);
  const archive = gzipSync(
    makeTar([
      {
        name: "update.sh",
        data: Buffer.from("#!/bin/sh\nexit 0\n"),
        executable: true,
      },
    ]),
  );
  const upload = {
    method: "POST" as const,
    url: `/api/challenges/${defense.json().id}/patches?scope=practice`,
    headers: {
      ...headers,
      "content-type": "multipart/form-data; boundary=topology",
    },
    payload: Buffer.concat([
      Buffer.from(
        '--topology\r\nContent-Disposition: form-data; name="file"; filename="patch.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n',
      ),
      archive,
      Buffer.from("\r\n--topology--\r\n"),
    ]),
  };
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 9,
    max_owner_instances: null,
  });
  const deniedJudge = await app.inject(upload);
  assert.equal(deniedJudge.statusCode, 409, deniedJudge.body);
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 10,
    max_owner_instances: null,
  });
  const acceptedJudge = await app.inject(upload);
  assert.equal(acceptedJudge.statusCode, 200, acceptedJudge.body);
  const [judge] = await db.query("SELECT spec FROM judge_jobs WHERE id=$1", [
    acceptedJudge.json().id,
  ]);
  assert.deepEqual(judge!.spec.container, profile);
  assert.deepEqual(await resourceUsage(db, `u:${uid}`), {
    n: 10,
    cpu: 3500,
    memory: 1600,
    owned: 3,
  });
});
