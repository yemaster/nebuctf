import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("operation activity advances, completes only after success, dismisses, and restarts", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { OperationProgress } =
    await import("../src/components/operation-progress");
  const { Progress } = await import("../src/components/ui/progress");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 100000,
  });
  const render = async (busy: boolean, failed = false, showLifetime = false) =>
    act(async () => {
      root.render(
        <OperationProgress
          busy={busy}
          failed={failed}
          label="正在续期"
          completeLabel="续期完成"
          idle={
            showLifetime ? (
              <Progress aria-label="靶机剩余时间" value={70} />
            ) : null
          }
        />,
      );
    });
  const advance = async (ms: number) =>
    act(async () => {
      t.mock.timers.tick(ms);
    });
  const position = () =>
    container
      .querySelector('[data-slot="progress-indicator"]')
      ?.getAttribute("style");
  try {
    await render(true);
    const initial = position();
    await advance(6000);
    assert.notEqual(position(), initial);
    assert.equal(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
      null,
    );
    assert.ok(!container.textContent!.includes("续期完成"));
    await render(false);
    await advance(1);
    assert.equal(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
      "100",
    );
    assert.ok(container.textContent!.includes("续期完成"));
    await advance(900);
    assert.equal(container.querySelector('[role="progressbar"]'), null);
    await render(true);
    assert.equal(position(), initial);
    await advance(1000);
    await render(false, true);
    await advance(1);
    assert.ok(!container.textContent!.includes("续期完成"));
    await advance(300);
    assert.equal(container.querySelector('[role="progressbar"]'), null);

    // A ready resource renders its lifetime immediately, but never alongside an operation.
    const lifetime = () =>
      container.querySelector('[aria-label="靶机剩余时间"]');
    const onlyOperation = () => {
      assert.equal(
        container.querySelectorAll('[role="progressbar"]').length,
        1,
      );
      assert.equal(lifetime(), null);
    };
    await render(false, false, true);
    assert(lifetime());
    await render(true, false, true);
    onlyOperation();
    await advance(100);
    await render(false, false, true);
    await advance(400);
    onlyOperation();
    assert(container.textContent!.includes("续期完成"));
    await advance(849);
    onlyOperation();
    await advance(1);
    assert(lifetime());

    // Starting another operation during the exit animation resets its progress.
    await render(true, false, true);
    await advance(600);
    await render(false, false, true);
    await advance(601);
    onlyOperation();
    await render(true, false, true);
    assert.equal(position(), initial);
    onlyOperation();
    await advance(600);
    await render(false, false, true);
    await advance(1);
    await render(false, true, true);
    await advance(1);
    await advance(250);
    assert(
      lifetime(),
      "a changed result cannot leave the completion animation stuck",
    );
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
    dom.window.close();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
