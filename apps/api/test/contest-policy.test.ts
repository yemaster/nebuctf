import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, flagHash } from "../src/security.js";
import { contestResourcePolicy } from "../src/contest-resource-limits.js";
import { AwdWorker } from "../src/awd-worker.js";

// The same suite can run against isolated PostgreSQL to exercise real concurrent reservations.
test(
  "private contest boundaries and independent resource quotas",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    await app.ready();
    const sockets: WebSocket[] = [];
    t.after(async () => {
      sockets.forEach((s) => s.terminate());
      await app.close();
      await db.close();
    });
    async function actor(role = "user") {
      const id = crypto.randomUUID(),
        team = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "policy" + id.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, "Team " + team.slice(0, 8), id, team],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await actor("admin"),
      alice = await actor(),
      bob = await actor(),
      outsider = await actor();
    const request = (
      path: string,
      user?: typeof alice,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: body === undefined ? "GET" : method,
        headers: {
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
          ...(user ? { cookie: user.cookie } : {}),
        },
        payload: body as any,
      });
    async function ok(
      path: string,
      user?: typeof alice,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) {
      const r = await request(path, user, body, method);
      assert.equal(r.statusCode, 200, path + ": " + r.body);
      return r.json();
    }
    async function question(kind = "dynamic_container") {
      const id = crypto.randomUUID();
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,image,flag_hash,published,practice,cpu,memory) VALUES($1,'Resource','Web','入门',$2,'nebuctf/test:latest',$3,true,false,100,64)",
        [id, kind, flagHash("flag{policy}")],
      );
      return id;
    }
    const container1 = await question(),
      container2 = await question(),
      attachment = await question("dynamic_attachment");
    const base = {
      title: "Policy cup",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      published: true,
      challenge_ids: [container1, container2, attachment],
    };
    const save = (scope: string, extra: Record<string, unknown>) =>
      ok(`/admin/contests/${scope}`, admin, { ...base, ...extra }, "PUT");
    const create = async (extra: Record<string, unknown> = {}) =>
      (await ok("/admin/contests", admin, { ...base, ...extra })).id as string;

    await t.test(
      "private contests are hidden consistently and invited members can register",
      async () => {
        const scope = await create({
          visibility: "private",
          registration_mode: "teams",
          registration_team_ids: [alice.team],
        });
        await db.query(
          "INSERT INTO announcements(id,title,body,contest_id) VALUES($1,'Private notice','Secret body',$2)",
          [crypto.randomUUID(), scope],
        );
        for (const user of [undefined, outsider]) {
          for (const path of [
            `/contests/${scope}`,
            `/contests/${scope}/poster`,
            `/announcements?scope=${scope}`,
            `/scoreboard?scope=${scope}`,
            `/contests/${scope}/spectate`,
            `/contests/${scope}/spectate/ranking`,
            `/challenges/${container1}?scope=${scope}`,
          ])
            assert.equal((await request(path, user)).statusCode, 404, path);
          const list = await ok("/contests", user);
          assert(!list.items.some((c: any) => c.id === scope));
          assert.equal(list.total, 0);
          const calendar = await ok(
            "/contests/calendar?from=" +
              new Date().toISOString().slice(0, 10) +
              "&to=" +
              new Date().toISOString().slice(0, 10),
            user,
          );
          assert(
            calendar.days.every(
              (d: any) => d.count === 0 && d.contests.length === 0,
            ),
          );
          assert.equal((await ok("/stats", user)).contests, 0);
        }
        assert(
          (await ok("/contests", alice)).items.some((c: any) => c.id === scope),
        );
        const detail = await ok(`/contests/${scope}`, alice);
        assert(!("registration_team_ids" in detail));
        assert.deepEqual(detail.eligible_team_ids, [alice.team]);
        assert.equal(
          (
            await request(`/contests/${scope}/register`, outsider, {
              team_id: outsider.team,
            })
          ).statusCode,
          404,
        );
        await ok(`/contests/${scope}/register`, alice, { team_id: alice.team });
        await save(scope, { registration_team_ids: [bob.team] });
        assert.equal(
          (await ok(`/contests/${scope}`, alice)).registered,
          true,
          "existing approved registration retains access",
        );
        await ok(`/contests/${scope}`, bob);
        await db.query(
          "UPDATE registrations SET status='rejected' WHERE contest_id=$1 AND team_id=$2",
          [scope, alice.team],
        );
        assert.equal(
          (await request(`/contests/${scope}`, alice)).statusCode,
          404,
        );
        assert(
          (await ok("/contests", admin)).items.some((c: any) => c.id === scope),
        );
        await save(scope, { published: false });
        assert.equal(
          (await request(`/contests/${scope}`, bob)).statusCode,
          404,
          "private visibility never publishes a draft",
        );
      },
    );

    await t.test(
      "visibility and quota edits validate, preserve omitted values and allow explicit clearing",
      async () => {
        assert.equal(
          (
            await request("/admin/contests", admin, {
              ...base,
              visibility: "private",
              registration_mode: "public",
            })
          ).statusCode,
          400,
        );
        for (const value of [-1, 1.5, 10001])
          assert.equal(
            (
              await request("/admin/contests", admin, {
                ...base,
                resource_limits: { containers_per_team: value },
              })
            ).statusCode,
            400,
          );
        const scope = await create({
          resource_limits: {
            containers_per_team: 1,
            attachments_per_team: 0,
            containers_total: 5,
            attachments_total: 2,
          },
        });
        await save(scope, {});
        assert.equal(
          (await ok(`/admin/contests/${scope}`, admin)).resource_limits
            .attachments_per_team,
          0,
        );
        await save(scope, { resource_limits: {} });
        assert.deepEqual(
          (await ok(`/admin/contests/${scope}`, admin)).resource_limits,
          {
            containers_per_team: null,
            attachments_per_team: null,
            containers_total: null,
            attachments_total: null,
            container_starts_per_team: null,
          },
        );
      },
    );

    await t.test(
      "turning a contest private closes public sockets and membership removal closes invited sockets",
      async () => {
        const scope = await create(),
          path = `/api/contests/${scope}/spectate/ws`;
        const frames: any[] = [];
        const ws = await app.injectWS(
          path,
          { headers: { origin: config.APP_ORIGIN } },
          {
            onInit: (s) =>
              s.on("message", (m) => frames.push(JSON.parse(String(m)))),
          },
        );
        sockets.push(ws);
        const wait = async (check: () => boolean) => {
          const end = Date.now() + 7000;
          while (!check() && Date.now() < end)
            await new Promise((r) => setTimeout(r, 20));
          assert(check());
        };
        await wait(() => frames.some((f) => f.type === "spectator"));
        let closed = 0;
        ws.on("close", (code) => (closed = code));
        await save(scope, {
          visibility: "private",
          registration_mode: "teams",
          registration_team_ids: [bob.team],
        });
        await wait(() => closed === 1008);
        await assert.rejects(
          app.injectWS(path, { headers: { origin: config.APP_ORIGIN } }),
          /404/,
        );
        const privateFrames: any[] = [];
        const invited = await app.injectWS(
          path,
          { headers: { origin: config.APP_ORIGIN, cookie: bob.cookie } },
          {
            onInit: (s) =>
              s.on("message", (m) => privateFrames.push(JSON.parse(String(m)))),
          },
        );
        sockets.push(invited);
        await wait(() => privateFrames.some((f) => f.type === "spectator"));
        let revoked = 0;
        invited.on("close", (code) => (revoked = code));
        await save(scope, { registration_team_ids: [alice.team] });
        await wait(() => revoked === 1008);
      },
    );

    await t.test(
      "team limits reserve queued and stopping slots atomically and count attachment files independently",
      async () => {
        const scope = await create({
          resource_limits: { containers_per_team: 1, attachments_per_team: 1 },
        });
        await ok(`/contests/${scope}/register`, bob, { team_id: bob.team });
        const results = await Promise.all(
          [container1, container2].map((id) =>
            request(`/challenges/${id}/instances`, bob, { scope }),
          ),
        );
        assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
        const first = results.find((r) => r.statusCode === 200)!.json();
        const cid = results[0]!.statusCode === 200 ? container1 : container2,
          other = cid === container1 ? container2 : container1;
        assert.equal(
          (await ok(`/challenges/${cid}/instances`, bob, { scope })).id,
          first.id,
          "idempotent request returns existing instance",
        );
        const a = await ok(`/challenges/${attachment}/instances`, bob, {
          scope,
        });
        const policy = await ok(
          `/challenges/${other}/instance-policy?scope=${scope}&resource_type=container`,
          bob,
        );
        assert.equal(policy.quota.team_used, 1);
        assert.equal(policy.quota.team_limit, 1);
        assert(policy.quota.blocked.action.href.includes(scope));
        await db.query("UPDATE instances SET status='stopping' WHERE id=$1", [
          first.id,
        ]);
        assert.equal(
          (await request(`/challenges/${other}/instances`, bob, { scope }))
            .statusCode,
          409,
        );
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          first.id,
        ]);
        await ok(`/challenges/${other}/instances`, bob, { scope });
        await db.query("UPDATE instances SET status='ready' WHERE id=$1", [
          a.id,
        ]);
        assert.equal(
          (await contestResourcePolicy(
            db,
            scope,
            "t:" + bob.team,
            "attachment",
          ))!.team_used,
          1,
        );
        await db.query("UPDATE instances SET status='failed' WHERE id=$1", [
          a.id,
        ]);
        assert.equal(
          (await contestResourcePolicy(
            db,
            scope,
            "t:" + bob.team,
            "attachment",
          ))!.team_used,
          0,
        );
        await save(scope, {
          resource_limits: { containers_per_team: 0, attachments_per_team: 0 },
        });
        assert.equal(
          (await request(`/challenges/${attachment}/instances`, bob, { scope }))
            .statusCode,
          409,
        );
        assert.equal(
          (await ok(`/challenges/${other}/instances`, bob, { scope })).status,
          "queued",
          "reducing a limit preserves existing resources",
        );
      },
    );

    await t.test(
      "total limits cover multiple teams, public instances and do not affect other contests",
      async () => {
        const scope = await create({
          resource_limits: { containers_total: 1, attachments_total: 0 },
        });
        await ok(`/contests/${scope}/register`, alice, { team_id: alice.team });
        await ok(`/contests/${scope}/register`, outsider, {
          team_id: outsider.team,
        });
        const first = await ok(`/challenges/${container1}/instances`, alice, {
          scope,
        });
        const blocked = await request(
          `/challenges/${container2}/instances`,
          outsider,
          { scope },
        );
        assert.equal(blocked.statusCode, 409);
        assert.match(blocked.json().error, /本场比赛靶机已达上限/);
        assert.equal(
          (
            await request(`/challenges/${attachment}/instances`, outsider, {
              scope,
            })
          ).statusCode,
          409,
        );
        const secondScope = await create();
        await ok(`/contests/${secondScope}/register`, outsider, {
          team_id: outsider.team,
        });
        await ok(`/challenges/${container2}/instances`, outsider, {
          scope: secondScope,
        });
        await db.query("UPDATE instances SET owner_key='shared' WHERE id=$1", [
          first.id,
        ]);
        assert.equal(
          (await contestResourcePolicy(
            db,
            scope,
            "t:" + outsider.team,
            "container",
          ))!.total_used,
          1,
        );
        assert.equal(
          (await contestResourcePolicy(db, scope, "shared", "container"))!
            .team_limit,
          null,
        );
        assert.equal(
          await contestResourcePolicy(
            db,
            "practice",
            "u:" + outsider.id,
            "container",
          ),
          null,
        );
      },
    );

    await t.test(
      "AWD automatic provisioning respects the same contest limits",
      async () => {
        const scope = await create({
          resource_limits: { containers_per_team: 0 },
        });
        await ok(`/contests/${scope}/register`, outsider, {
          team_id: outsider.team,
        });
        const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
          scope,
        ]);
        const [challenge] = await db.query(
          "SELECT * FROM challenges WHERE id=$1",
          [container1],
        );
        const worker = new AwdWorker(db);
        const link = {
          contest_id: scope,
          challenge_id: container1,
          contest,
          challenge,
        };
        // Provisioning is isolated from Docker and round scoring in this reservation test.
        await (worker as any).provision(link);
        assert.equal(
          (await db.query("SELECT id FROM instances WHERE scope=$1", [scope]))
            .length,
          0,
        );
        await save(scope, {
          resource_limits: { containers_per_team: 1, containers_total: 1 },
        });
        await (worker as any).provision(link);
        assert.equal(
          (await db.query("SELECT id FROM instances WHERE scope=$1", [scope]))
            .length,
          1,
        );
        const p = await contestResourcePolicy(
          db,
          scope,
          "t:" + outsider.team,
          "container",
        );
        assert.equal(
          p!.team_used,
          1,
          "checker reservation is not another contestant lab",
        );
        await db.query(
          "UPDATE challenges SET challenge_type='awd' WHERE id=$1",
          [container1],
        );
        await db.query("UPDATE instances SET status='running' WHERE scope=$1", [
          scope,
        ]);
        await db.query("UPDATE contests SET resource_limits=$2 WHERE id=$1", [
          scope,
          JSON.stringify({ containers_per_team: 0 }),
        ]);
        assert.equal(
          (
            await request(`/challenges/${container1}/restart`, outsider, {
              scope,
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await db.query("SELECT status FROM instances WHERE scope=$1", [
              scope,
            ])
          )[0]!.status,
          "running",
          "refused restart preserves the live environment",
        );
        await db.query("UPDATE contests SET resource_limits=$2 WHERE id=$1", [
          scope,
          JSON.stringify({ containers_per_team: 1, containers_total: 1 }),
        ]);
        await ok(`/challenges/${container1}/restart`, outsider, { scope });
        assert.equal(
          (
            await db.query("SELECT status FROM instances WHERE scope=$1", [
              scope,
            ])
          )[0]!.status,
          "stopping",
          "replacement of the same slot remains allowed at capacity",
        );
      },
    );
  },
);
