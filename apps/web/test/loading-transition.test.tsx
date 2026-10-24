import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForReveal } from "../src/lib/view-transition";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("ready content never flashes a loading indicator after expansion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const animation = deferred(),
    content = deferred();
  let shown = 0,
    revealed = false;
  const work = waitForReveal(
    animation.promise,
    content.promise,
    new AbortController().signal,
    () => shown++,
  ).then(() => {
    revealed = true;
  });
  content.resolve();
  await flush();
  t.mock.timers.tick(2000);
  assert.equal(
    revealed,
    false,
    "ready data still respects the expansion duration",
  );
  animation.resolve();
  await work;
  assert.equal(shown, 0);
});

test("near-ready requests skip the spinner while slow ones hand it over without a one-frame flash", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const slow of [false, true]) {
    const content = deferred();
    let shown = 0,
      revealed = false;
    const work = waitForReveal(
      Promise.resolve(),
      content.promise,
      new AbortController().signal,
      () => shown++,
    ).then(() => {
      revealed = true;
    });
    await flush();
    t.mock.timers.tick(slow ? 120 : 100);
    assert.equal(shown, slow ? 1 : 0);
    content.resolve();
    await flush();
    if (slow) {
      assert.equal(revealed, false);
      t.mock.timers.tick(239);
      await flush();
      assert.equal(
        revealed,
        false,
        "visible loading state is not removed immediately",
      );
      t.mock.timers.tick(1);
    }
    await work;
    assert.equal(shown, slow ? 1 : 0);
  }
});

test("leaving cancels loading delays and cannot display a late spinner", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const phase of ["animation", "grace", "visible"]) {
    const animation = deferred(),
      content = deferred(),
      controller = new AbortController();
    let shown = 0;
    const work = waitForReveal(
      animation.promise,
      content.promise,
      controller.signal,
      () => shown++,
    );
    if (phase !== "animation") animation.resolve();
    await flush();
    if (phase === "visible") {
      t.mock.timers.tick(120);
      content.resolve();
      await flush();
    }
    controller.abort();
    await work;
    const before = shown;
    t.mock.timers.tick(2000);
    animation.resolve();
    content.resolve();
    await flush();
    assert.equal(shown, before);
  }
});
