import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act, lazy, Suspense } from "react";
import { JSDOM } from "jsdom";

test("account loading preserves one surface through chunk and data readiness", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  dom.window.matchMedia = (() => ({
    matches: true,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    requestAnimationFrame: (fn: FrameRequestCallback) =>
      setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { LazyMotion, domAnimation } = await import("motion/react");
  const { LoadingBoundary, LoadingFallback, useLoadingState } =
    await import("../src/components/loading-transition");
  const host = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot>;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  function Page({ pending }: { pending: boolean }) {
    useLoadingState(pending);
    return <input aria-label="草稿" defaultValue="未提交" />;
  }
  const render = async (content: React.ReactNode) => {
    if (!root) root = createRoot(host);
    await act(async () =>
      root.render(
        <LazyMotion features={domAnimation}>
          <LoadingBoundary>{content}</LoadingBoundary>
        </LazyMotion>,
      ),
    );
  };
  const tick = async (ms: number) => {
    await act(async () => t.mock.timers.tick(ms));
  };
  const busy = () =>
    host.querySelector("[aria-busy]")!.getAttribute("aria-busy");
  try {
    await t.test(
      "fast data never paints a spinner and retains the input",
      async () => {
        await render(<Page pending />);
        const input = host.querySelector("input")!;
        input.value = "保留答案";
        await tick(80);
        await render(<Page pending={false} />);
        await tick(400);
        assert.equal(busy(), "false");
        assert.equal(host.querySelector('[role="status"]'), null);
        assert.equal(host.querySelector("input"), input);
        assert.equal(input.value, "保留答案");
      },
    );
    await t.test(
      "a slow chunk hands its visible spinner to slow data without restarting",
      async () => {
        let resolve!: (module: { default: typeof Page }) => void;
        const Chunk = lazy(
          () =>
            new Promise<{ default: typeof Page }>((done) => {
              resolve = done;
            }),
        );
        const content = (pending: boolean) => (
          <Suspense fallback={<LoadingFallback />}>
            <Chunk pending={pending} />
          </Suspense>
        );
        await render(content(true));
        await tick(120);
        const spinner = host.querySelector('[role="status"]');
        assert.ok(spinner);
        await tick(20);
        await act(async () => resolve({ default: Page }));
        assert.equal(host.querySelector('[role="status"]'), spinner);
        assert.equal(busy(), "true");
        await render(content(false));
        await tick(219);
        assert.equal(
          busy(),
          "true",
          "visible loading keeps its minimum duration",
        );
        await tick(1);
        assert.equal(busy(), "false");
        assert.equal(
          host.querySelector("input")!.closest('[aria-hidden="true"]'),
          null,
        );
      },
    );
    await t.test("a new wait cancels a pending reveal", async () => {
      await render(<Page pending />);
      await tick(120);
      await render(<Page pending={false} />);
      await tick(40);
      await render(<Page pending />);
      await tick(400);
      assert.equal(busy(), "true");
      await render(<Page pending={false} />);
      await tick(0);
      assert.equal(busy(), "false");
    });
  } finally {
    await act(async () => root?.unmount());
    t.mock.timers.reset();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
