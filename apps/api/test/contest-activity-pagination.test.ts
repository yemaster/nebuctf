import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { readContestActivity } from "../src/contest-activity.js";
import { readSpectatorSnapshot } from "../src/contest-spectator.js";

test("activity cursor history and bounded spectator feeds", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const scope = crypto.randomUUID(),
    cid = crypto.randomUUID(),
    group = crypto.randomUUID();
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Feed pagination',true,now()-interval '2 hours',now()+interval '1 hour')",
    [scope],
  );
  await db.query(
    "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published) VALUES($1,'Web test','Web','入门','static_attachment','test',true)",
    [cid],
  );
  await db.query(
    "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
    [scope, cid],
  );
  await db.query(
    "INSERT INTO contest_groups(id,contest_id,name,position,permissions) VALUES($1,$2,'No blood',0,$3)",
    [group, scope, JSON.stringify({ blood: false })],
  );
  const players = [];
  // Same millisecond, distinct microseconds: a JS Date cursor would skip records.
  const stamp = new Date(Date.now() - 600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, ".000000Z");
  for (let n = 0; n < 25; n++) {
    const user = crypto.randomUUID(),
      team = crypto.randomUUID(),
      token = crypto.randomUUID(),
      event = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
      [user, "pager" + user.slice(0, 8), user + "@example.test"],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), user],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
      [team, "Team " + n, user, team],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      user,
      team,
    ]);
    if (n !== 23)
      await db.query(
        "INSERT INTO registrations(contest_id,team_id,group_id) VALUES($1,$2,$3)",
        [scope, team, n === 0 ? group : null],
      );
    await db.query(
      "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at,contest_practice) VALUES($1,$2,$3,$4,$5,$6::timestamptz+$7::int*interval '1 microsecond',$8)",
      [event, cid, scope, "t:" + team, user, stamp, n + 1, n === 24],
    );
    players.push({ user, team, event, cookie: `${sessionCookie}=${token}` });
  }
  const notices: string[] = [];
  for (let n = 0; n < 23; n++) {
    const event = crypto.randomUUID();
    notices.push(event);
    await db.query(
      "INSERT INTO contest_notices(id,contest_id,challenge_id,type,challenge_title,created_at) VALUES($1,$2,$3,'hint','Web test',$4::timestamptz+interval '1 minute')",
      [event, scope, cid, stamp],
    );
  }
  const path = `/api/contests/${scope}/activity`;
  const request = (query = "", cookie = players[0]!.cookie) =>
    app.inject({ url: path + query, headers: { cookie } });
  const get = async (query = "") => {
    const r = await request(query);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  async function pages(kind: string) {
    let cursor = "";
    const items: any[] = [],
      sizes: number[] = [];
    do {
      const page = await get(
        `/history?kind=${kind}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      assert(!("hint_updates" in page));
      assert.equal(page.has_more, !!page.next_cursor);
      sizes.push(page.items.length);
      items.push(...page.items);
      cursor = page.next_cursor;
      assert(sizes.length < 12);
    } while (cursor);
    return { items, sizes };
  }
  await t.test(
    "category filters precede limits and preserve blood eligibility",
    async () => {
      const live = await get();
      assert.equal(live.items.length, 10);
      assert.equal(live.has_more, true);
      assert.equal(live.hint_updates.length, 1);
      const solve = await pages("solve");
      assert.deepEqual(solve.sizes, [10, 10, 3]);
      assert.deepEqual(
        solve.items.map((e) => e.id),
        players
          .slice(0, 23)
          .reverse()
          .map((p) => p.event),
      );
      const blood = await pages("blood");
      assert.deepEqual(
        blood.items.map((e) => e.blood_rank),
        [3, 2, 1],
      );
      assert.deepEqual(
        blood.items.map((e) => e.team_id),
        players
          .slice(1, 4)
          .reverse()
          .map((p) => p.team),
      );
      const challenge = await pages("challenge");
      assert.deepEqual(challenge.sizes, [10, 10, 3]);
      assert.deepEqual(
        challenge.items.map((e) => e.id),
        notices.toSorted().reverse(),
      );
      const all = await pages("all");
      assert.deepEqual(all.sizes, [10, 10, 10, 10, 6]);
      assert.equal(new Set(all.items.map((e) => e.id)).size, 46);
      assert(!JSON.stringify(all).includes("cursor_time"));
      assert(!JSON.stringify(all).includes("owner_key"));
    },
  );
  await t.test("new events cannot shift older cursor pages", async () => {
    const before = await get("/history?kind=challenge"),
      cursor = encodeURIComponent(before.next_cursor);
    const oldPage = await get("/history?kind=challenge&cursor=" + cursor);
    await db.query(
      "INSERT INTO contest_notices(id,contest_id,challenge_id,type,challenge_title) VALUES($1,$2,$3,'hint','Web test')",
      [crypto.randomUUID(), scope, cid],
    );
    const after = await get("/history?kind=challenge&cursor=" + cursor);
    assert.deepEqual(after, oldPage);
    assert.equal(after.items.length, 10);
    assert(
      !after.items.some((e: any) =>
        before.items.some((old: any) => old.id === e.id),
      ),
    );
  });
  await t.test(
    "history validates input and applies access, visibility and freeze",
    async () => {
      assert.equal((await request("/history", "")).statusCode, 401);
      assert.equal(
        (await request("/history", players[23]!.cookie)).statusCode,
        403,
      );
      for (const query of [
        "?kind=unknown",
        "?cursor=broken",
        "?cursor=" +
          Buffer.from(JSON.stringify(["no-date", cid])).toString("base64url"),
      ])
        assert.equal((await request("/history" + query)).statusCode, 400);
      const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
        scope,
      ]);
      assert.equal(
        (await readContestActivity(db, scope, contest!, [], { kind: "all" }))
          .items.length,
        0,
      );
      await db.query(
        "UPDATE contests SET freeze_at=$2::timestamptz-interval '1 second' WHERE id=$1",
        [scope, stamp],
      );
      assert.equal((await get("/history?kind=solve")).items.length, 0);
      assert.equal((await get("/history?kind=blood")).items.length, 0);
      assert.equal((await get("/history?kind=challenge")).items.length, 10);
      await db.query("UPDATE contests SET freeze_at=NULL WHERE id=$1", [scope]);
    },
  );
  await t.test(
    "spectator requests ten events without hint history, retaining full statistics",
    async () => {
      const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
        scope,
      ]);
      const queries: string[] = [];
      const tracked = {
        ...db,
        query: async (sql: string, args?: any[]) => {
          queries.push(sql);
          return db.query(sql, args);
        },
      };
      const result = await readSpectatorSnapshot(tracked, contest!);
      assert.equal(result.events.length, 10);
      assert.equal(result.stats.solves, 23);
      assert.equal(result.stats.teams, 24);
      assert.equal(result.leaders.length, 24);
      assert(
        !queries.some((sql) => sql.includes("DISTINCT ON(n.challenge_id)")),
      );
      assert(!JSON.stringify(result).includes("password_hash"));
      // The HTTP route uses the same bounded projection as WebSocket snapshots.
      const response = await app.inject({
        url: `/api/contests/${scope}/spectate`,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().events.length, 10);
      assert.equal(response.json().stats.solves, 23);
    },
  );
});
