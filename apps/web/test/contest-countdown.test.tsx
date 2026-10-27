import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import {
  contestCountdown,
  countdownTone,
  timeWindowTone,
  type ContestClock,
} from "../src/lib/contest-clock";

const epoch = Date.parse("2026-10-26T10:00:00Z");
const at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
const clock: ContestClock = {
  server_time: at(0),
  starts_at: at(0),
  ends_at: at(1000),
  freeze_at: at(600),
  practice: false,
  rounds: {
    opens_at: at(0),
    closes_at: at(1000),
    interval: 300,
    total: 4,
    active_from: null,
  },
};

test("time colors follow start, warning, urgent and end boundaries", () => {
  const tone = (seconds: number) => timeWindowTone(0, 3600000, seconds * 1000);
  assert.equal(tone(-1), "scheduled");
  assert.equal(tone(0), "running");
  assert.equal(tone(2999), "running");
  assert.equal(tone(3000), "warning");
  assert.equal(tone(3539), "warning");
  assert.equal(tone(3540), "urgent");
  assert.equal(tone(3599), "urgent");
  assert.equal(tone(3600), "muted");
  assert.equal(tone(3601), "muted");
  assert.equal(timeWindowTone(0, 0, 0), "muted");
  assert.equal(timeWindowTone(NaN, 3600000, 0), "muted");
});

test("short windows scale alerts while overview color remains independent of rounds", () => {
  assert.equal(timeWindowTone(0, 20000, 0), "running");
  assert.equal(timeWindowTone(0, 20000, 15999), "running");
  assert.equal(timeWindowTone(0, 20000, 16000), "warning");
  assert.equal(timeWindowTone(0, 20000, 18000), "urgent");
  const now = epoch + 299000;
  assert.equal(countdownTone(clock, now), "urgent");
  assert.equal(
    timeWindowTone(Date.parse(clock.starts_at), Date.parse(clock.ends_at), now),
    "running",
  );
  assert.equal(countdownTone(clock, epoch + 300000), "running");
  assert.equal(countdownTone({ ...clock, practice: true }, now), "muted");
});

test("countdown follows the shared round boundary including a shorter final round", () => {
  const countdown = (seconds: number) =>
    contestCountdown(clock, epoch + seconds * 1000);
  assert.deepEqual(countdown(299), { label: "第 1 / 4 轮", remaining: 1000 });
  assert.deepEqual(countdown(300), { label: "第 2 / 4 轮", remaining: 300000 });
  assert.deepEqual(countdown(900), { label: "第 4 / 4 轮", remaining: 100000 });
  assert.deepEqual(countdown(1000), { label: "比赛已结束", remaining: 0 });
  assert.deepEqual(countdown(1200), { label: "比赛已结束", remaining: 0 });
  assert.deepEqual(countdown(-60), { label: "距离开赛", remaining: 60000 });
  assert.deepEqual(
    contestCountdown(
      { ...clock, rounds: { ...clock.rounds!, active_from: at(600) } },
      epoch + 350000,
    ),
    { label: "第 2 / 4 轮", remaining: 250000 },
  );
});

test("ordinary contests, delayed rounds and practice do not show a misleading round timer", () => {
  assert.deepEqual(
    contestCountdown({ ...clock, rounds: null }, epoch + 700000),
    {
      label: "比赛剩余",
      remaining: 300000,
    },
  );
  const delayed = {
    ...clock,
    rounds: {
      ...clock.rounds!,
      opens_at: at(300),
      closes_at: at(900),
      total: 2,
    },
  };
  assert.deepEqual(contestCountdown(delayed, epoch + 200000), {
    label: "轮次开始",
    remaining: 100000,
  });
  assert.deepEqual(contestCountdown(delayed, epoch + 950000), {
    label: "比赛剩余",
    remaining: 50000,
  });
  assert.deepEqual(
    contestCountdown({ ...clock, practice: true }, epoch + 1100000),
    { label: "赛后练习", remaining: 0 },
  );
});

test("the countdown corrects client time and advances to the next round without a request", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { ContestCountdown } =
    await import("../src/components/contest-countdown");
  const root = createRoot(document.getElementById("root")!);
  // The local clock is one day ahead; the server is one second before round 2.
  const receivedAt = epoch + 86400000;
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: receivedAt });
  try {
    await act(async () =>
      root.render(
        <ContestCountdown
          clock={{ ...clock, server_time: at(299) }}
          receivedAt={receivedAt}
        />,
      ),
    );
    assert.match(
      document.querySelector('[role="timer"]')!.textContent!,
      /第 1 \/ 4 轮00:00:01/,
    );
    await act(async () => t.mock.timers.tick(1000));
    assert.match(
      document.querySelector('[role="timer"]')!.textContent!,
      /第 2 \/ 4 轮00:05:00/,
    );
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(document.querySelector("time")!.textContent, "00:04:59");
    await act(async () =>
      root.render(
        <ContestCountdown
          clock={{ ...clock, practice: true }}
          receivedAt={receivedAt}
        />,
      ),
    );
    assert.match(
      document.querySelector('[role="timer"]')!.textContent!,
      /赛后练习00:00:00/,
    );
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
