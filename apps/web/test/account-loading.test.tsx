import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act, lazy, Suspense } from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";

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
  const {
    LoadingBoundary,
    LoadingFallback,
    useLoadingState,
    PageLoadingBoundary,
  } = await import("../src/components/loading-transition");
  const { Loading } = await import("../src/components/shared");
  const host = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot>;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  function Page({ pending }: { pending: boolean }) {
    useLoadingState(pending);
    return <input aria-label="草稿" defaultValue="未提交" />;
  }
  const render = async (content: React.ReactNode, registered = false) => {
    if (!root) root = createRoot(host);
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/account?section=submissions"]}>
          <LazyMotion features={domAnimation}>
            {registered ? (
              <PageLoadingBoundary>{content}</PageLoadingBoundary>
            ) : (
              <LoadingBoundary>{content}</LoadingBoundary>
            )}
          </LazyMotion>
        </MemoryRouter>,
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
      "fast data never paints a skeleton and retains the input",
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
      "a slow chunk hands the submissions skeleton to slow data without restarting",
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
        const skeleton = host.querySelector('[role="status"]');
        assert.ok(skeleton);
        assert.equal(skeleton.getAttribute("data-skeleton"), "submissions");
        assert.equal(skeleton.getAttribute("aria-label"), "加载中");
        assert.ok(skeleton.querySelector('[data-slot="skeleton"]'));
        assert.equal(skeleton.querySelector("svg"), null);
        await tick(20);
        await act(async () => resolve({ default: Page }));
        assert.equal(host.querySelector('[role="status"]'), skeleton);
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
    await t.test(
      "shared full-page placeholders skip fast reads and keep ready content mounted",
      async () => {
        await render(<Loading fullPage />, true);
        await tick(80);
        await render(<input defaultValue="草稿" />, true);
        const input = host.querySelector("input")!;
        input.value = "保留内容";
        await tick(400);
        assert.equal(host.querySelector('[role="status"]'), null);
        assert.equal(busy(), "false");
        assert.equal(host.querySelector("input"), input);
        assert.equal(input.value, "保留内容");
      },
    );
    await t.test(
      "registered chunk and data placeholders hand over one skeleton and share its minimum duration",
      async () => {
        let resolve!: (module: { default: typeof DataPage }) => void;
        function DataPage({ pending }: { pending: boolean }) {
          return pending ? (
            <Loading fullPage />
          ) : (
            <input defaultValue="已加载" />
          );
        }
        const Chunk = lazy(
          () =>
            new Promise<{ default: typeof DataPage }>((done) => {
              resolve = done;
            }),
        );
        const content = (pending: boolean) => (
          <Suspense fallback={<Loading fullPage />}>
            <Chunk pending={pending} />
          </Suspense>
        );
        await render(content(true), true);
        await tick(119);
        assert.equal(host.querySelector('[role="status"]'), null);
        await tick(1);
        const skeleton = host.querySelector('[role="status"]');
        assert.ok(skeleton);
        await tick(20);
        await act(async () => resolve({ default: DataPage }));
        assert.equal(host.querySelector('[role="status"]'), skeleton);
        await render(content(false), true);
        assert.ok(host.querySelector("input")!.closest("[inert]"));
        await tick(219);
        assert.equal(busy(), "true");
        await tick(1);
        assert.equal(busy(), "false");
        assert.equal(host.querySelector("input")!.closest("[inert]"), null);
      },
    );
    await t.test(
      "multiple pending reads do not reveal early and leaving cancels the delayed skeleton",
      async () => {
        await render(
          <>
            <Loading key="first" fullPage />
            <Loading key="second" fullPage />
          </>,
          true,
        );
        await tick(120);
        await render(<Loading key="second" fullPage />, true);
        await tick(400);
        assert.equal(busy(), "true");
        await render(<div role="alert">读取失败</div>, true);
        await tick(0);
        assert.equal(busy(), "false");
        assert.equal(
          host.querySelector('[role="alert"]')!.closest("[inert]"),
          null,
        );
        await render(<Loading fullPage />, true);
        await tick(30);
        await act(async () => root.render(<div>下一页</div>));
        await tick(1000);
        assert.equal(host.textContent, "下一页");
        assert.equal(host.querySelector("[data-skeleton]"), null);
      },
    );
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
