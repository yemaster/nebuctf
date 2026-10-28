import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contestCalendarRange,
  layoutContestCalendar,
  type ContestCalendarDay,
} from "../src/lib/contest-calendar";

test("contest bars keep their lane, span the week, and stop at three per day", () => {
  const events = [
    { id: "a", title: "A", first: "2026-09-29", last: "2026-10-01" },
    { id: "b", title: "B", first: "2026-09-30", last: "2026-10-09" },
    { id: "c", title: "C", first: "2026-10-01", last: "2026-10-02" },
    { id: "d", title: "D", first: "2026-10-02", last: "2026-10-06" },
    { id: "e", title: "E", first: "2026-10-02", last: "2026-10-03" },
  ];
  const input: ContestCalendarDay[] = Array.from({ length: 14 }, (_, n) => {
    const day = new Date(Date.UTC(2026, 8, 28 + n)).toISOString().slice(0, 10);
    const contests = events.filter((c) => c.first <= day && c.last >= day);
    return { day, contests, count: contests.length };
  });
  const result = layoutContestCalendar(input.reverse());
  for (const { lanes } of result.days.values()) {
    assert.equal(lanes.length, 3);
    const shown = lanes.filter((c) => c !== null);
    assert(shown.length <= 3);
    assert.equal(new Set(shown.map((c) => c.color)).size, shown.length);
    if (shown.some((c) => c.id === "b")) assert.equal(lanes[1]?.id, "b");
  }
  assert.equal(result.days.get("2026-10-02")?.count, 4);
  assert.deepEqual(
    result.days.get("2026-10-02")?.lanes.map((c) => c?.id),
    ["d", "b", "c"],
  );
  const segments = [...result.bars].flatMap(([day, bars]) =>
    bars.filter((b) => b.id === "b").map((b) => ({ day, ...b })),
  );
  assert.equal(
    segments.length,
    2,
    "one whole element per week, not one per date",
  );
  assert.deepEqual(
    segments.map((b) => [b.day, b.length, b.starts, b.ends]),
    [
      ["2026-09-30", 5, true, false],
      ["2026-10-05", 5, false, true],
    ],
  );
  assert.equal(segments[0]!.color, segments[1]!.color);
  for (const [key, { lanes }] of result.days) {
    const date = Date.parse(`${key}T00:00:00Z`);
    const covering = [...result.bars].flatMap(([start, bars]) =>
      bars.filter((b) => {
        const offset = (date - Date.parse(`${start}T00:00:00Z`)) / 86400000;
        return offset >= 0 && offset < b.length;
      }),
    );
    assert.equal(covering.length, lanes.filter(Boolean).length);
    assert.equal(new Set(covering.map((c) => c.lane)).size, covering.length);
  }
});

test("calendar handles duplicate events, empty days and single-day contests", () => {
  const a = { id: "a", title: "A" };
  const { days, bars } = layoutContestCalendar([
    { day: "2026-10-01", count: 1, contests: [a, a] },
    { day: "2026-10-02", count: 0 },
    { day: "2026-10-03", count: 1, contests: [a] },
  ]);
  assert.equal(days.get("2026-10-01")?.lanes.filter(Boolean).length, 1);
  assert.equal(bars.has("2026-10-02"), false);
  for (const key of ["2026-10-01", "2026-10-03"]) {
    const bar = bars.get(key)![0]!;
    assert.equal(bar.length, 1);
    assert.equal(bar.starts, true);
    assert.equal(bar.ends, true);
  }
});

test("calendar queries complete Monday–Sunday grids across months and leap years within 42 days", () => {
  assert.deepEqual(contestCalendarRange(new Date(2026, 9, 1)), {
    from: "2026-09-28",
    to: "2026-11-01",
  });
  assert.deepEqual(contestCalendarRange(new Date(2026, 2, 1)), {
    from: "2026-02-23",
    to: "2026-04-05",
  });
  for (const year of [2024, 2026])
    for (let month = 0; month < 12; month++) {
      const range = contestCalendarRange(new Date(year, month, 1));
      assert.equal(new Date(range.from).getUTCDay(), 1);
      assert.equal(new Date(range.to).getUTCDay(), 0);
      assert(Date.parse(range.to) - Date.parse(range.from) <= 41 * 86400000);
      assert(range.from <= `${year}-${String(month + 1).padStart(2, "0")}-01`);
    }
});
