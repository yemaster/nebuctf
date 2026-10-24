import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

test("contest announcements and activity isolation", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const headers = { origin: config.APP_ORIGIN, "x-csrf-protection": "1" };
  const write = (
    url: string,
    cookie: string,
    payload: unknown,
    method: "POST" | "PUT" = "POST",
  ) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: { ...headers, cookie },
      payload: payload as any,
    });
  const get = (url: string, cookie = "") =>
    app.inject({ url: `/api${url}`, headers: { cookie } });
  async function user(name: string) {
    const r = await write("/auth/register", "", {
      username: name,
      email: `${name}@example.test`,
      password: "eight888",
    });
    assert.equal(r.statusCode, 200, r.body);
    return {
      id: r.json().user.id,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
    };
  }
  const admin = await user("feedadmin"),
    players = [];
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  for (let n = 0; n < 4; n++) players.push(await user(`feeduser${n}`));
  const basic = {
    title: "首发题",
    category: "Misc",
    difficulty: "入门",
    kind: "static_attachment",
    practice: false,
    published: false,
    flag: "flag{feed}",
  };
  const create = await write("/admin/challenges", admin.cookie, basic);
  assert.equal(create.statusCode, 200, create.body);
  const challenge = create.json().id;
  const parts = await write("/admin/challenges", admin.cookie, {
    ...basic,
    title: "分步题",
    published: true,
    parts: [
      {
        title: "第一步",
        flag: "flag{a}",
        initial_points: 100,
        minimum_points: 100,
      },
      {
        title: "第二步",
        flag: "flag{b}",
        initial_points: 100,
        minimum_points: 100,
      },
    ],
  });
  assert.equal(parts.statusCode, 200, parts.body);
  const partChallenge = parts.json().id;
  const late = await write("/admin/challenges", admin.cookie, {
    ...basic,
    title: "加题",
  });
  const settings = {
    title: "动态测试赛",
    starts_at: new Date(Date.now() + 3600_000).toISOString(),
    ends_at: new Date(Date.now() + 7200_000).toISOString(),
    published: true,
    challenge_ids: [challenge, partChallenge, late.json().id],
  };
  const contest = await write("/admin/contests", admin.cookie, settings);
  assert.equal(contest.statusCode, 200, contest.body);
  const scope = contest.json().id,
    path = `/contests/${scope}/activity`;
  const other = (
    await write("/admin/contests", admin.cookie, {
      ...settings,
      title: "另一场",
      challenge_ids: [],
    })
  ).json().id;
  await t.test(
    "announcements only include the requested contest, or site announcements in the lobby",
    async () => {
      for (const [title, contest_id] of [
        ["全站", null],
        ["本场", scope],
        ["其他场", other],
      ])
        assert.equal(
          (
            await write("/admin/announcements", admin.cookie, {
              title,
              body: "正文",
              contest_id,
            })
          ).statusCode,
          200,
        );
      assert.deepEqual(
        (await get(`/announcements?scope=${scope}`))
          .json()
          .items.map((a: any) => a.title),
        ["本场"],
      );
      assert.deepEqual(
        (await get("/announcements")).json().items.map((a: any) => a.title),
        ["全站"],
      );
      assert.equal(
        (await get(`/announcements?scope=${crypto.randomUUID()}`)).statusCode,
        404,
      );
    },
  );
  await t.test(
    "activity requires registration and reveals no challenges before the start",
    async () => {
      assert.equal((await get(path)).statusCode, 401);
      assert.equal((await get(path, players[0]!.cookie)).statusCode, 403);
      for (let n = 0; n < players.length; n++) {
        const p = players[n]!;
        const team = await write("/teams", p.cookie, {
          name: `动态战队${n + 1}`,
        });
        assert.equal(
          (
            await write(`/contests/${scope}/register`, p.cookie, {
              team_id: team.json().id,
            })
          ).statusCode,
          200,
        );
      }
      assert.deepEqual((await get(path, players[0]!.cookie)).json().items, []);
      assert.equal(
        (await get(`/contests/${other}/activity`, players[0]!.cookie))
          .statusCode,
        403,
      );
      await write(
        `/admin/challenges/${challenge}`,
        admin.cookie,
        { ...basic, published: true },
        "PUT",
      );
      assert.deepEqual((await get(path, players[0]!.cookie)).json().items, []);
      await db.query(
        "UPDATE contests SET starts_at=now()-interval '1 hour' WHERE id=$1",
        [scope],
      );
    },
  );
  await t.test(
    "publication events are real changes, and ordinary edits do not create duplicates",
    async () => {
      const first = await get(path, players[0]!.cookie);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(
        first.json().items.filter((e: any) => e.type === "release").length,
        2,
      );
      assert.ok(
        !first.json().items.some((e: any) => e.challenge_id === late.json().id),
      );
      await write(
        `/admin/challenges/${challenge}`,
        admin.cookie,
        { ...basic, title: "首发题更新", published: true },
        "PUT",
      );
      assert.equal(
        (await get(path, players[0]!.cookie)).json().items.length,
        2,
      );
      await write(
        `/admin/challenges/${late.json().id}`,
        admin.cookie,
        { ...basic, title: "加题", published: true },
        "PUT",
      );
      assert.equal(
        (await get(path, players[0]!.cookie)).json().items.length,
        3,
      );
    },
  );
  await t.test(
    "only unique correct solves appear and first three teams receive blood markers",
    async () => {
      for (const p of players)
        assert.equal(
          (
            await write(`/challenges/${challenge}/submit`, p.cookie, {
              scope,
              flag: "flag{feed}",
            })
          ).statusCode,
          200,
        );
      await write(`/challenges/${challenge}/submit`, players[0]!.cookie, {
        scope,
        flag: "flag{feed}",
      });
      await write(`/challenges/${challenge}/submit`, players[0]!.cookie, {
        scope,
        flag: "wrong",
      });
      const response = await get(path, players[0]!.cookie);
      assert.equal(response.statusCode, 200, response.body);
      const solved = response
        .json()
        .items.filter((e: any) => e.type === "solve");
      assert.equal(solved.length, 4);
      assert.deepEqual(
        solved.map((e: any) => e.blood_rank),
        [null, 3, 2, 1],
      );
      assert.equal(solved[3].team_name, "动态战队1");
      assert.ok(!JSON.stringify(solved).includes("owner_key"));
    },
  );
  await t.test(
    "multipart solves are per part and completion does not duplicate the final event",
    async () => {
      for (const flag of ["flag{a}", "flag{b}"])
        assert.equal(
          (
            await write(
              `/challenges/${partChallenge}/submit`,
              players[0]!.cookie,
              { scope, flag },
            )
          ).statusCode,
          200,
        );
      const items = (await get(path, players[0]!.cookie))
        .json()
        .items.filter(
          (e: any) => e.type === "solve" && e.challenge_id === partChallenge,
        );
      assert.equal(items.length, 2);
      assert.ok(items.every((e: any) => e.part_title && e.blood_rank === 1));
    },
  );
  await t.test(
    "frozen solve activity stays hidden even from admins; release notices remain available",
    async () => {
      await db.query(
        "UPDATE contests SET freeze_at=now()-interval '1 minute' WHERE id=$1",
        [scope],
      );
      for (const cookie of [players[0]!.cookie, admin.cookie]) {
        const result = (await get(path, cookie)).json();
        assert.equal(result.frozen, true);
        assert.ok(result.items.every((e: any) => e.type === "release"));
      }
      await db.query(
        "UPDATE solves SET created_at=now()-interval '2 seconds' WHERE scope=$1",
        [scope],
      );
      await db.query(
        "UPDATE part_solves SET created_at=now()-interval '2 seconds' WHERE scope=$1",
        [scope],
      );
      await db.query(
        "UPDATE contests SET ends_at=now()-interval '1 second' WHERE id=$1",
        [scope],
      );
      const ended = (await get(path, players[0]!.cookie)).json();
      assert.equal(ended.frozen, false);
      assert.equal(
        ended.items.filter((e: any) => e.type === "solve").length,
        6,
      );
      await db.query("UPDATE challenges SET published=false WHERE id=$1", [
        challenge,
      ]);
      assert.ok(
        !(await get(path, players[0]!.cookie))
          .json()
          .items.some((e: any) => e.challenge_id === challenge),
      );
    },
  );
});
