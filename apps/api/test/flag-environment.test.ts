import { imageKey } from "../src/image-reference.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flagEnvironment,
  flagEnvironmentName,
  flagForInstance,
} from "../src/flag-environment.js";
import { dynamicFlag, digest } from "../src/security.js";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { Worker } from "../src/worker.js";
import { recordIssuedFlags } from "../src/contest-monitor.js";
import { flagHash } from "../src/security.js";
import { DockerEngine } from "../src/docker.js";

test("flag injection names are validated and legacy snapshots preserve their values", () => {
  const instance = {
    challenge_id: "challenge",
    scope: "practice",
    owner_key: "u:alice",
    kind: "dynamic_container",
    spec: { parts: ["a", "b"] },
  };
  const env = Object.fromEntries(
    flagEnvironment(instance).map((v) => {
      const split = v.indexOf("=");
      return [v.slice(0, split), v.slice(split + 1)];
    }),
  );
  assert.equal(env.FLAG, env.FLAG_1);
  assert.equal(env.FLAG_COUNT, "2");
  assert.equal(
    env.FLAG_1,
    dynamicFlag("challenge", "practice", "u:alice", "a"),
  );
  assert.notEqual(env.FLAG_1, env.FLAG_2);
  assert.deepEqual(JSON.parse(env.FLAGS_JSON!), {
    a: env.FLAG_1,
    b: env.FLAG_2,
  });
  for (const name of [
    "1FLAG",
    "FLAG=x",
    "FLAG\nOTHER",
    "FLAGS_JSON",
    "FLAG_COUNT",
    "LD_PRELOAD",
    "PATH",
  ])
    assert(!flagEnvironmentName.safeParse(name).success);
  const single = flagEnvironment({
    ...instance,
    spec: { flag_env: "GZCTF_FLAG" },
  });
  assert(single.some((s) => s.startsWith("GZCTF_FLAG=flag{")));
  assert.deepEqual(
    flagEnvironment({ ...instance, spec: { flag_mode: "static" } }),
    [],
  );
  assert.throws(() =>
    flagEnvironment({
      ...instance,
      spec: { parts: ["a", "b"], part_env: { a: "SAME", b: "SAME" } },
    }),
  );
});

