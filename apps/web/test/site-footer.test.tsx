import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("footer panels load on demand, respect contest access and keep personal resources scoped", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: globalThis.fetch,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { SiteFooter } = await import("../src/components/site-footer");
  const user = {
    id: "user",
    username: "player",
    email: "player@example.test",
    role: "user" as const,
  };
  let root: ReturnType<typeof createRoot> | undefined;
  let cache: InstanceType<typeof QueryClient>;
  const requests: string[] = [];
  let resourceError = false;
  globalThis.fetch = async (input) => {
    const path = String(input);
    requests.push(path);
    if (path === "/api/stats")
      return Response.json({
        challenges: 12,
        contests: 0,
        teams: 3,
        solves: 42,
      });
    if (path === "/api/instances?scope=cup&owned=true") {
      if (resourceError)
        return Response.json({ error: "环境暂不可用" }, { status: 503 });
      return Response.json({
        items: [
          {
            id: "mine",
            shared: false,
            kind: "dynamic_container",
            status: "running",
          },
          {
            id: "public",
            shared: true,
            kind: "static_container",
            status: "running",
          },
          {
            id: "file",
            shared: false,
            kind: "dynamic_attachment",
            status: "ready",
          },
          {
            id: "pending",
            shared: false,
            kind: "dynamic_container",
            status: "starting",
          },
          {
            id: "failed",
            shared: false,
            kind: "dynamic_container",
            status: "failed",
          },
        ],
      });
    }
    throw Error(`Unexpected footer request: ${path}`);
  };
  const contest = (registered: boolean) => ({
    id: "cup",
    title: "测试赛",
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    teams: 0,
    registered,
    registration: registered
      ? { team_name: "ALPHA", group_name: "公开组", status: "accepted" }
      : null,
  });
  async function mount(
    authenticated: boolean,
    cup?: ReturnType<typeof contest>,
  ) {
    requests.length = 0;
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      },
    });
    if (cup) cache.setQueryData(["/contests/cup"], cup);
    root = createRoot(document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <SiteFooter
              user={authenticated ? user : null}
              contestId={cup?.id}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  }
  async function cleanup() {
    if (root) {
      await act(async () => root!.unmount());
      root = undefined;
    }
    cache?.clear();
  }
  async function click(label: string) {
    const button = document.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button, label);
    await act(async () =>
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
  }
  async function settle(predicate: () => boolean) {
    for (let i = 0; i < 50 && !predicate(); i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    assert.ok(predicate());
  }
  const value = (label: string) =>
    Array.from(document.querySelectorAll("dt")).find(
      (node) => node.textContent === label,
    )?.nextElementSibling?.textContent;
  try {
    await t.test(
      "anonymous platform overview fetches only when opened and renders real zero counts",
      async () => {
        await mount(false);
        try {
          assert.deepEqual(requests, []);
          assert.equal(
            document.querySelector('button[aria-label="我的环境"]'),
            null,
          );
          await click("平台概况");
          await settle(
            () => !!document.querySelector('nav[aria-label="平台数据"]'),
          );
          assert.deepEqual(requests, ["/api/stats"]);
          assert.equal(
            document.querySelector(
              'nav[aria-label="平台数据"] a[href="/contests"]',
            )?.textContent,
            "当前赛事0",
          );
          const row = document.querySelector(
            'nav[aria-label="平台数据"] a[href="/challenges"]',
          )!;
          await act(async () =>
            row.dispatchEvent(
              new dom.window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
          await settle(() => !document.querySelector('[role="dialog"]'));
        } finally {
          await cleanup();
        }
      },
    );
    await t.test(
      "unregistered contest visitors see only this contest and no resource request",
      async () => {
        await mount(true, contest(false));
        try {
          assert.deepEqual(requests, []);
          assert.equal(
            document.querySelector('button[aria-label="平台概况"]'),
            null,
          );
          assert.equal(
            document.querySelector('button[aria-label="我的环境"]'),
            null,
          );
          assert.equal(
            document.querySelector('a[href="/announcements"]'),
            null,
          );
          const menu = document.querySelector('button[aria-label="页脚导航"]')!;
          await act(async () =>
            menu.dispatchEvent(
              new dom.window.KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
              }),
            ),
          );
          assert.ok(
            document.querySelector('a[href="/contests/cup/announcements"]'),
          );
          assert.equal(
            document.querySelector('a[href="/announcements"]'),
            null,
          );
          await act(async () =>
            document
              .querySelector('[role="menu"]')!
              .dispatchEvent(
                new dom.window.KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                }),
              ),
          );
          assert.ok(
            document.querySelector(
              'nav[aria-label="底部工具"] a[href="/terminal"]',
            ),
          );
          assert.equal(
            document
              .querySelector('nav[aria-label="底部工具"] a[href="/terminal"]')
              ?.getAttribute("target"),
            "_blank",
          );
          assert.ok(document.querySelector('[aria-label^="赛程剩余"]'));
          await click("比赛信息");
          assert.equal(value("参赛状态"), "未报名");
          assert.equal(value("报名战队"), "0");
          assert.deepEqual(requests, []);
        } finally {
          await cleanup();
        }
      },
    );
    await t.test(
      "owned environments exclude public instances and errors replace stale counts",
      async () => {
        await mount(true, contest(true));
        try {
          assert.deepEqual(requests, []);
          await click("我的环境");
          await settle(() => value("运行靶机") === "1");
          assert.deepEqual(requests, ["/api/instances?scope=cup&owned=true"]);
          assert.equal(value("就绪附件"), "1");
          assert.equal(value("处理中"), "1");
          assert.equal(value("创建失败"), "1");
          assert.ok(
            document.querySelector('a[href="/contests/cup/instances"]'),
          );
          resourceError = true;
          await act(async () => {
            await cache.invalidateQueries({
              queryKey: ["/instances?scope=cup&owned=true"],
            });
          });
          await settle(() =>
            document.body.textContent!.includes("环境暂不可用"),
          );
          assert.equal(value("运行靶机"), undefined);
          assert.ok(
            document.querySelector('a[href="/contests/cup/instances"]'),
            "management remains available after a failed refresh",
          );
        } finally {
          resourceError = false;
          await cleanup();
        }
      },
    );
  } finally {
    await cleanup();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
