import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

test("administrators participate in practice and registered team scoring", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1");
  const app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const post = (path: string, cookie: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: `/api${path}`,
      headers: { origin: config.APP_ORIGIN, "x-csrf-protection": "1", cookie },
      payload: payload as any,
    });
  const get = (path: string, cookie = "") =>
    app.inject({ url: `/api${path}`, headers: { cookie } });
  async function account(username: string) {
    const res = await post("/auth/register", "", {
      username,
      email: `${username}@example.test`,
      password: "test8888",
    });
    assert.equal(res.statusCode, 200, res.body);
    return {
      id: res.json().user.id,
      cookie: `${res.cookies[0]!.name}=${res.cookies[0]!.value}`,
    };
  }
  const admin = await account("scoring_admin"),
    player = await account("scoring_player");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  const res = await post("/admin/challenges", admin.cookie, {
    title: "Admin scoring",
    category: "Misc",
    difficulty: "入门",
    kind: "static_attachment",
    practice: true,
    published: true,
    dynamic_score: false,
    parts: [
      {
        title: "First",
        flag: "flag{admin_one}",
        initial_points: 100,
        minimum_points: 100,
      },
      {
        title: "Second",
        flag: "flag{admin_two}",
        initial_points: 200,
        minimum_points: 200,
      },
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  const cid = res.json().id,
    contest = crypto.randomUUID();
  const submit = (cookie: string, flag: string, scope = "practice") =>
    post(`/challenges/${cid}/submit`, cookie, { flag, scope });
  await db.query(
    "INSERT INTO contests(id,title,starts_at,ends_at,published) VALUES($1,'Admin scoring',now()-interval '1 hour',now()+interval '1 hour',true)",
    [contest],
  );
  await db.query(
    "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
    [contest, cid],
  );
  await t.test(
    "admin flag submissions award personal points and survive role changes",
    async () => {
      assert.equal((await submit(admin.cookie, "wrong")).json().correct, false);
      const correct = await submit(admin.cookie, "flag{admin_one}");
      assert.equal(correct.statusCode, 200, correct.body);
      assert.equal(correct.json().completed, false);
      assert.equal(
        (await submit(admin.cookie, "flag{admin_one}")).json().already_solved,
        true,
      );
      const partial = (await get(`/challenges/${cid}`, admin.cookie)).json();
      assert.equal(partial.solved_parts, 1);
      assert.equal(partial.earned_points, 100);
      assert.equal(
        (await submit(admin.cookie, "flag{admin_two}")).json().completed,
        true,
      );
      for (const role of ["admin", "user", "admin"]) {
        await db.query("UPDATE users SET role=$2 WHERE id=$1", [
          admin.id,
          role,
        ]);
        const board = (await get(`/scoreboard?participant=${admin.id}`)).json();
        assert.equal(board.total, 1);
        assert.equal(board.items[0].score, 300);
        assert.equal(board.items[0].solves, 1);
        assert.equal(board.items[0].flags, 2);
      }
    },
  );
  await t.test(
    "preview is allowed but scoring requires the admin's registered team",
    async () => {
      const preview = await get(
        `/challenges/${cid}?scope=${contest}`,
        admin.cookie,
      );
      assert.equal(preview.statusCode, 200);
      assert.equal(preview.json().solved_parts, 0);
      assert.equal(
        (await get(`/challenges?scope=${contest}`, admin.cookie)).statusCode,
        200,
      );
      const noTeam = await submit(admin.cookie, "flag{admin_one}", contest);
      assert.equal(noTeam.statusCode, 403);
      assert.equal(noTeam.json().action.href, "/team");
      const team = (
        await post("/teams", admin.cookie, { name: "Admin team" })
      ).json();
      assert.equal(
        (await post("/team/join", player.cookie, { invite: team.invite }))
          .statusCode,
        200,
      );
      const noRegistration = await submit(
        admin.cookie,
        "flag{admin_one}",
        contest,
      );
      assert.equal(noRegistration.statusCode, 403);
      assert.equal(noRegistration.json().action.href, `/contests/${contest}`);
      assert.equal(
        (
          await post(`/contests/${contest}/register`, admin.cookie, {
            team_id: team.id,
          })
        ).statusCode,
        200,
      );
      const first = await submit(admin.cookie, "flag{admin_one}", contest);
      assert.equal(first.statusCode, 200, first.body);
      for (const cookie of [admin.cookie, player.cookie]) {
        const detail = (
          await get(`/challenges/${cid}?scope=${contest}`, cookie)
        ).json();
        const list = (await get(`/challenges?scope=${contest}`, cookie)).json();
        assert.equal(detail.solved_parts, 1);
        assert.equal(detail.parts[0].solved, true);
        assert.equal(list.items[0].solved_parts, 1);
        assert.equal(detail.solved, false);
      }
      assert.equal(
        (await submit(player.cookie, "flag{admin_one}", contest)).json()
          .already_solved,
        true,
      );
      assert.equal(
        (await submit(player.cookie, "flag{admin_two}", contest)).json()
          .completed,
        true,
      );
      assert.equal(
        (await get(`/challenges/${cid}?scope=${contest}`, admin.cookie)).json()
          .solved,
        true,
      );
      const board = (await get(`/scoreboard?scope=${contest}`)).json();
      assert.equal(board.items.length, 1);
      assert.equal(board.items[0].id, team.id);
      assert.equal(board.items[0].score, 300);
      assert.equal(board.items[0].solves, 1);
      assert.equal(board.items[0].flags, 2);
      const [count] = await db.query(
        "SELECT count(*)::int n FROM submissions WHERE scope=$1",
        [contest],
      );
      assert.equal(count!.n, 3);
    },
  );
  await t.test(
    "contest time windows and disabled accounts still apply to admins",
    async () => {
      await db.query(
        "UPDATE contests SET starts_at=now()+interval '10 minutes' WHERE id=$1",
        [contest],
      );
      assert.equal(
        (await submit(admin.cookie, "flag{admin_one}", contest)).statusCode,
        403,
      );
      await db.query(
        "UPDATE contests SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
        [contest],
      );
      assert.equal(
        (await submit(admin.cookie, "flag{admin_one}", contest)).statusCode,
        403,
      );
      await db.query("UPDATE users SET disabled=true WHERE id=$1", [admin.id]);
      assert.equal(
        (await submit(admin.cookie, "flag{admin_one}")).statusCode,
        401,
      );
      assert.equal(
        (await get(`/scoreboard?participant=${admin.id}`)).json().total,
        0,
      );
    },
  );
});
