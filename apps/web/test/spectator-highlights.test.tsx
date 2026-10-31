import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SpectatorHighlightTracker,
  enqueueSpectatorHighlights,
  type SpectatorHighlight,
} from "../src/lib/spectator-highlights";
import type { SpectatorData, SpectatorEvent } from "../src/lib/spectator";

const now = Date.now();
const blood = (
  id: string,
  extra: Partial<SpectatorEvent> = {},
): SpectatorEvent => ({
  id,
  type: "solve",
  team_id: "a",
  team_name: "Alpha",
  challenge_id: "web",
  challenge_title: "Web",
  part_title: "Part 2",
  blood_rank: 1,
  created_at: new Date(now).toISOString(),
  ...extra,
});
const snapshot = (
  leader = "a",
  events: SpectatorEvent[] = [],
  extra: Partial<SpectatorData> = {},
): SpectatorData => ({
  contest: {
    id: "cup",
    title: "Cup",
    starts_at: new Date(now - 3600000).toISOString(),
    ends_at: new Date(now + 3600000).toISOString(),
  },
  started: true,
  frozen: false,
  cutoff: new Date(now).toISOString(),
  stats: { teams: 2, challenges: 1, solves: 1, attacks: 0 },
  leaders: [
    {
      id: leader,
      name: leader.toUpperCase(),
      rank: 1,
      score: 100,
      solves: 1,
      group_name: null,
    },
  ],
  challenges: [],
  events,
  groups: [],
  ...extra,
});

test("spectator highlights announce fresh first bloods and changed global leaders exactly once", () => {
  const tracker = new SpectatorHighlightTracker();
  assert.deepEqual(
    tracker.ingest(snapshot("a", [blood("initial")]), false, now),
    [],
  );
  const frame = snapshot("b", [
    blood("next"),
    blood("initial"),
    blood("second", { blood_rank: 2 }),
    blood("attack", { type: "attack" }),
    blood("unknown", { team_id: null }),
    blood("stale", { created_at: new Date(now - 30000).toISOString() }),
  ]);
  const items = tracker.ingest(frame, true, now);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["blood", "leader"],
  );
  assert.equal(items[0]!.kind === "blood" && items[0]!.partTitle, "Part 2");
  assert.equal(items[1]!.teamId, "b");
  assert.deepEqual(tracker.ingest(frame, true, now), []);
  assert.deepEqual(
    tracker.ingest(snapshot("b"), true, now),
    [],
    "same team scoring again is not a lead change",
  );
  const back = tracker.ingest(snapshot("a"), true, now);
  assert.equal(back[0]!.kind, "leader");
  assert.notEqual(back[0]!.id, items[1]!.id);
});

test("reconnection, freeze transitions, zero scores and ended matches cannot replay highlights", () => {
  const tracker = new SpectatorHighlightTracker();
  tracker.ingest(snapshot(), false, now);
  const reconnect = snapshot("b", [blood("reconnect")]);
  assert.deepEqual(tracker.ingest(reconnect, false, now), []);
  assert.deepEqual(tracker.ingest(reconnect, true, now), []);
  assert.deepEqual(
    tracker.ingest(
      snapshot("a", [blood("frozen")], { frozen: true }),
      true,
      now,
    ),
    [],
  );
  assert.deepEqual(
    tracker.ingest(snapshot("b", [blood("unfreeze")]), true, now),
    [],
  );
  assert.deepEqual(
    tracker.ingest(snapshot("b", [blood("unfreeze")]), true, now),
    [],
  );
  assert.equal(
    tracker.ingest(snapshot("a", [blood("after")]), true, now).length,
    2,
  );
  assert.deepEqual(
    tracker.ingest(snapshot("b", [blood("ended")]), true, now + 3600001),
    [],
  );
  const empty = new SpectatorHighlightTracker();
  empty.ingest(snapshot("a", [], { leaders: [] }), false, now);
  assert.deepEqual(empty.ingest(snapshot("a"), true, now), []);
  const zero = new SpectatorHighlightTracker();
  const data = snapshot();
  data.leaders[0]!.score = 0;
  zero.ingest(data, false, now);
  assert.deepEqual(zero.ingest(snapshot("b"), true, now), []);
});

test("highlight bursts retain the active event, replace queued leaders and expire old notices", () => {
  const item = (
    id: string,
    kind: "blood" | "leader" = "blood",
  ): SpectatorHighlight =>
    ({
      id,
      kind,
      teamId: id,
      teamName: id,
      createdAt: now,
      ...(kind === "blood"
        ? { challengeTitle: "Web", partTitle: null }
        : { score: 100 }),
    }) as SpectatorHighlight;
  const active = item("active"),
    oldLeader = item("old", "leader"),
    leader = item("new", "leader");
  assert.deepEqual(
    enqueueSpectatorHighlights([active, oldLeader], [active, leader], now),
    [active, leader],
  );
  const burst = enqueueSpectatorHighlights(
    [active],
    Array.from({ length: 20 }, (_, i) => item(`e${i}`)),
    now,
  );
  assert.equal(burst.length, 5);
  assert.equal(burst[0], active);
  assert.deepEqual(
    enqueueSpectatorHighlights([], [item("expired")], now + 20001),
    [],
  );
});
