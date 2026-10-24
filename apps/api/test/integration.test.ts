import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { flagHash, dynamicFlag } from "../src/security.js";
let embedded = false;
try {
  createRequire(import.meta.url).resolve("@electric-sql/pglite");
  embedded = true;
} catch {}
if (process.env.REQUIRE_DB_TESTS === "1" && !embedded)
  throw Error("Database integration dependency missing");
test(
  "PostgreSQL integration: identity, teams, scoring, contest windows, quotas, learning",
  {
    skip: !embedded
      ? "PGlite dependency unavailable; install dependencies to execute database integration suite"
      : false,
  },
  async (t) => {
    if (process.env.TEST_POSTGRES === "1" && !config.DATABASE_URL)
      throw Error("TEST_POSTGRES requires an isolated empty DATABASE_URL");
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    const base = { origin: config.APP_ORIGIN, "x-csrf-protection": "1" };
    async function createUser(name: string) {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers: base,
        payload: {
          username: name,
          email: `${name}@example.test`,
          password: "correct-horse-battery-42",
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      return {
        user: r.json().user,
        cookie: r.cookies[0]!.name + "=" + r.cookies[0]!.value,
      };
    }
    const alice = await createUser("alice"),
      bob = await createUser("bob"),
      carol = await createUser("carol");
    const send = (path: string, cookie: string, payload: unknown = {}) =>
      app.inject({
        method: "POST",
        url: `/api${path}`,
        headers: { ...base, cookie },
        payload: payload as any,
      });
    const cid = crypto.randomUUID();
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice) VALUES($1,'hello','Misc','入门','static_attachment',$2,true,true)",
      [cid, flagHash("flag{correct}")],
    );
    await t.test(
      "concurrent duplicate correct submissions count exactly once",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            send(`/challenges/${cid}/submit`, alice.cookie, {
              flag: "flag{correct}",
            }),
          ),
        );
        results.forEach((r) => assert.equal(r.statusCode, 200, r.body));
        const [row] = await db.query(
          "SELECT count(*)::int n FROM solves WHERE challenge_id=$1",
          [cid],
        );
        assert.equal(row!.n, 1);
      },
    );
    await t.test(
      "wrong flags do not award points, correct solves update everybody dynamically",
      async () => {
        assert.equal(
          (
            await send(`/challenges/${cid}/submit`, bob.cookie, {
              flag: "wrong",
            })
          ).json().correct,
          false,
        );
        await send(`/challenges/${cid}/submit`, bob.cookie, {
          flag: "flag{correct}",
        });
        const res = await app.inject("/api/scoreboard");
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(res.json().items[0].score, res.json().items[1].score);
        assert.equal(res.json().items[0].solves, 1);
      },
    );
    const team = (
      await send("/teams", alice.cookie, { name: "Nebula" })
    ).json();
    assert.ok(team.invite);
    assert.equal(
      (await send("/team/join", bob.cookie, { invite: team.invite }))
        .statusCode,
      200,
    );
    const contest = crypto.randomUUID(),
      future = new Date(Date.now() + 3600000),
      end = new Date(Date.now() + 7200000);
    await db.query(
      "INSERT INTO contests(id,title,starts_at,ends_at,published) VALUES($1,$2,$3,$4,true)",
      [contest, "test", future, end],
    );
    await t.test(
      "registration locks membership and contest access before opening",
      async () => {
        assert.equal(
          (await send(`/contests/${contest}/register`, alice.cookie))
            .statusCode,
          200,
        );
        assert.equal((await send("/team/leave", bob.cookie)).statusCode, 409);
        assert.equal(
          (await send("/team/join", carol.cookie, { invite: team.invite }))
            .statusCode,
          409,
        );
        assert.equal(
          (
            await app.inject({
              url: `/api/challenges?scope=${contest}`,
              headers: { cookie: alice.cookie },
            })
          ).statusCode,
          403,
        );
      },
    );
    const dynamic = crypto.randomUUID();
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,published,practice,image) VALUES($1,'dynamic','Web','简单','dynamic_container',true,true,'nebuctf/test:1')",
      [dynamic],
    );
    await t.test("dynamic flags cannot be reused by another user", async () => {
      const flag = dynamicFlag(dynamic, "practice", `u:${alice.user.id}`);
      assert.equal(
        (
          await send(`/challenges/${dynamic}/submit`, bob.cookie, { flag })
        ).json().correct,
        false,
      );
      assert.equal(
        (
          await send(`/challenges/${dynamic}/submit`, alice.cookie, { flag })
        ).json().correct,
        true,
      );
    });
    await t.test(
      "concurrent instance starts deduplicate and ownership is enforced",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            send(`/challenges/${dynamic}/instances`, alice.cookie),
          ),
        );
        results.forEach((r) => assert.equal(r.statusCode, 200, r.body));
        assert.equal(new Set(results.map((r) => r.json().id)).size, 1);
        assert.equal(
          (await send(`/instances/${results[0]!.json().id}/stop`, bob.cookie))
            .statusCode,
          403,
        );
      },
    );
    await t.test(
      "resource cooldown survives failures, stop/start cycles and repeated requests",
      async () => {
        const [i] = await db.query(
          "SELECT * FROM instances WHERE challenge_id=$1 AND owner_key=$2",
          [dynamic, `u:${alice.user.id}`],
        );
        const stop = await send(`/instances/${i!.id}/stop`, alice.cookie);
        assert.equal(stop.statusCode, 429);
        assert.ok(Number(stop.headers["retry-after"]) > 0);
        assert.ok(stop.json().retry_after <= 60);
        const policy = await app.inject({
          url: `/api/challenges/${dynamic}/instance-policy`,
          headers: { cookie: alice.cookie },
        });
        assert.ok(Date.parse(policy.json().next_operation_at) > Date.now());
        await db.query(
          "UPDATE instances SET status='failed',error='test failure' WHERE id=$1",
          [i!.id],
        );
        const retry = await send(
          `/challenges/${dynamic}/instances`,
          alice.cookie,
        );
        assert.equal(retry.statusCode, 429);
        await db.query(
          "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
          [`resource:u:${alice.user.id}:practice:${dynamic}`],
        );
        const recreated = await send(
          `/challenges/${dynamic}/instances`,
          alice.cookie,
        );
        assert.equal(recreated.statusCode, 200, recreated.body);
        assert.notEqual(recreated.json().id, i!.id);
        await db.query(
          "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
          [`resource:u:${alice.user.id}:practice:${dynamic}`],
        );
        const stopped = await send(
          `/instances/${recreated.json().id}/stop`,
          alice.cookie,
        );
        assert.equal(stopped.statusCode, 200, stopped.body);
        assert.equal(
          (await send(`/instances/${recreated.json().id}/stop`, alice.cookie))
            .statusCode,
          200,
        );
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          recreated.json().id,
        ]);
        assert.equal(
          (await send(`/challenges/${dynamic}/instances`, alice.cookie))
            .statusCode,
          429,
        );
      },
    );
    await t.test(
      "owned resource listing excludes shared resources without hiding challenge environments",
      async () => {
        await db.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,'practice','shared',$3,'static_container','running',$4,now()+interval '1 hour',now()+interval '1 day')",
          [
            crypto.randomUUID(),
            dynamic,
            alice.user.id,
            JSON.stringify({ ttl: 1800 }),
          ],
        );
        const get = (suffix: string) =>
          app.inject({
            url: `/api/instances${suffix}`,
            headers: { cookie: alice.cookie },
          });
        const all = await get("?scope=practice");
        assert.equal(all.statusCode, 200, all.body);
        assert.ok(all.json().items.some((row: any) => row.shared));
        const own = await get("?scope=practice&owned=true");
        assert.equal(own.statusCode, 200, own.body);
        assert.ok(own.json().items.every((row: any) => !row.shared));
        assert.ok(
          own.json().items.every((row: any) => typeof row.ttl === "number"),
        );
      },
    );
    await t.test(
      "attachment generation and deletion share the team cooldown across members",
      async () => {
        const cid = crypto.randomUUID();
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,published,image) VALUES($1,'artifact','Misc','入门','dynamic_attachment',true,'nebuctf/test:1')",
          [cid],
        );
        await db.query(
          "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
          [contest, cid],
        );
        await db.query(
          "UPDATE contests SET starts_at=now()-interval '1 minute' WHERE id=$1",
          [contest],
        );
        const start = await send(`/challenges/${cid}/instances`, alice.cookie, {
          scope: contest,
        });
        assert.equal(start.statusCode, 200, start.body);
        const duplicate = await send(
          `/challenges/${cid}/instances`,
          bob.cookie,
          { scope: contest },
        );
        assert.equal(duplicate.json().id, start.json().id);
        const stop = await send(
          `/instances/${start.json().id}/stop`,
          bob.cookie,
        );
        assert.equal(stop.statusCode, 429);
        await db.query(
          "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
          [`resource:t:${team.id}:${contest}:${cid}:attachment`],
        );
        await db.query("UPDATE instances SET status='ready' WHERE id=$1", [
          start.json().id,
        ]);
        assert.equal(
          (await send(`/instances/${start.json().id}/stop`, bob.cookie))
            .statusCode,
          200,
        );
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          start.json().id,
        ]);
        assert.equal(
          (
            await send(`/challenges/${cid}/instances`, alice.cookie, {
              scope: contest,
            })
          ).statusCode,
          429,
        );
      },
    );
    await t.test("database sensitive rate limiting is atomic", async () => {
      await db.query("DELETE FROM rate_limits");
      const requests = await Promise.all(
        Array.from({ length: 35 }, () =>
          send(`/challenges/${cid}/submit`, alice.cookie, { flag: "wrong" }),
        ),
      );
      assert.equal(requests.filter((r) => r.statusCode === 429).length, 5);
    });
    await t.test(
      "draft documents are private and completion requires published content",
      async () => {
        const aid = crypto.randomUUID();
        await db.query(
          "INSERT INTO articles(id,slug,title,category,kind,body) VALUES($1,'draft','draft','Misc','tutorial','secret')",
          [aid],
        );
        assert.equal((await app.inject("/api/articles/draft")).statusCode, 404);
        assert.equal(
          (await send(`/articles/${aid}/complete`, alice.cookie)).statusCode,
          404,
        );
        await db.query("UPDATE articles SET published=true WHERE id=$1", [aid]);
        assert.equal(
          (await send(`/articles/${aid}/complete`, alice.cookie)).statusCode,
          200,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/articles/draft",
              headers: { cookie: alice.cookie },
            })
          ).json().completed,
          true,
        );
      },
    );

    await t.test(
      "resource owner quotas apply across different challenges",
      async () => {
        for (let n = 0; n <= config.MAX_OWNER_INSTANCES; n++) {
          const quotaId = crypto.randomUUID();
          await db.query(
            "INSERT INTO challenges(id,title,category,difficulty,kind,published,practice,image) VALUES($1,'quota','Web','简单','dynamic_container',true,true,'nebuctf/test:1')",
            [quotaId],
          );
          const result = await send(
            `/challenges/${quotaId}/instances`,
            alice.cookie,
          );
          assert.equal(
            result.statusCode,
            n < config.MAX_OWNER_INSTANCES ? 200 : 409,
            result.body,
          );
        }
      },
    );
    await t.test(
      "frozen board and public challenge values use the same frozen solve set",
      async () => {
        await db.query("DELETE FROM rate_limits");
        const cid = crypto.randomUUID(),
          team2 = crypto.randomUUID();
        await db.query(
          "UPDATE contests SET starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour',freeze_at=now()-interval '10 minutes' WHERE id=$1",
          [contest],
        );
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published) VALUES($1,'competition','Web','简单','static_attachment',$2,true)",
          [cid, flagHash("flag{competition}")],
        );
        await db.query("INSERT INTO contest_challenges VALUES($1,$2)", [
          contest,
          cid,
        ]);
        await db.query(
          "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Other team',$2,'unique-invite')",
          [team2, carol.user.id],
        );
        await db.query("INSERT INTO memberships VALUES($1,$2)", [
          carol.user.id,
          team2,
        ]);
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [contest, team2],
        );
        for (const [owner, uid, minutes] of [
          [`t:${team.id}`, alice.user.id, 20],
          [`t:${team2}`, carol.user.id, 5],
        ])
          await db.query(
            "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,now()-$6*interval '1 minute')",
            [crypto.randomUUID(), cid, contest, owner, uid, minutes],
          );
        const board = await app.inject(`/api/scoreboard?scope=${contest}`);
        assert.equal(board.statusCode, 200, board.body);
        assert.equal(board.json().frozen, true);
        assert.equal(board.json().items[0].score, 499);
        assert.equal(board.json().items[1].score, 0);
        const detail = await app.inject({
          url: `/api/challenges/${cid}?scope=${contest}`,
          headers: { cookie: alice.cookie },
        });
        assert.equal(detail.json().solves, 1);
        assert.equal(detail.json().points, 499);
        assert.equal(detail.json().flag_hash, undefined);
        assert.equal(detail.json().image, undefined);
        await db.query(
          "UPDATE contests SET ends_at=now()-interval '1 minute' WHERE id=$1",
          [contest],
        );
        assert.equal(
          (
            await send(`/challenges/${cid}/submit`, alice.cookie, {
              scope: contest,
              flag: "flag{competition}",
            })
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "switching a dynamic challenge to static requires a real flag",
      async () => {
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [
          carol.user.id,
        ]);
        const data = {
          title: "conversion",
          category: "Web",
          difficulty: "入门",
          kind: "dynamic_container",
          image: "nebuctf/test:1",
        };
        const created = await send("/admin/challenges", carol.cookie, data);
        assert.equal(created.statusCode, 200, created.body);
        const changed = await app.inject({
          method: "PUT",
          url: `/api/admin/challenges/${created.json().id}`,
          headers: { ...base, cookie: carol.cookie },
          payload: { ...data, kind: "static_container" },
        });
        assert.equal(changed.statusCode, 400, changed.body);
      },
    );
    await t.test(
      "password changes revoke every session and logout invalidates the new session",
      async () => {
        const second = await send("/auth/login", "", {
          email: "alice@example.test",
          password: "correct-horse-battery-42",
        });
        assert.equal(second.statusCode, 200, second.body);
        const cookie = second.cookies[0]!.name + "=" + second.cookies[0]!.value;
        const change = await send("/auth/password", alice.cookie, {
          current: "correct-horse-battery-42",
          password: "updated-password-long-42",
        });
        assert.equal(change.statusCode, 200, change.body);
        for (const value of [alice.cookie, cookie])
          assert.equal(
            (
              await app.inject({ url: "/api/me", headers: { cookie: value } })
            ).json().user,
            null,
          );
        const login = await send("/auth/login", "", {
          email: "alice@example.test",
          password: "updated-password-long-42",
        });
        assert.equal(login.statusCode, 200, login.body);
        const fresh = login.cookies[0]!.name + "=" + login.cookies[0]!.value;
        assert.equal((await send("/auth/logout", fresh)).statusCode, 200);
        assert.equal(
          (
            await app.inject({ url: "/api/me", headers: { cookie: fresh } })
          ).json().user,
          null,
        );
      },
    );
  },
);
