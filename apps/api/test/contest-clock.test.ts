import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openDB } from "../src/db.js";
import {
  contestRoundSchedule,
  currentContestRound,
  roundWindow,
} from "../src/contest-clock.js";
import { ensureRound, tickRounds } from "../src/rounds.js";

const epoch = Date.parse("2026-10-01T00:00:00Z");
const contest = {
  starts_at: new Date(epoch),
  ends_at: new Date(epoch + 650000),
  round_duration: 120,
};

test("one competition clock follows the practical window, exact boundaries and its final short round", () => {
  assert.equal(roundWindow(contest, undefined, epoch - 1), null);
  assert.equal(roundWindow(contest, undefined, epoch)!.number, 1);
  assert.equal(roundWindow(contest, undefined, epoch + 120000)!.number, 2);
  assert.equal(roundWindow(contest, undefined, epoch + 650000), null);
  const last = currentContestRound(contest, epoch + 800000)!;
  assert.equal(last.number, 6);
  assert.equal(last.total, 6);
  assert.equal(last.status, "ended");
  assert.equal(+last.ends_at - +last.starts_at, 50000);
  const phased = {
    ...contest,
    timing: {
      practical: {
        mode: "fixed",
        opens_at: new Date(epoch + 120000).toISOString(),
        closes_at: new Date(epoch + 600000).toISOString(),
      },
    },
  };
  assert.equal(roundWindow(phased, undefined, epoch + 240000)!.number, 2);
  assert.equal(contestRoundSchedule(phased).total, 4);
});

test("different questions and timed releases join the same persisted tick, without replaying legacy scores", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1");
  t.after(() => db.close());
  const id = crypto.randomUUID(),
    a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const now = Date.now(),
    start = now - 360000;
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at,round_duration) VALUES($1,'Unified ticks',true,$2,$3,120)",
    [id, new Date(start), new Date(now + 600000)],
  );
  for (const cid of [a, b])
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published) VALUES($1,'Clock','Web','入门','static_attachment','test',true)",
      [cid],
    );
  const scoring = {
    mode: "round",
    points: { initial_points: 100, minimum_points: 10, decay: 5 },
    parts: [],
    round: {
      carry: true,
      dynamic: false,
      flag_lifetime: 1,
      defense_points: 100,
      availability_points: 100,
    },
  };
  await db.query(
    "INSERT INTO contest_challenges(contest_id,challenge_id,scoring,release_at) VALUES($1,$2,$4,NULL),($1,$3,$4,$5)",
    [id, a, b, JSON.stringify(scoring), new Date(start + 270000)],
  );
  const [ct] = await db.query("SELECT * FROM contests WHERE id=$1", [id]);
  const links = await db.query(
    "SELECT * FROM contest_challenges WHERE contest_id=$1 ORDER BY release_at NULLS FIRST",
    [id],
  );
  assert.equal(
    await ensureRound(db, ct!, links[1]!, 2, now),
    null,
    "unreleased question earns no earlier tick",
  );
  const [ra, rb] = await Promise.all(
    links.map((l) => ensureRound(db, ct!, l, undefined, now)),
  );
  assert.equal(ra!.tick_id, rb!.tick_id);
  assert.equal(ra!.number, 4);
  assert.equal(rb!.number, 4);
  assert.equal(+new Date(ra!.starts_at), +new Date(rb!.starts_at));
  assert.equal(+new Date(ra!.ends_at), +new Date(rb!.ends_at));
  assert.equal(
    (await ensureRound(db, ct!, links[0]!, undefined, now))!.id,
    ra!.id,
  );
  assert.equal(
    ra!.settings.round.interval,
    120,
    "worker lifetime uses the competition duration",
  );
  const ended = {
    ...ct,
    ends_at: new Date(start + 175000),
    round_clock_from: new Date(start + 175000),
  };
  assert.equal(
    await ensureRound(db, ended, links[0]!, 2, now),
    null,
    "an ended legacy contest must not replay its short final round",
  );
  await tickRounds(db, now + 1);
  const rounds = await db.query(
    "SELECT challenge_id,number,tick_id FROM contest_rounds WHERE contest_id=$1 ORDER BY number",
    [id],
  );
  assert.deepEqual(
    rounds.filter((r) => r.challenge_id === b).map((r) => r.number),
    [3, 4],
  );
  for (const n of [3, 4])
    assert.equal(
      new Set(rounds.filter((r) => r.number === n).map((r) => r.tick_id)).size,
      1,
    );

  // Simulate an old installation with independently numbered round ledgers.
  const old = crypto.randomUUID(),
    legacy = crypto.randomUUID();
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Old game',true,$2,$3)",
    [old, new Date(start), new Date(now + 600000)],
  );
  await db.query(
    "INSERT INTO contest_challenges(contest_id,challenge_id,scoring) VALUES($1,$2,$3)",
    [
      old,
      a,
      JSON.stringify({ ...scoring, round: { ...scoring.round, interval: 60 } }),
    ],
  );
  await db.query(
    "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings,status) VALUES($1,$2,$3,1,$4,$5,$6,'settled')",
    [
      legacy,
      old,
      a,
      new Date(start),
      new Date(start + 60000),
      JSON.stringify({ ...scoring, round: { ...scoring.round, interval: 60 } }),
    ],
  );
  await db.query("DELETE FROM schema_migrations WHERE version=21");
  const sql = (
    await readFile(new URL("../src/schema.sql", import.meta.url), "utf8")
  ).split(
    "INSERT INTO schema_migrations(version) VALUES(20) ON CONFLICT DO NOTHING;",
  )[1]!;
  await db.transaction(async (tx) => {
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await tx.query(statement);
  });
  const [migrated] = await db.query("SELECT * FROM contests WHERE id=$1", [
    old,
  ]);
  assert.equal(migrated!.round_duration, 60);
  assert(+new Date(migrated!.round_clock_from) >= now);
  const before = (
    await db.query("SELECT * FROM contest_rounds WHERE id=$1", [legacy])
  )[0]!;
  assert.equal(before.status, "settled");
  assert.equal(before.tick_id, null);
  await tickRounds(db, now);
  assert.equal(
    (await db.query("SELECT * FROM contest_rounds WHERE contest_id=$1", [old]))
      .length,
    1,
    "upgrade does not re-credit old rounds",
  );
  const resume = +new Date(migrated!.round_clock_from);
  await tickRounds(db, resume + 60001);
  const next = await db.query(
    "SELECT * FROM contest_rounds WHERE contest_id=$1 AND tick_id IS NOT NULL",
    [old],
  );
  assert(next.length > 0);
  assert(next.every((r) => +new Date(r.starts_at) >= resume));
});
