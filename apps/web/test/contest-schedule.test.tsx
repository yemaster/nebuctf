import { test } from "node:test";
import assert from "node:assert/strict";
import { contestProgress, contestStages } from "../src/lib/contest-schedule";
import { contestCapabilities } from "../src/lib/contest-access";
import type { Contest } from "../src/lib/types";

const at = (n: number) => new Date(n * 1000).toISOString();
const contest = {
  starts_at: at(20),
  ends_at: at(40),
  registration_opens_at: at(10),
  registration_closes_at: at(25),
  practice_mode: true,
  writeup: { enabled: true, opens_at: null, deadline: at(50) },
} as Contest;
test("competition progress stays within bounds independently of other stages", () => {
  assert.equal(contestProgress(contest, 0), 0);
  assert.equal(contestProgress(contest, 30000), 50);
  assert.equal(contestProgress(contest, 60000), 100);
  assert.equal(
    contestProgress({ ...contest, ends_at: contest.starts_at }, 30000),
    0,
  );
});
test("schedule represents overlapping stages and exact boundaries", () => {
  assert.deepEqual(
    contestStages(contest, 22000).map((s) => s.state),
    ["active", "active", "upcoming", "upcoming"],
  );
  assert.deepEqual(
    contestStages(contest, 40000).map((s) => s.state),
    ["ended", "ended", "active", "active"],
  );
  assert.equal(contestStages(contest, 50000)[2].label, "已截止");
  assert.equal(
    contestCapabilities(contest, null, 9999).registrationWindow,
    "upcoming",
  );
  assert.equal(
    contestCapabilities(contest, null, 10000).registrationWindow,
    "open",
  );
  assert.equal(
    contestCapabilities(contest, null, 25000).registrationWindow,
    "closed",
  );
  assert.equal(
    contestCapabilities(contest, null, 40000).registrationWindow,
    "open",
  );
});
test("unconfigured stages preserve legacy registration and omit optional sections", () => {
  const c = {
    ...contest,
    registration_opens_at: null,
    registration_closes_at: null,
    writeup: undefined,
    practice_mode: false,
  };
  assert.equal(contestStages(c, 30000).length, 2);
  assert.equal(contestCapabilities(c, null, 30000).registrationWindow, "open");
  assert.equal(
    contestCapabilities(c, null, 40000).registrationWindow,
    "closed",
  );
});
