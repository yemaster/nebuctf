import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openDB, lock } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import { allPermissions, ownerPermissions } from "../src/group-permissions.js";
import { saveContestGroups } from "../src/contest-groups.js";

test("default groups survive saves and receive registrations from deleted groups", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1");
  const app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  async function player(role = "user") {
    const id = crypto.randomUUID(),
      team = crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
      [id, `group-${id.slice(0, 8)}`, `${id}@example.test`, role],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), id],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
      [team, `Team ${team}`, id, digest(team)],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      id,
      team,
    ]);
    return { team, cookie: `${sessionCookie}=${token}` };
  }
  const admin = await player("admin"),
    a = await player(),
    b = await player(),
    c = await player();
  async function request(
    path: string,
    actor = admin,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) {
    return app.inject({
      url: `/api${path}`,
      method: body === undefined ? "GET" : method,
      headers: {
        cookie: actor.cookie,
        origin: config.APP_ORIGIN,
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
    const res = await request(path, actor, body, method);
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  }
  const created = await ok("/admin/contests", admin, {
    title: "Groups",
    published: true,
    require_review: true,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
    groups: [
      {
        name: "观察组",
        review_mode: "auto",
        permissions: { submit: false, score: false },
      },
    ],
  });
  const path = `/admin/contests/${created.id}`;
  let contest = await ok(path);
  const defaultGroup = contest.groups.find((g: any) => g.is_default);
  const custom = contest.groups.find((g: any) => !g.is_default);
  assert.ok(defaultGroup);
  await ok(`/contests/${created.id}/register`, a, {
    team_id: a.team,
    group_id: custom.id,
  });
  await ok(`/contests/${created.id}/register`, b, { team_id: b.team });
  const defaultRegistration = (await ok(`/contests/${created.id}`, b))
    .registration;
  assert.equal(defaultRegistration.group_id, defaultGroup.id);
  assert.equal(defaultRegistration.status, "pending");
  assert.equal(
    (await ownerPermissions(db, created.id, `t:${a.team}`)).submit,
    false,
  );
  await db.query(
    "UPDATE registrations SET review_note='保留审核记录' WHERE contest_id=$1 AND team_id=$2",
    [created.id, a.team],
  );
  const [before] = await db.query(
    "SELECT * FROM registrations WHERE contest_id=$1 AND team_id=$2",
    [created.id, a.team],
  );
  await ok(
    path,
    admin,
    { ...contest, groups: [...contest.groups, { name: "新增组" }] },
    "PUT",
  );
  contest = await ok(path);
  assert.equal(contest.groups.length, 3);
  const kept = contest.groups.find((g: any) => g.name === "新增组");
  await ok(`/contests/${created.id}/register`, c, {
    team_id: c.team,
    group_id: kept.id,
  });
  // Deletion remains allowed after the event starts, even for a scoring override.
  await db.query(
    "UPDATE contests SET starts_at=now()-interval '1 minute' WHERE id=$1",
    [created.id],
  );
  contest = await ok(path);
  await ok(path, admin, { ...contest, groups: [kept] }, "PUT");
  const [after] = await db.query(
    "SELECT * FROM registrations WHERE contest_id=$1 AND team_id=$2",
    [created.id, a.team],
  );
  assert.deepEqual(after, { ...before, group_id: defaultGroup.id });
  assert.deepEqual(
    await ownerPermissions(db, created.id, `t:${a.team}`),
    allPermissions,
  );
  assert.equal(
    (await ok(`/contests/${created.id}`, c)).registration.group_id,
    kept.id,
  );
  assert.equal(
    (await ok(`/contests/${created.id}`, a)).registration.group_name,
    "默认组别",
  );
  // Omission/empty lists cannot remove the default; attempts to edit it are rejected.
  contest = await ok(path);
  const invalid = await request(
    path,
    admin,
    {
      ...contest,
      groups: [{ ...defaultGroup, permissions: { submit: false } }],
    },
    "PUT",
  );
  assert.equal(invalid.statusCode, 400);
  await ok(path, admin, { ...contest, groups: [] }, "PUT");
  assert.deepEqual(
    (await ok(path)).groups.map((g: any) => g.id),
    [defaultGroup.id],
  );
  assert.equal(
    (await ok(`/contests/${created.id}`, c)).registration.status,
    "pending",
  );
  assert.equal(
    (await ok(`/contests/${created.id}`, c)).registration.group_id,
    defaultGroup.id,
  );
  await ok(
    path,
    admin,
    { ...(await ok(path)), groups: [{ name: "赛中新增组" }] },
    "PUT",
  );
  assert.equal((await ok(path)).groups.length, 2);
  const another = await ok("/admin/contests", admin, {
    title: "No custom groups",
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
  });
  assert.equal(
    (await ok(`/admin/contests/${another.id}`)).groups.filter(
      (g: any) => g.is_default,
    ).length,
    1,
  );
  // A stale client cannot accidentally move a team into another contest's group.
  assert.equal(
    (
      await request(
        path,
        admin,
        {
          ...(await ok(path)),
          groups: [{ ...custom, id: crypto.randomUUID() }],
        },
        "PUT",
      )
    ).statusCode,
    400,
  );
  // Failed mutations roll back both membership moves and group deletion.
  await assert.rejects(
    db.transaction(async (tx) => {
      await lock(tx);
      await saveContestGroups(tx, created.id, []);
      throw Error("rollback");
    }),
  );
  assert.equal((await ok(path)).groups.length, 2);

  const racer = await player();
  const racing = await ok("/admin/contests", admin, {
    title: "Concurrent registration",
    published: true,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
    groups: [{ name: "待删除组" }],
  });
  const racingConfig = await ok(`/admin/contests/${racing.id}`);
  const racingGroup = racingConfig.groups.find((g: any) => !g.is_default);
  const [joining, deleting] = await Promise.all([
    request(`/contests/${racing.id}/register`, racer, {
      team_id: racer.team,
      group_id: racingGroup.id,
    }),
    request(
      `/admin/contests/${racing.id}`,
      admin,
      { ...racingConfig, groups: [] },
      "PUT",
    ),
  ]);
  assert.equal(deleting.statusCode, 200, deleting.body);
  assert.ok([200, 400].includes(joining.statusCode), joining.body);
  const raced = await ok(`/contests/${racing.id}`, racer);
  assert.equal(raced.groups.length, 1);
  if (joining.statusCode === 200)
    assert.equal(raced.registration.group_id, raced.groups[0].id);
  else assert.equal(raced.registration, null);

  // Upgrade an existing contest and ungrouped registration, then repeat migration.
  const legacy = crypto.randomUUID();
  await db.query(
    "INSERT INTO contests(id,title,starts_at,ends_at) VALUES($1,'Legacy',now(),now()+interval '1 hour')",
    [legacy],
  );
  await db.query(
    "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
    [legacy, a.team],
  );
  await db.query("DELETE FROM schema_migrations WHERE version=39");
  const schema = await readFile(
    new URL("../src/schema.sql", import.meta.url),
    "utf8",
  );
  const migration = schema.slice(
    schema.indexOf(
      "ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS is_default",
    ),
  );
  for (let repeat = 0; repeat < 2; repeat++)
    await db.transaction(async (tx) => {
      for (const sql of migration.split(";").filter((s) => s.trim()))
        await tx.query(sql);
    });
  const migrated = await db.query(
    "SELECT g.id FROM contest_groups g JOIN registrations r ON r.group_id=g.id WHERE g.contest_id=$1 AND g.is_default",
    [legacy],
  );
  assert.equal(migrated.length, 1);
});
