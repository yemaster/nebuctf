import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("error pages recover through browser history and safe direct-link fallbacks", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
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
  const { BrowserRouter, Link, useLocation } = await import("react-router-dom");
  const { PageBoundary, StatusPage } =
    await import("../src/components/status-page");
  const host = document.getElementById("root")!;
  const caught: unknown[] = [];
  let root: ReturnType<typeof createRoot> | undefined;
  let retries = 0;

  function Content() {
    const location = useLocation();
    if (location.pathname.endsWith("/old-chunk"))
      throw new TypeError(
        "Failed to fetch dynamically imported module: /assets/old.js",
      );
    if (location.pathname.endsWith("/broken"))
      throw Error("test render failure");
    if (location.pathname.endsWith("/unavailable"))
      return <StatusPage status={503} retry={() => retries++} />;
    return <input aria-label="Draft" defaultValue="unsaved" />;
  }
  function Harness() {
    const location = useLocation();
    return (
      <>
        <output>{location.pathname + location.search + location.hash}</output>
        <Link to="/admin/challenges/broken">Broken editor</Link>
        <Link to="/admin/challenges/unavailable">Unavailable editor</Link>
        <Link to="/admin/challenges?page=3">Next page</Link>
        <PageBoundary>
          <Content />
        </PageBoundary>
      </>
    );
  }
  async function mount(path: string) {
    if (root) await act(async () => root!.unmount());
    // A direct entry has no in-app predecessor even if the tab has old history.
    window.history.replaceState({ idx: 0 }, "", path);
    root = createRoot(host, { onCaughtError: (error) => caught.push(error) });
    await act(async () =>
      root!.render(
        <BrowserRouter>
          <Harness />
        </BrowserRouter>,
      ),
    );
  }
  async function click(label: string) {
    const target = [...host.querySelectorAll<HTMLElement>("button, a")].find(
      (element) => element.textContent?.trim() === label,
    );
    assert.ok(target, label);
    await act(async () => target.click());
  }
  async function expectPath(path: string) {
    const deadline = Date.now() + 2000;
    while (
      host.querySelector("output")?.textContent !== path &&
      Date.now() < deadline
    )
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    assert.equal(host.querySelector("output")?.textContent, path);
  }

  try {
    await t.test(
      "missing deployment chunks are reported as resource failures, not server errors",
      async () => {
        await mount("/old-chunk");
        assert.match(host.textContent!, /页面资源未能加载/);
        assert.match(host.textContent!, /503/);
        assert.doesNotMatch(host.textContent!, /500/);
        await click("返回上一页");
        await expectPath("/");
      },
    );
    await t.test(
      "returning from a render failure restores the filtered admin list",
      async () => {
        const list = "/admin/challenges?page=2&q=web#results";
        await mount(list);
        await click("Broken editor");
        assert.match(host.textContent!, /暂时无法加载/);
        assert.ok(caught.length > 0);
        await click("返回上一页");
        await expectPath(list);
        assert.ok(host.querySelector('input[aria-label="Draft"]'));
        assert.equal(host.querySelector('[role="alert"]'), null);
      },
    );

    await t.test(
      "request failures retain retry and can return to the previous page",
      async () => {
        await mount("/admin/challenges?page=4");
        await click("Unavailable editor");
        await click("重试");
        assert.equal(retries, 1);
        assert.equal(
          host.querySelector('a[href="/"]')?.textContent,
          "返回首页",
        );
        await click("返回上一页");
        await expectPath("/admin/challenges?page=4");
        assert.equal(host.querySelector('[role="alert"]'), null);
      },
    );

    await t.test(
      "direct links return to the site or contest without traversing unrelated history",
      async () => {
        const go = t.mock.method(window.history, "go", () => {
          assert.fail("direct entry must not traverse earlier browser history");
        });
        try {
          for (const [path, fallback] of [
            ["/admin/challenges/broken", "/"],
            ["/contests/demo/unavailable", "/contests/demo"],
          ]) {
            await mount(path!);
            await click("返回上一页");
            await expectPath(fallback!);
            assert.ok(host.querySelector("input"));
          }
          assert.equal(go.mock.callCount(), 0);
        } finally {
          go.mock.restore();
        }
      },
    );

    await t.test(
      "normal navigation preserves mounted content and unsaved input",
      async () => {
        await mount("/admin/challenges?page=2");
        const input = host.querySelector("input")!;
        input.value = "keep this draft";
        await click("Next page");
        await expectPath("/admin/challenges?page=3");
        assert.equal(host.querySelector("input"), input);
        assert.equal(input.value, "keep this draft");
      },
    );
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
