import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";

test("scoreboard matrix, timelines, ranks and disclosure boundaries", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1");
  const app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const contest = crypto.randomUUID(),
    group = crypto.randomUUID(),
    otherGroup = crypto.randomUUID();
  const start = Date.now() - 3_600_000,
    at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  await db.query(
    "INSERT INTO contests(id,title,starts_at,ends_at,published) VALUES($1,'Score test',$2,$3,true)",
    [contest, at(0), at(7200)],
  );
  await db.query(
    "INSERT INTO contest_groups(id,contest_id,name,position) VALUES($1,$3,'校内',0),($2,$3,'公开',1)",
    [group, otherGroup, contest],
  );
  const users: string[] = [],
    teams: string[] = [];
  for (let i = 0; i < 3; i++) {
    const uid = crypto.randomUUID(),
      tid = crypto.randomUUID();
    users.push(uid);
    teams.push(tid);
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test-only')",
      [uid, `score_user_${i}`, `score_${i}@example.test`],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
      [tid, `Team ${i}`, uid, `invite-${tid}`],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      uid,
      tid,
    ]);
    await db.query(
      "INSERT INTO registrations(contest_id,team_id,group_id) VALUES($1,$2,$3)",
      [contest, tid, i < 2 ? group : otherGroup],
    );
  }
  async function challenge(title: string, published = true, dynamic = false) {
    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice,dynamic_score,initial_points,minimum_points,decay) VALUES($1,$2,'Web','入门','static_attachment','never-expose-this-flag',$3,true,$4,100,10,4)",
      [id, title, published, dynamic],
    );
    await db.query(
      "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
      [contest, id],
    );
    return id;
  }
  const legacy = await challenge("Legacy"),
    multi = await challenge("Multipart"),
    hidden = await challenge("Hidden");
  await db.query(
    "UPDATE challenges SET published=false,publish_at=now()+interval '1 hour' WHERE id=$1",
    [hidden],
  );
  const p1 = crypto.randomUUID(),
    p2 = crypto.randomUUID();
  await db.query(
    "INSERT INTO challenge_parts(id,challenge_id,title,position,flag_hash,initial_points,minimum_points) VALUES($1,$3,'Part A',0,'secret-a',100,10),($2,$3,'Part B',1,'secret-b',200,20)",
    [p1, p2, multi],
  );
  async function solve(
    team: number,
    cid: string,
    seconds: number,
    part?: string,
    scope = contest,
  ) {
    const owner =
      scope === "practice" ? `u:${users[team]}` : `t:${teams[team]}`;
    if (part)
      await db.query(
        "INSERT INTO part_solves(id,part_id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          part,
          cid,
          scope,
          owner,
          users[team],
          at(seconds),
        ],
      );
    else
      await db.query(
        "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(), cid, scope, owner, users[team], at(seconds)],
      );
  }
  await solve(0, legacy, 10);
  await solve(1, legacy, 30);
  await solve(2, legacy, 70);
  await solve(0, multi, 20, p1);
  await solve(0, multi, 40, p2);
  await solve(0, multi, 40);
  await solve(1, multi, 50, p1);
  await solve(2, multi, 25, p2);
  await solve(0, hidden, 10);
  const contributor = crypto.randomUUID(),
    idleMember = crypto.randomUUID();
  for (const [id, name] of [
    [contributor, "contributor"],
    [idleMember, "idle_member"],
  ]) {
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test-only')",
      [id, name, `${name}@example.test`],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      id,
      teams[0],
    ]);
  }
  await db.query(
    "UPDATE part_solves SET user_id=$1 WHERE part_id=$2 AND owner_key=$3",
    [contributor, p2, `t:${teams[0]}`],
  );
  await db.query("UPDATE challenges SET category='Crypto' WHERE id=$1", [
    multi,
  ]);
  const detail = async (team = teams[0], scope = contest, suffix = "") => {
    const response = await app.inject(
      `/api/scoreboard/${team}?scope=${scope}${suffix}`,
    );
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const get = async (suffix = "", scope = contest) => {
    const r = await app.inject(`/api/scoreboard?scope=${scope}${suffix}`);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  await t.test(
    "matrix counts flags once, includes zero-score teams and agrees with every timeline endpoint",
    async () => {
      const board = await get();
      assert.equal(board.total, 3);
      assert.equal(board.columns.length, 3);
      const a = board.items[0];
      assert.equal(a.id, teams[0]);
      assert.equal(a.score, 400);
      assert.equal(a.solves, 2);
      assert.equal(a.flags, 3);
      assert.equal(
        a.cells.reduce((sum: number, cell: any) => sum + cell.score, 0),
        a.score,
      );
      assert.equal(
        a.cells.find((cell: any) => cell.unit_id === p2).blood_rank,
        2,
      );
      assert.deepEqual(
        board.items.map((row: any) => row.score),
        [400, 300, 200],
      );
      const b = board.items.find((row: any) => row.id === teams[1]);
      assert.equal(b.solves, 1);
      assert.equal(b.flags, 2);
      assert.equal(
        b.cells.find((cell: any) => cell.unit_id === legacy).blood_rank,
        2,
      );
      for (const team of board.timeline)
        assert.equal(team.points.at(-1).score, team.score);
      assert.ok(!JSON.stringify(board).includes(hidden));
      for (const privateValue of [
        "never-expose-this-flag",
        "password_hash",
        "owner_key",
        "secret-a",
        "secret-b",
        "example.test",
      ])
        assert.ok(!JSON.stringify(board).includes(privateValue));
    },
  );
  await t.test(
    "group/search preserve overall rank and global blood order; exact participant filter locates a team",
    async () => {
      const board = await get(`&group=${group}&q=Team%201`);
      assert.equal(board.total, 1);
      assert.equal(board.participants, 2);
      assert.equal(board.items[0].rank, 2);
      assert.equal(board.items[0].overall_rank, 3);
      assert.equal(board.items[0].group_rank, 2);
      assert.equal(
        board.items[0].cells.find((cell: any) => cell.unit_id === legacy)
          .blood_rank,
        2,
      );
      assert.equal(
        board.columns.find((column: any) => column.id === legacy).solves,
        3,
      );
      const exact = await get(`&participant=${teams[2]}`);
      assert.equal(exact.items.length, 1);
      assert.equal(exact.items[0].rank, 2);
      assert.equal((await get("&q=%25")).total, 0); // literal %, not SQL wildcard
      assert.equal(
        (
          await app.inject(
            `/api/scoreboard?scope=${contest}&group=${crypto.randomUUID()}`,
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "detail reconciles solver attribution, member totals and category scores including zero and former members",
    async () => {
      const board = await get();
      assert.equal(board.items[0].cells[0].solver_id, undefined);
      let d = await detail();
      assert.equal(d.overall_rank, 1);
      assert.equal(d.group_rank, 1);
      assert.equal(
        d.categories.reduce((n: number, c: any) => n + c.score, 0),
        400,
      );
      assert.equal(
        d.categories.find((c: any) => c.category === "Crypto").score,
        300,
      );
      assert.equal(
        d.categories.find((c: any) => c.category === "Web").score,
        100,
      );
      assert.equal(
        d.cells.find((c: any) => c.unit_id === p2).solver_id,
        contributor,
      );
      assert.equal(
        d.cells.find((c: any) => c.unit_id === p2).solver_name,
        "contributor",
      );
      assert.equal(d.members.length, 3);
      assert.equal(
        d.members.reduce((n: number, m: any) => n + m.score, 0),
        d.score,
      );
      for (const member of d.members)
        assert.equal(
          member.categories.reduce((n: number, c: any) => n + c.score, 0),
          member.score,
        );
      assert.equal(d.members.find((m: any) => m.id === idleMember).score, 0);
      assert.equal(d.members.find((m: any) => m.id === contributor).score, 200);
      assert.ok(!JSON.stringify(d).includes("example.test"));
      assert.ok(!JSON.stringify(d).includes("password_hash"));
      await db.query(
        "DELETE FROM memberships WHERE user_id=$1 AND team_id=$2",
        [contributor, teams[0]],
      );
      d = await detail();
      assert.equal(
        d.members.find((m: any) => m.id === contributor).current_member,
        false,
      );
      assert.equal(
        d.members.reduce((n: number, m: any) => n + m.score, 0),
        400,
      );
      assert.equal(
        (
          await app.inject(
            `/api/scoreboard/${teams[0]}?scope=${contest}&group=${otherGroup}`,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject(
            `/api/scoreboard/${crypto.randomUUID()}?scope=${contest}`,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await app.inject("/api/scoreboard/invalid")).statusCode,
        400,
      );
    },
  );
  await t.test(
    "freeze applies to scores, cells, counts, bloods and chart points for anonymous viewers",
    async () => {
      await db.query("UPDATE contests SET freeze_at=$2 WHERE id=$1", [
        contest,
        at(35),
      ]);
      const board = await get();
      assert.equal(board.frozen, true);
      assert.equal(Date.parse(board.cutoff), Date.parse(at(35)));
      const a = board.items.find((row: any) => row.id === teams[0]);
      assert.equal(a.score, 200);
      assert.equal(a.solves, 1);
      assert.equal(a.cells.length, 2);
      const d = await detail();
      assert.equal(d.score, 200);
      assert.equal(
        d.members.reduce((n: number, m: any) => n + m.score, 0),
        200,
      );
      assert.equal(
        d.categories.reduce((n: number, c: any) => n + c.score, 0),
        200,
      );
      assert.ok(!d.cells.some((c: any) => c.solver_id === contributor));
      assert.ok(!d.members.some((m: any) => m.id === contributor));
      assert.equal(
        board.columns.find((column: any) => column.id === legacy).solves,
        2,
      );
      for (const row of board.items)
        for (const cell of row.cells)
          assert.ok(Date.parse(cell.solved_at) <= Date.parse(at(35)));
      for (const team of board.timeline)
        for (const point of team.points)
          assert.ok(Date.parse(point.time) <= Date.parse(at(35)));
      await db.query(
        "UPDATE contests SET ends_at=now()-interval '1 second' WHERE id=$1",
        [contest],
      );
      const ended = await get();
      assert.equal(ended.frozen, false);
      assert.equal(ended.items[0].score, 400);
    },
  );
  await t.test(
    "before start, public ranks do not disclose challenge or part names; unpublished contests stay private",
    async () => {
      await db.query(
        "UPDATE contests SET starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours',freeze_at=NULL WHERE id=$1",
        [contest],
      );
      const board = await get();
      assert.equal(board.started, false);
      assert.deepEqual(board.columns, []);
      assert.deepEqual(board.timeline, []);
      assert.ok(
        board.items.every(
          (row: any) => row.score === 0 && row.cells.length === 0,
        ),
      );
      assert.ok(!JSON.stringify(board).includes("Multipart"));
      const d = await detail();
      assert.deepEqual(d.columns, []);
      assert.deepEqual(d.cells, []);
      assert.ok(d.members.every((m: any) => m.score === 0));
      assert.ok(d.categories.every((c: any) => c.score === 0));
      assert.ok(!JSON.stringify(d).includes("Multipart"));
      await db.query("UPDATE contests SET published=false WHERE id=$1", [
        contest,
      ]);
      assert.equal(
        (await app.inject(`/api/scoreboard?scope=${contest}`)).statusCode,
        404,
      );
      assert.equal(
        (await app.inject(`/api/scoreboard/${teams[0]}?scope=${contest}`))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    "practice pagination has stable ranks and total on empty pages; dynamics remain retroactive",
    async () => {
      const dynamic = await challenge("Dynamic", true, true);
      await solve(0, dynamic, 10, undefined, "practice");
      await solve(1, dynamic, 20, undefined, "practice");
      let board = await get("", "practice");
      assert.equal(board.items[0].score, 78);
      assert.equal(board.items[1].score, 78);
      const personal = await detail(users[0], "practice");
      assert.equal(personal.members.length, 1);
      assert.equal(personal.members[0].score, 78);
      assert.equal(personal.cells[0].solver_id, users[0]);
      await solve(2, dynamic, 30, undefined, "practice");
      board = await get("", "practice");
      assert.ok(board.items.slice(0, 3).every((row: any) => row.score === 50));
      for (let i = 0; i < 28; i++)
        await db.query(
          "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test-only')",
          [
            crypto.randomUUID(),
            `zero_${String(i).padStart(2, "0")}`,
            `zero_${i}@example.test`,
          ],
        );
      const avatar = crypto.randomUUID();
      await db.query("UPDATE users SET avatar_id=$2 WHERE id=$1", [
        users[0],
        avatar,
      ]);
      const first = await get("&page_size=12", "practice"),
        second = await get("&page_size=12&page=2", "practice"),
        third = await get("&page_size=12&page=3", "practice");
      assert.equal(
        first.items.find((row: any) => row.id === users[0]).avatar_id,
        avatar,
      );
      assert.equal(
        first.items.find((row: any) => row.id === users[1]).avatar_id,
        null,
      );
      assert.equal((await detail(users[0], "practice")).avatar_id, avatar);
      assert.equal(third.items.length, 9);
      assert.equal(third.items[0].rank, 25);
      assert.equal(first.total, 33);
      assert.equal(first.items.length, 12);
      assert.equal(second.items.length, 12);
      assert.equal(second.items[0].rank, 13);
      assert.equal(
        new Set(
          [...first.items, ...second.items, ...third.items].map(
            (row: any) => row.id,
          ),
        ).size,
        33,
      );
      assert.ok(first.items.some((row: any) => row.score === 0));
      const empty = await get("&page=9999", "practice");
      assert.equal(empty.total, 33);
      assert.deepEqual(empty.items, []);
      assert.equal(
        (await app.inject("/api/scoreboard?page_size=1000")).statusCode,
        400,
      );
    },
  );
});
