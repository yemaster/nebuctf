import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("floating contest activity respects access, collapse state and new events", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(dom.window, {
    scrollTo() {},
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  const historyRequests: string[] = [];
  const historyPages = new Map<string, unknown>();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    readyState = 1;
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    publish(data: unknown) {
      this.onmessage?.({ data: JSON.stringify({ type: "activity", data }) });
    }
  }
  Object.defineProperty(dom.window, "WebSocket", { value: FakeSocket });
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => {
      historyRequests.push(url);
      return new Response(
        JSON.stringify(historyPages.get(url) ?? { error: "暂时不可用" }),
        {
          status: historyPages.has(url) ? 200 : 503,
          headers: { "content-type": "application/json" },
        },
      );
    },
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
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
  const { ContestActivity } =
    await import("../src/components/contest-activity");
  const { LazyMotion, domAnimation } = await import("motion/react");
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  const root = createRoot(document.getElementById("root")!);
  const scope = "20000000-0000-4000-8000-000000000001",
    path = `/contests/${scope}/activity`;
  const contest = {
    id: scope,
    registered: true,
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 120000).toISOString(),
  };
  const user = {
    id: "player",
    username: "选手",
    email: "player@example.test",
    role: "user" as const,
  };
  const release = {
    id: "event-1",
    type: "release",
    challenge_id: "challenge",
    challenge_title: "新上线题",
    team_name: null,
    part_title: null,
    blood_rank: null,
    created_at: new Date().toISOString(),
  };
  cache.setQueryData([`/contests/${scope}`], contest);
  cache.setQueryData([path], { items: [release], frozen: false });
  const mount = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <LazyMotion features={domAnimation}>
              <ContestActivity scope={scope} user={user} />
            </LazyMotion>
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  const press = async (label: string) =>
    act(async () => {
      const button = document.querySelector(`button[aria-label="${label}"]`);
      assert.ok(button);
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  const settle = async (check: () => boolean) => {
    for (let n = 0; n < 30 && !check(); n++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    assert.ok(check());
  };
  try {
    await mount();
    assert.ok(document.querySelector('[aria-label="展开比赛动态"]'));
    assert.equal(
      sockets[0]!.url,
      `ws://localhost/api/contests/${scope}/activity/ws`,
    );
    const content = document.querySelector(
      '[data-slot="collapsible-content"]',
    )!;
    assert.ok(content.hasAttribute("inert"));
    assert.equal(content.getAttribute("aria-hidden"), "true");
    await press("展开比赛动态");
    assert.ok(!content.hasAttribute("inert"));
    assert.ok(document.body.textContent?.includes("新上线题"));
    assert.ok(document.querySelector('a[href$="?challenge=challenge"]'));
    assert.equal(
      localStorage.getItem(`nebuctf-activity:player:${scope}`),
      "open",
    );
    await press("收起比赛动态");
    assert.equal(
      document.querySelector('[data-slot="collapsible-content"]'),
      content,
    );
    assert.ok(content.hasAttribute("inert"));
    // Reversing mid-animation keeps the same body and scroll viewport mounted.
    await press("展开比赛动态");
    await press("收起比赛动态");
    assert.equal(
      document.querySelector('[data-slot="collapsible-content"]'),
      content,
    );
    const solve = {
      ...release,
      id: "event-2",
      type: "solve",
      challenge_title: "分步题",
      team_name: "测试战队",
      part_title: "第一步",
      blood_rank: 1,
    };
    await act(async () => {
      cache.setQueryData([path], { items: [solve, release], frozen: false });
    });
    await settle(() => !!document.querySelector('[aria-label="1 条新动态"]'));
    const hint = {
      ...release,
      id: "hint-1",
      type: "hint",
      created_at: new Date(Date.now() + 1000).toISOString(),
    };
    await act(async () =>
      sockets[0]!.publish({
        items: [hint, solve, release],
        frozen: false,
        hint_updates: [hint],
      }),
    );
    await settle(() => !!document.querySelector('[aria-label="1 条新提示"]'));
    await act(async () =>
      sockets[0]!.publish({
        items: [hint, solve, release],
        frozen: false,
        hint_updates: [hint],
      }),
    );
    assert.equal(document.querySelector('[aria-label="2 条新提示"]'), null);
    const protectedPaths = [
      `/challenges?scope=${scope}`,
      `/challenges/example?scope=${scope}`,
      `/scoreboard?scope=${scope}`,
      `/instances?scope=${scope}`,
    ];
    for (const key of protectedPaths)
      cache.setQueryData([key], { stale: false });
    await act(async () =>
      sockets[0]!.publish({
        items: [hint, solve, release],
        frozen: false,
        hint_updates: [hint],
        permissions_version: "changed-without-a-new-event",
      }),
    );
    for (const key of protectedPaths)
      assert.equal(cache.getQueryState([key])!.isInvalidated, true, key);
    await press("展开比赛动态");
    assert.equal(document.querySelector('[aria-label="1 条新提示"]'), null);
    assert.ok(document.body.textContent?.includes("新增提示"));
    assert.ok(document.body.textContent?.includes("一血"));
    assert.ok(document.body.textContent?.includes("测试战队"));
    assert.ok(document.body.textContent?.includes("第一步"));
    assert.equal(document.querySelector('[aria-label="1 条新动态"]'), null);
    await act(async () => {
      cache.setQueryData([path], { items: [release], frozen: true });
    });
    await settle(() => !!document.querySelector('[aria-label="已封榜"]'));
    assert.ok(!document.body.textContent?.includes("测试战队"));
    const events = Array.from({ length: 23 }, (_, i) => ({
      ...solve,
      id: `paged-${i}`,
      challenge_title: `历史题目 ${i}`,
      blood_rank: null,
    }));
    const page1 = {
      items: events.slice(0, 10),
      frozen: false,
      has_more: true,
      next_cursor: "older-10",
    };
    const olderPath = `/api${path}/history?kind=all&cursor=older-10`;
    historyPages.set(olderPath, {
      items: events.slice(10, 20),
      frozen: false,
      has_more: true,
      next_cursor: "older-20",
    });
    historyPages.set(`/api${path}/history?kind=all&cursor=older-20`, {
      items: events.slice(20),
      frozen: false,
      has_more: false,
      next_cursor: null,
    });
    historyPages.set(`/api${path}/history?kind=solve`, page1);
    historyPages.set(`/api${path}/history?kind=blood`, {
      items: [],
      frozen: false,
      has_more: false,
      next_cursor: null,
    });
    const rows = () => [
      ...document.querySelectorAll('[aria-label="近期比赛动态"] > li'),
    ];
    await act(async () => cache.setQueryData([path], page1));
    await settle(() => rows().length === 10);
    assert.equal(
      historyRequests.length,
      0,
      "latest all-events page reuses the live feed",
    );
    await press("下一页");
    await settle(
      () => rows()[0]?.textContent?.includes("历史题目 10") === true,
    );
    assert.equal(rows().length, 10);
    const requests = historyRequests.length;
    await act(async () =>
      sockets[0]!.publish({
        ...page1,
        items: [
          { ...solve, id: "new-solve", challenge_title: "最新解出" },
          ...page1.items.slice(0, 9),
        ],
      }),
    );
    await settle(() => !!document.querySelector('[aria-label="1 条新动态"]'));
    assert.equal(
      historyRequests.length,
      requests,
      "new events do not refetch or move historical pages",
    );
    assert.ok(rows()[0]!.textContent?.includes("历史题目 10"));
    await press("下一页");
    await settle(() => rows().length === 3);
    assert.ok(
      (document.querySelector('[aria-label="下一页"]') as HTMLButtonElement)
        .disabled,
    );
    await press("上一页");
    await settle(() => rows().length === 10);
    await press("查看最新动态");
    assert.ok(rows()[0]!.textContent?.includes("最新解出"));
    assert.equal(document.querySelector('[aria-label="1 条新动态"]'), null);
    const tab = async (label: string) =>
      act(async () => {
        const target = [...document.querySelectorAll('[role="tab"]')].find(
          (el) => el.textContent === label,
        )!;
        target.dispatchEvent(
          new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
      });
    await tab("解题");
    await settle(
      () =>
        historyRequests.includes(`/api${path}/history?kind=solve`) &&
        rows().length === 10,
    );
    assert.equal(
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      "解题",
    );
    await tab("三血");
    await settle(
      () => document.body.textContent?.includes("暂无比赛动态") === true,
    );
    assert.ok(
      (document.querySelector('[aria-label="下一页"]') as HTMLButtonElement)
        .disabled,
    );
    await tab("题目");
    await settle(() => !!document.querySelector('[role="alert"]'));
    historyPages.set(`/api${path}/history?kind=challenge`, {
      items: [release],
      frozen: false,
      has_more: false,
      next_cursor: null,
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((el) => el.textContent === "重试")!
        .click();
    });
    await settle(
      () => rows().length === 1 && !document.querySelector('[role="alert"]'),
    );
    await press("收起比赛动态");
    const closedRequests = historyRequests.length;
    await act(async () =>
      sockets[0]!.publish({
        ...page1,
        items: [{ ...release, id: "new-release" }, ...page1.items.slice(0, 9)],
      }),
    );
    assert.equal(
      historyRequests.length,
      closedRequests,
      "collapsed category does not fetch history",
    );
    await press("展开比赛动态");
    await settle(() => historyRequests.length > closedRequests);
    // A permission change clears older cached pages, even when their IDs are absent from the live ten.
    await act(async () =>
      sockets[0]!.publish({ ...page1, permissions_version: "revised-access" }),
    );
    assert.equal(cache.getQueryData([olderPath.slice(4)]), undefined);
    await tab("全部");
    await act(async () => {
      cache.setQueryData([`/contests/${scope}`], {
        ...contest,
        registered: false,
      });
    });
    await settle(() => !document.querySelector('[aria-label="比赛动态"]'));
    await act(async () => {
      cache.setQueryData([`/contests/${scope}`], contest);
    });
    await settle(() => !!document.querySelector('[aria-label="收起比赛动态"]'));
    await press("收起比赛动态");
    assert.equal(
      localStorage.getItem(`nebuctf-activity:player:${scope}`),
      "closed",
    );
  } finally {
    await act(async () => root.unmount());
    cache.clear();
    for (const [key, value] of original) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