test("saved flag mappings follow part IDs through reorder, resources and real judging", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  const previous = config.DATA_DIR,
    temporary = await mkdtemp(join(tmpdir(), "nebuctf-multi-"));
  config.DATA_DIR = temporary;
  const worker = new Worker(db),
    docker = new DockerEngine();
  t.after(async () => {
    await worker.drain();
    if (process.env.TEST_DOCKER === "1")
      for (const row of await db.query("SELECT * FROM instances"))
        await worker.cleanup(row);
    await app.close();
    await db.close();
    await rm(temporary, { recursive: true, force: true });
    config.DATA_DIR = previous;
  });
  async function account(role: string) {
    const id = crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
      [id, "user" + id.slice(0, 8), id + "@test.invalid", role],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), id],
    );
    return { id, cookie: `${sessionCookie}=${token}` };
  }
  const admin = await account("admin"),
    alice = await account("user"),
    bob = await account("user");
  async function req(
    path: string,
    actor = admin,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) {
    return app.inject({
      method: body === undefined ? "GET" : method,
      url: "/api" + path,
      headers: {
        origin: config.APP_ORIGIN,
        cookie: actor.cookie,
        "x-csrf-protection": "1",
      },
      payload: body as any,
    });
  }
  async function ok(
    path: string,
    actor = admin,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) {
    const res = await req(path, actor, body, method);
    assert.equal(res.statusCode, 200, `${path}: ${res.body}`);
    return res.json();
  }
  const profile = {
    image: "nebuctf/example-multi-flag:local",
    cpu: 250,
    memory: 64,
    ttl: 600,
    port: 8080,
    access_mode: "port",
    mode: "private",
  };
  const body = {
    title: "Single container multi-flag",
    category: "Web",
    difficulty: "入门",
    flag_mode: "dynamic",
    flag_template: "NebuCTF{[GUID]}",
    practice: true,
    published: true,
    resources: {
      container: profile,
      attachment: { ...profile, image: "nebuctf/example-generator:local" },
    },
    parts: [
      {
        title: "Entry",
        flag_template: "Entry{[TEAM_HASH]}",
        flag_env: "ENTRY_FLAG",
        initial_points: 100,
        minimum_points: 50,
      },
      {
        title: "Root",
        flag_env: "ROOT_FLAG",
        initial_points: 200,
        minimum_points: 100,
      },
    ],
  };
  const created = await ok("/admin/challenges", admin, body),
    cid = created.id;
  let detail = await ok(`/admin/challenges/${cid}`);
  const entry = detail.parts[0].id,
    root = detail.parts[1].id;
  await t.test(
    "reorder and omitted mappings preserve binding; invalid duplicates are rejected",
    async () => {
      await ok(
        `/admin/challenges/${cid}`,
        admin,
        { ...body, parts: [...detail.parts].reverse() },
        "PUT",
      );
      detail = await ok(`/admin/challenges/${cid}`);
      assert.equal(detail.parts[0].id, root);
      assert.equal(detail.parts[0].flag_env, "ROOT_FLAG");
      await ok(
        `/admin/challenges/${cid}`,
        admin,
        { ...body, parts: detail.parts.map(({ flag_env, ...p }: any) => p) },
        "PUT",
      );
      detail = await ok(`/admin/challenges/${cid}`);
      assert.equal(detail.parts[0].flag_env, "ROOT_FLAG");
      for (const name of ["FLAG_COUNT", "PATH", "BAD=NAME", "FLAG"])
        assert.equal(
          (
            await req(
              `/admin/challenges/${cid}`,
              admin,
              {
                ...body,
                parts: detail.parts.map((p: any, i: number) => ({
                  ...p,
                  flag_env: i ? p.flag_env : name,
                })),
              },
              "PUT",
            )
          ).statusCode,
          400,
        );
      assert.equal(
        (
          await req(
            `/admin/challenges/${cid}`,
            admin,
            {
              ...body,
              parts: detail.parts.map((p: any) => ({
                ...p,
                flag_env: "SHARED_NAME",
              })),
            },
            "PUT",
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "template previews validate input, require administration and do not leak into public data",
    async () => {
      const response = await ok("/admin/flag-template/preview", admin, {
        template: body.flag_template,
      });
      assert.equal(response.samples.length, 3);
      assert.equal(new Set(response.samples).size, 3);
      assert.equal(response.length, 45);
      assert.equal(
        (
          await req("/admin/flag-template/preview", alice, {
            template: body.flag_template,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await req("/admin/flag-template/preview", admin, {
            template: "flag{short}",
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await req("/admin/challenges", admin, {
            ...body,
            flag_template: "flag{short}",
          })
        ).statusCode,
        400,
      );
      const { flag_template: _template, ...omitted } = body;
      await ok(
        `/admin/challenges/${cid}`,
        admin,
        {
          ...omitted,
          parts: detail.parts.map(({ flag_template, ...p }: any) => p),
        },
        "PUT",
      );
      detail = await ok(`/admin/challenges/${cid}`);
      assert.equal(detail.flag_template, body.flag_template);
      assert.equal(
        detail.parts.find((p: any) => p.id === entry).flag_template,
        "Entry{[TEAM_HASH]}",
      );
      await ok(
        `/admin/challenges/${cid}`,
        admin,
        {
          ...body,
          parts: detail.parts.map((p: any) => ({ ...p, flag_template: null })),
        },
        "PUT",
      );
      assert(
        (await ok(`/admin/challenges/${cid}`)).parts.every(
          (p: any) => p.flag_template === null,
        ),
      );
      await ok(
        `/admin/challenges/${cid}`,
        admin,
        { ...body, parts: detail.parts },
        "PUT",
      );
      const single = await ok("/admin/challenges", admin, {
        ...body,
        title: "Single template",
        parts: [],
      });
      await ok(
        `/admin/challenges/${single.id}`,
        admin,
        { ...body, parts: [], flag_template: "" },
        "PUT",
      );
      assert.equal(
        (await ok(`/admin/challenges/${single.id}`)).flag_template,
        "",
      );
      await ok(
        `/admin/challenges/${single.id}`,
        admin,
        { ...body, parts: [] },
        "PUT",
      );
      assert.equal(
        (
          await ok(`/challenges/${single.id}/submit`, alice, {
            scope: "practice",
            flag: dynamicFlag(
              single.id,
              "practice",
              "u:" + alice.id,
              undefined,
              body.flag_template,
            ),
          })
        ).correct,
        true,
      );
      assert.equal(
        (
          await req(
            `/admin/challenges/${single.id}`,
            admin,
            { ...body, parts: [], flag_template: "Other{[GUID]}" },
            "PUT",
          )
        ).statusCode,
        409,
      );
    },
  );
  const instance = await ok(`/challenges/${cid}/instances`, alice, {
    scope: "practice",
    resource_type: "container",
  });
  const generator = await ok(`/challenges/${cid}/instances`, alice, {
    scope: "practice",
    resource_type: "attachment",
  });
  await db.query(
    "INSERT INTO docker_worker_status(id,checked_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET checked_at=now()",
  );
  await db.query(
    "INSERT INTO docker_images(image,present,checked_at) VALUES($1,true,now()) ON CONFLICT(image) DO UPDATE SET present=true,checked_at=now()",
    [imageKey(profile.image)],
  );
  const preview = await ok(`/admin/challenges/${cid}/test-instance`, admin, {
    resource_type: "container",
  });
  const [row] = await db.query("SELECT * FROM instances WHERE id=$1", [
    instance.id,
  ]);
  await t.test(
    "both resources and administrator preview use names without storing flag plaintext",
    async () => {
      for (const id of [instance.id, generator.id, preview.id]) {
        const [record] = await db.query("SELECT * FROM instances WHERE id=$1", [
          id,
        ]);
        assert.equal(record!.spec.part_env[entry], "ENTRY_FLAG");
        assert.equal(record!.spec.part_env[root], "ROOT_FLAG");
        assert.equal(record!.spec.flag_template, body.flag_template);
        assert.equal(record!.spec.part_templates[entry], "Entry{[TEAM_HASH]}");
        assert.equal(record!.spec.part_templates[root], null);
        for (const part of [entry, root])
          assert(
            !JSON.stringify(record!.spec).includes(
              flagForInstance(record!, part),
            ),
          );
      }
      assert.notDeepEqual(
        flagEnvironment(row!),
        flagEnvironment({ ...row, owner_key: "u:" + bob.id }),
      );
      const visible = await ok(`/challenges/${cid}?scope=practice`, alice);
      assert(!JSON.stringify(visible).includes("ENTRY_FLAG"));
      assert(!JSON.stringify(visible).includes("flag_template"));
      assert(
        !(await ok("/challenges?scope=practice", alice)).items.some(
          (c: any) => "flag_template" in c,
        ),
      );
      for (const payload of [
        { ...body, parts: detail.parts, flag_template: "Other{[GUID]}" },
        {
          ...body,
          parts: detail.parts.map((p: any) => ({
            ...p,
            flag_template: "Other{[GUID]}",
          })),
        },
      ])
        assert.equal(
          (await req(`/admin/challenges/${cid}`, admin, payload, "PUT"))
            .statusCode,
          409,
        );
      assert.equal(
        (
          await req(
            `/admin/challenges/${cid}`,
            admin,
            {
              ...body,
              parts: detail.parts.map((p: any) => ({
                ...p,
                flag_env: p.id === entry ? "NEW_NAME" : p.flag_env,
              })),
            },
            "PUT",
          )
        ).statusCode,
        409,
      );
      const injected = flagForInstance(row!, entry);
      const solved = await ok(`/challenges/${cid}/submit`, alice, {
        scope: "practice",
        flag: injected,
      });
      assert.equal(solved.correct, true);
      assert.equal(solved.part_id, entry);
      assert.equal(
        (
          await ok(`/challenges/${cid}/submit`, bob, {
            scope: "practice",
            flag: injected,
          })
        ).correct,
        false,
      );
    },
  );
  await t.test(
    "issued fingerprints use the resource snapshot, including part overrides",
    async () => {
      const contest = crypto.randomUUID(),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Template test',$2,'test')",
        [team, alice.id],
      );
      await db.query(
        "INSERT INTO contests(id,title,starts_at,ends_at) VALUES($1,'Templates',now(),now()+interval '1 hour')",
        [contest],
      );
      const issued = { ...row!, scope: contest, owner_key: "t:" + team };
      await recordIssuedFlags(db, issued);
      const fingerprints = await db.query(
        "SELECT * FROM issued_flags WHERE contest_id=$1",
        [contest],
      );
      assert.equal(fingerprints.length, 2);
      for (const part of [entry, root])
        assert.equal(
          fingerprints.find((p) => p.part_key === part)?.flag_hash,
          flagHash(flagForInstance(issued, part)),
        );
    },
  );
  await t.test(
    "one real container receives and serves both mapped flags",
    { skip: process.env.TEST_DOCKER !== "1" },
    async () => {
      await docker.inspectImage(profile.image);
      await db.query("UPDATE instances SET status='starting' WHERE id=$1", [
        instance.id,
      ]);
      await worker.start(row!);
      const [ready] = await db.query("SELECT * FROM instances WHERE id=$1", [
        instance.id,
      ]);
      assert.equal(ready!.status, "running");
      for (const [path, part] of [
        ["entry", entry],
        ["root", root],
      ]) {
        const response = await fetch(`http://${ready!.endpoint}/${path}`);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), flagForInstance(row!, part));
      }
    },
  );
  await t.test(
    "a real generated attachment contains the template flag and judges correctly",
    { skip: process.env.TEST_DOCKER !== "1" },
    async () => {
      const [record] = await db.query("SELECT * FROM instances WHERE id=$1", [
        generator.id,
      ]);
      await db.query("UPDATE instances SET status='starting' WHERE id=$1", [
        generator.id,
      ]);
      await worker.start(record!);
      const [ready] = await db.query("SELECT * FROM instances WHERE id=$1", [
        generator.id,
      ]);
      assert.equal(ready!.status, "ready", ready!.error);
      const zip = (await req(`/instances/${generator.id}/artifact`, alice))
        .rawPayload;
      assert.equal(zip.readUInt32LE(0), 0x04034b50);
      const offset = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
      const encoded = inflateRawSync(
        zip.subarray(offset, offset + zip.readUInt32LE(18)),
      )
        .toString()
        .trim();
      const flag = Buffer.from(encoded, "base64").toString();
      assert.equal(flag, flagForInstance(record!, root));
      assert.equal(
        (
          await ok(`/challenges/${cid}/submit`, alice, {
            scope: "practice",
            flag,
          })
        ).correct,
        true,
      );
    },
  );
  await t.test(
    "schema replay preserves templates, resource snapshots and solved records",
    async () => {
      const before = await db.query(
        "SELECT id,flag_template FROM challenges ORDER BY id",
      );
      const snapshots = await db.query(
        "SELECT id,spec FROM instances ORDER BY id",
      );
      const schema = await readFile(
        new URL("../src/schema.sql", import.meta.url),
        "utf8",
      );
      await db.transaction(async (tx) => {
        for (const sql of schema.split(";").filter((s) => s.trim()))
          await tx.query(sql);
      });
      assert.deepEqual(
        await db.query("SELECT id,flag_template FROM challenges ORDER BY id"),
        before,
      );
      assert.deepEqual(
        await db.query("SELECT id,spec FROM instances ORDER BY id"),
        snapshots,
      );
      assert.equal(
        (
          await db.query("SELECT max(version) version FROM schema_migrations")
        )[0]!.version,
        30,
      );
    },
  );
});
