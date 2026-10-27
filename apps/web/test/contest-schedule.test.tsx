import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contestProgress,
  contestStages,
  contestTimeline,
} from "../src/lib/contest-schedule";
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

test("timeline interleaves overlapping stages and places now between actual milestones", () => {
  const nodes = contestTimeline(contest, 22000);
  assert.deepEqual(
    nodes.map((node) => node.at),
    [at(10), at(20), at(22), at(25), at(40), at(50)],
  );
  assert.deepEqual(
    nodes.map((node) => node.state),
    ["past", "past", "current", "future", "future", "future"],
  );
  assert.deepEqual(
    nodes[2].events.map((event) => event.id),
    ["registration", "contest"],
  );
});

test("coincident milestones share one timestamp and boundary events precede now", () => {
  const nodes = contestTimeline(contest, 40000);
  const boundary = nodes.find(
    (node) => node.at === at(40) && node.state !== "current",
  )!;
  assert.deepEqual(
    boundary.events.map((event) => event.id),
    ["contest-end", "writeup-start", "practice-start"],
  );
  assert.equal(boundary.state, "past");
  const current = nodes.findIndex((node) => node.state === "current");
  assert.equal(nodes[current - 1], boundary);
  assert.deepEqual(
    nodes[current].events.map((event) => event.id),
    ["writeup", "practice"],
  );
});

test("now is first before the schedule and last after its final deadline", () => {
  const upcoming = contestTimeline(contest, 9000);
  assert.equal(upcoming[0].id, "now");
  assert(upcoming.slice(1).every((node) => node.state === "future"));
  const ended = contestTimeline({ ...contest, practice_mode: false }, 50000);
  assert.equal(ended.at(-1)?.id, "now");
  assert(ended.slice(0, -1).every((node) => node.state === "past"));
  assert.deepEqual(ended.at(-1)?.events, []);
});

test("section windows and scoreboard freeze are ordered without losing flexible durations", () => {
  const nodes = contestTimeline(
    {
      ...contest,
      freeze_at: at(35),
      timing: {
        objective: {
          mode: "flexible",
          opens_at: at(20),
          closes_at: at(30),
          duration_seconds: 300,
        },
        practical: {
          mode: "fixed",
          opens_at: at(30),
          closes_at: at(40),
          duration_seconds: null,
        },
      },
    },
    32000,
  );
  assert.deepEqual(
    nodes.map((node) => node.at),
    [at(10), at(20), at(25), at(30), at(32), at(35), at(40), at(50)],
  );
  assert.equal(
    nodes[1].events.find((event) => event.id === "objective-start")?.detail,
    "自由开始，限时 5 分钟",
  );
  assert.deepEqual(
    nodes[3].events.map((event) => event.id),
    ["objective-end", "practical-start"],
  );
  assert.equal(nodes[5].events[0].id, "freeze");
});

test("default registration uses an undated publication node without inventing a timestamp", () => {
  const nodes = contestTimeline(
    {
      ...contest,
      registration_opens_at: null,
      registration_closes_at: null,
      writeup: undefined,
      practice_mode: false,
    },
    35000,
  );
  assert.equal(nodes[0].id, "publication");
  assert.equal(nodes[0].at, null);
  assert.deepEqual(
    nodes.at(-1)?.events.map((event) => event.id),
    ["registration-end", "contest-end"],
  );
  assert.equal(nodes.filter((node) => node.state === "current").length, 1);
});
