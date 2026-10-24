import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { ScoreboardData } from "../src/lib/types";
import { scoreTimelineRows } from "../src/lib/scoreboard";

test("score timeline uses cumulative steps, merges simultaneous solves and stops at the cutoff", () => {
  const at = (n: number) => new Date(n * 1000).toISOString();
  const rows = scoreTimelineRows(
    [
      {
        id: "a",
        name: "A",
        score: 300,
        points: [
          { time: at(10), score: 100 },
          { time: at(10), score: 200 },
          { time: at(30), score: 300 },
        ],
      },
      {
        id: "b",
        name: "B",
        score: 150,
        points: [
          { time: at(20), score: 150 },
          { time: at(99), score: 999 },
        ],
      },
    ],
    at(0),
    at(40),
  );
  assert.deepEqual(rows, [
    { time: 0, team0: 0, team1: 0 },
    { time: 10000, team0: 200, team1: 0 },
    { time: 20000, team0: 200, team1: 150 },
    { time: 30000, team0: 300, team1: 150 },
    { time: 40000, team0: 300, team1: 150 },
  ]);
});

test("scoreboard filters, matrix, details and pagination", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(dom.window, {
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    scrollTo() {},
  });
  const measure = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (
      this.matches(
        '[data-slot="chart"], .recharts-responsive-container, .recharts-wrapper',
      )
    )
      return new dom.window.DOMRect(0, 0, 640, 300);
    if (this.matches(".recharts-legend-wrapper"))
      return new dom.window.DOMRect(0, 0, 640, 28);
    return measure.call(this);
  };
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    HTMLInputElement: dom.window.HTMLInputElement,
    FormData: dom.window.FormData,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  original.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { App } = await import("../src/App");
  const cid = "20000000-0000-4000-8000-000000000001",
    team = "10000000-0000-4000-8000-000000000001",
    group = "30000000-0000-4000-8000-000000000001";
  const now = new Date().toISOString();
  const columns = [
    {
      id: "p1",
      challenge_id: "c",
      title: "Web 闯关",
      part_title: "第一关",
      category: "Web",
      points: 100,
      solves: 2,
    },
    {
      id: "p2",
      challenge_id: "c",
      title: "Web 闯关",
      part_title: "第二关",
      category: "Web",
      points: 200,
      solves: 1,
    },
  ];
  const row = {
    id: team,
    rank: 1,
    overall_rank: 2,
    group_rank: 1,
    name: "Nebula",
    group_id: group,
    group_name: "公开组",
    score: 100,
    solves: 0,
    flags: 1,
    last_solve: now,
    cells: [{ unit_id: "p1", score: 100, solved_at: now, blood_rank: 1 }],
  };
  const base = {
    items: [row],
    columns,
    timeline: [],
    total: 31,
    participants: 31,
    challenge_count: 1,
    flag_count: 2,
    page: 1,
    page_size: 30,
    scope: cid,
    frozen: true,
    started: true,
    cutoff: now,
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  };
  let board: ScoreboardData = base,
    root: ReturnType<typeof createRoot> | undefined,
    cache: InstanceType<typeof QueryClient>;
  const requests: string[] = [];
  const categories = [
    "Web",
    "Pwn",
    "Reverse",
    "Crypto",
    "Misc",
    "Forensics",
  ].map((category) => ({
    category,
    score: category === "Web" ? 100 : 0,
    flags: category === "Web" ? 1 : 0,
  }));
  const detail = {
    ...base,
    ...row,
    categories,
    cells: row.cells.map((cell) => ({
      ...cell,
      solver_id: "alice",
      solver_name: "Alice",
    })),
    members: [
      {
        id: "alice",
        name: "Alice",
        current_member: true,
        score: 100,
        flags: 1,
        categories,
      },
      {
        id: "bob",
        name: "Bob",
        current_member: true,
        score: 0,
        flags: 0,
        categories: categories.map((c) => ({ ...c, score: 0, flags: 0 })),
      },
    ],
  };
  globalThis.fetch = async (input) => {
    const path = String(input).replace(/^\/api/, "");
    requests.push(path);
    if (path.startsWith("/scoreboard?")) return Response.json(board);
    if (path.startsWith(`/scoreboard/${team}?`)) return Response.json(detail);
    return Response.json({ items: [] });
  };
  const cleanup = async () => {
    await act(async () => root?.unmount());
    root = undefined;
    cache?.clear();
  };
  const mount = async (path: string) => {
    await cleanup();
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    });
    cache.setQueryData(["/me"], {
      user: { id: "player", username: "player", role: "user" },
    });
    cache.setQueryData([`/contests/${cid}`], {
      id: cid,
      title: "测试比赛",
      registered: true,
      registration: { team_id: team },
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      groups: [{ id: group, name: "公开组" }],
    });
    cache.setQueryData(["/contests"], { items: [] });
    cache.setQueryData([`/contests/${cid}/activity`], {
      items: [],
      frozen: true,
    });
    root = createRoot(document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  };
  const settle = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    assert.ok(check());
  };
  const click = async (element: Element) =>
    act(async () => {
      element.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  try {
    await t.test(
      "multipart matrix shows blood marks, missing flags and a team detail sheet",
      async () => {
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () => !!document.querySelector('[aria-label="战队排行榜"]'),
        );
        assert.ok(document.body.textContent?.includes("第一关"));
        assert.ok(document.body.textContent?.includes("第二关"));
        assert.ok(
          document.querySelector(
            '[aria-label="Nebula，Web 闯关 / 第一关，一血，100 分"]',
          ),
        );
        assert.ok(
          document.querySelector(
            '[aria-label="Nebula，Web 闯关 / 第二关，未解答"]',
          ),
        );
        assert.ok(document.querySelector('tr[data-self="true"]'));
        assert.ok(document.body.textContent?.includes("已封榜"));
        const rankOptions = document.querySelector(
          '[aria-label="排行榜组别"]',
        )!;
        assert.ok(rankOptions.textContent?.includes("全局排名"));
        assert.ok(rankOptions.textContent?.includes("公开组 / 组内排名"));
        assert.ok(
          !requests.some((path) => path.startsWith(`/scoreboard/${team}?`)),
        );
        await click(
          document.querySelector('[aria-label="查看Nebula的解题详情"]')!,
        );
        await settle(() => !!document.querySelector('[role="dialog"]'));
        await settle(() => !!document.querySelector('[aria-label="解题记录"]'));
        assert.ok(
          document
            .querySelector('[role="dialog"]')
            ?.textContent?.includes("Web 闯关 / 第一关"),
        );
        assert.equal(
          document.querySelector('[aria-label="解题记录"]')?.children.length,
          1,
        );
        assert.ok(
          document
            .querySelector('[aria-label="解题记录"]')
            ?.textContent?.includes("解答人 Alice"),
        );
        assert.ok(
          document
            .querySelector('[aria-label="队员贡献"]')
            ?.textContent?.includes("Bob"),
        );
        assert.ok(
          document
            .querySelector('[aria-label="队员贡献"]')
            ?.textContent?.includes("暂无得分"),
        );
        assert.ok(
          document
            .querySelector('[role="dialog"]')
            ?.textContent?.includes("全局排名"),
        );
        assert.ok(
          document
            .querySelector('[role="dialog"]')
            ?.textContent?.includes("组内排名"),
        );
        await settle(() => !!document.querySelector(".recharts-radar-polygon"));
        await act(async () => {
          const select = document.querySelector(
            '[aria-label="查看方向得分"]',
          ) as HTMLSelectElement;
          select.value = "bob";
          select.dispatchEvent(
            new dom.window.Event("change", { bubbles: true }),
          );
        });
        assert.ok(document.querySelector('[aria-label="Bob方向得分雷达图"]'));
        assert.ok(
          [...document.querySelectorAll('[aria-label="各方向得分"] dd')].every(
            (el) => el.textContent === "0",
          ),
        );
        await cleanup();
      },
    );
    await t.test(
      "contests without divisions hide the ranking selector",
      async () => {
        board = base;
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () => !!document.querySelector('[aria-label="排行榜组别"]'),
        );
        await act(async () => {
          cache.setQueryData([`/contests/${cid}`], (previous: any) => ({
            ...previous,
            groups: [],
          }));
        });
        await settle(
          () => !document.querySelector('[aria-label="排行榜组别"]'),
        );
        assert.ok(document.querySelector('[aria-label="战队排行榜"]'));
        await cleanup();
      },
    );
    await t.test(
      "search and group changes reset paging; paging keeps both filters and my rank uses team id",
      async () => {
        requests.length = 0;
        board = base;
        await mount(
          `/contests/${cid}/scoreboard?page=2&group=${group}&q=Nebula`,
        );
        await settle(() => !!document.querySelector('[aria-label="搜索战队"]'));
        const input = document.querySelector(
          '[aria-label="搜索战队"]',
        ) as HTMLInputElement;
        assert.equal(input.value, "Nebula");
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, "新的战队");
          input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        await act(async () => {
          input.closest("form")!.dispatchEvent(
            new dom.window.Event("submit", {
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        await settle(() =>
          requests.some(
            (path) =>
              path.includes("page=1") &&
              new URL(path, "http://localhost").searchParams.get("q") ===
                "新的战队",
          ),
        );
        assert.equal(
          new URL(requests.at(-1)!, "http://localhost").searchParams.get(
            "group",
          ),
          group,
        );
        await settle(
          () =>
            !!document.querySelector('[aria-label="下一页"]') &&
            !(
              document.querySelector(
                '[aria-label="下一页"]',
              ) as HTMLButtonElement
            ).disabled,
        );
        await click(document.querySelector('[aria-label="下一页"]')!);
        await settle(() =>
          requests.some(
            (path) =>
              path.includes("page=2") &&
              new URL(path, "http://localhost").searchParams.get("q") ===
                "新的战队",
          ),
        );
        await click(
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "我的排名",
          )!,
        );
        await settle(() =>
          requests.some((path) => path.includes(`participant=${team}`)),
        );
        const current = new URL(requests.at(-1)!, "http://localhost");
        assert.equal(current.searchParams.get("page"), "1");
        assert.equal(current.searchParams.get("q"), null);
        assert.equal(input.value, "");
        await act(async () => {
          const select = document.querySelector(
            '[aria-label="排行榜组别"]',
          ) as HTMLSelectElement;
          select.value = group;
          select.dispatchEvent(
            new dom.window.Event("change", { bubbles: true }),
          );
        });
        await settle(() => {
          const url = new URL(requests.at(-1)!, "http://localhost");
          return (
            url.searchParams.get("group") === group &&
            url.searchParams.get("participant") === null &&
            url.searchParams.get("page") === "1"
          );
        });
        await cleanup();
      },
    );
    await t.test(
      "large matrices bound rendered columns and category selection resets the column window",
      async () => {
        board = {
          ...base,
          total: 1,
          columns: Array.from({ length: 45 }, (_, i) => ({
            ...columns[0]!,
            id: `p-${i}`,
            title: `题目 ${i}`,
            category: i < 40 ? "Web" : "Crypto",
            part_title: null,
          })),
        };
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () => !!document.querySelector('[aria-label="下一组赛题"]'),
        );
        assert.equal(document.querySelectorAll('th[scope="col"]').length, 36);
        await click(document.querySelector('[aria-label="下一组赛题"]')!);
        assert.equal(document.querySelectorAll('th[scope="col"]').length, 9);
        await act(async () => {
          const select = document.querySelector(
            '[aria-label="赛题分类"]',
          ) as HTMLSelectElement;
          select.value = "Crypto";
          select.dispatchEvent(
            new dom.window.Event("change", { bubbles: true }),
          );
        });
        assert.equal(document.querySelectorAll('th[scope="col"]').length, 5);
        assert.equal(document.querySelector('[aria-label="下一组赛题"]'), null);
        await cleanup();
      },
    );
    await t.test(
      "the library renders a step chart that can collapse without hiding the rankings",
      async () => {
        board = {
          ...base,
          total: 1,
          timeline: [
            {
              id: team,
              name: "Nebula",
              score: 100,
              points: [{ time: now, score: 100 }],
            },
          ],
        };
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () =>
            !!document.querySelector('[aria-label="前五名战队积分走势"] svg'),
        );
        await settle(() => !!document.querySelector(".recharts-line-curve"));
        const toggle = [...document.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("积分走势"),
        )!;
        await click(toggle);
        assert.equal(toggle.getAttribute("aria-expanded"), "false");
        assert.ok(document.querySelector('[aria-label="战队排行榜"]'));
        await click(toggle);
        await settle(() => !!document.querySelector(".recharts-line-curve"));
        await cleanup();
      },
    );
    await t.test(
      "practice keeps a compact participant table without a huge challenge matrix",
      async () => {
        board = { ...base, scope: "practice", frozen: false, total: 1 };
        await mount("/scoreboard");
        await settle(
          () => !!document.querySelector('[aria-label="练习排行榜"]'),
        );
        assert.equal(document.querySelectorAll('th[scope="col"]').length, 0);
        assert.ok(document.body.textContent?.includes("最后解题"));
        assert.equal(
          document.querySelector('[aria-label="解题标记说明"]'),
          null,
        );
        await cleanup();
      },
    );
  } finally {
    await cleanup();
    dom.window.close();
    for (const [key, descriptor] of original)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
  }
});
