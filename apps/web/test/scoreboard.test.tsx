import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { ScoreboardData } from "../src/lib/types";
import { scoreTimelineRows } from "../src/lib/scoreboard";
import {
  timelineWindow,
  timelineActivityRange,
  timelineTicks,
  timelineColors,
  timelineAt,
} from "../src/lib/score-timeline";

test("timeline inspection resolves every instant without snapping forward to a solve", () => {
  const data = [
    { time: 0, team0: 0, team1: 0 },
    { time: 1000, team0: 100, team1: 0 },
    { time: 6000, team0: 100, team1: -50 },
    { time: 10000, team0: 300, team1: 150 },
    { time: 1000000, team0: 300, team1: 150 },
  ];
  for (const time of [
    0, 999, 1000, 1001, 5999, 6000, 9999, 10000, 500000, 999999, 1000000,
  ]) {
    const earned = data.findLast((point) => point.time <= time)!;
    assert.deepEqual(timelineAt(data, time), { ...earned, time });
  }
  assert.deepEqual(timelineAt(data, 9999), {
    time: 9999,
    team0: 100,
    team1: -50,
  });
  const zoom = timelineWindow(data, [4000, 7000]);
  assert.deepEqual(timelineAt(zoom, 5000), {
    time: 5000,
    team0: 100,
    team1: 0,
  });
  for (const time of [-1, 1000001, NaN])
    assert.equal(timelineAt(data, time), null);
  assert.equal(timelineAt([], 0), null);
  assert.equal(
    data[1]!.time,
    1000,
    "inspecting must not mutate recorded timestamps",
  );
});

test("zoomed score timelines carry boundary scores without interpolating gains", () => {
  const data = [
    { time: 0, team0: 0, team1: 0 },
    { time: 120000, team0: 100, team1: 0 },
    { time: 180000, team0: 100, team1: -20 },
    { time: 240000, team0: 300, team1: -20 },
    { time: 86400000, team0: 300, team1: -20 },
  ];
  assert.deepEqual(timelineWindow(data, [150000, 210000]), [
    { time: 150000, team0: 100, team1: 0 },
    { time: 180000, team0: 100, team1: -20 },
    { time: 210000, team0: 100, team1: -20 },
  ]);
  assert.deepEqual(timelineWindow(data, [120000, 240000]), data.slice(1, 4));
  assert.deepEqual(timelineActivityRange(data), [60000, 300000]);
  assert.equal(
    timelineActivityRange([
      { time: 0, team0: 0 },
      { time: 1000, team0: 0 },
    ]),
    null,
  );
  assert.deepEqual(timelineWindow([], [0, 1]), []);
  assert.deepEqual(timelineWindow(data, [100, 100]), []);
  const ticks = timelineTicks([123, 86400001], 7);
  assert.equal(ticks[0], 123);
  assert.equal(ticks.at(-1), 86400001);
  assert(ticks.every((tick, i) => i === 0 || tick > ticks[i - 1]!));
  assert(ticks.length <= 7);
  assert.deepEqual(timelineTicks([NaN, 100], 7), []);
});

test("team timeline colors survive ranking changes and new entrants reuse free colors", () => {
  const initial = timelineColors(["a", "b", "c", "d", "e"], {});
  const next = timelineColors(["c", "a", "f", "e", "b"], initial);
  for (const id of ["a", "b", "c", "e"]) assert.equal(next[id], initial[id]);
  assert.equal(next.f, initial.d);
  assert.equal(new Set(Object.values(next)).size, 5);
});

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
    HTMLFormElement: dom.window.HTMLFormElement,
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
        const heading = document.querySelector('thead th[title="Web 闯关"]')!;
        assert.equal(
          document.querySelectorAll('thead th[title="Web 闯关"]').length,
          1,
        );
        assert.equal(heading.getAttribute("colspan"), "2");
        assert.equal(heading.getAttribute("scope"), "colgroup");
        assert.equal(
          document.querySelector("thead th")!.getAttribute("rowspan"),
          "4",
        );
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
          document.querySelector('tr[data-self="true"]')!.children[1]!,
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
            ?.textContent?.includes("Alice"),
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
      "mixed headers merge by challenge id and span ordinary questions across the part row",
      async () => {
        board = {
          ...base,
          columns: [
            ...columns,
            {
              ...columns[0]!,
              id: "single",
              challenge_id: "other",
              part_title: null,
            },
            {
              ...columns[0]!,
              id: "crypto",
              challenge_id: "crypto",
              title: "RSA",
              category: "Crypto",
              part_title: null,
            },
          ],
          challenge_count: 3,
          flag_count: 4,
        };
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () => !!document.querySelector('[aria-label="战队排行榜"]'),
        );
        const header = document.querySelector("thead")!;
        assert.equal(header.children.length, 4);
        const names = [
          ...header.querySelectorAll<HTMLTableCellElement>(
            'th[title="Web 闯关"]',
          ),
        ];
        assert.equal(
          names.length,
          2,
          "same names on different challenges are not merged",
        );
        assert.deepEqual(
          names.map((cell) => [cell.colSpan, cell.rowSpan]),
          [
            [2, 1],
            [1, 2],
          ],
        );
        assert.equal(
          header.children[0]!.children[3]!.getAttribute("colspan"),
          "3",
          "category includes every part and ordinary question",
        );
        assert.equal(header.children[2]!.children.length, 2);
        assert.deepEqual(
          [...header.querySelector('[aria-label="赛题分值"]')!.children].map(
            (cell) => cell.textContent,
          ),
          ["100", "200", "100", "100"],
          "scores share one aligned row for ordinary and multipart questions",
        );
        assert.equal(document.querySelector("tbody tr")!.children.length, 7);
        await cleanup();
      },
    );
    await t.test(
      "solve previews show awarded points and exact time on focus or touch without opening team details",
      async () => {
        requests.length = 0;
        board = {
          ...base,
          items: [{ ...row, cells: [{ ...row.cells[0]!, score: 125 }] }],
        };
        await mount(`/contests/${cid}/scoreboard`);
        await settle(() => !!document.querySelector('[aria-label="赛题分值"]'));
        const button = document.querySelector<HTMLButtonElement>(
          '[aria-label="Nebula，Web 闯关 / 第一关，一血，125 分"]',
        )!;
        assert.ok(button);
        await act(async () => button.focus());
        await settle(() => !!document.querySelector('[role="tooltip"]'));
        const preview = document.querySelector(
          '[data-slot="tooltip-content"]',
        )!;
        assert.equal(preview.getAttribute("data-variant"), "surface");
        assert.ok(preview.textContent?.includes("+125"));
        assert.ok(preview.textContent?.includes("第一关"));
        assert.ok(preview.textContent?.includes("一血"));
        assert.equal(preview.querySelector("time")?.dateTime, now);
        assert.match(
          preview.querySelector("time")!.textContent!,
          /\d{2}:\d{2}:\d{2}/,
        );
        assert.equal(
          document.querySelector('[aria-label="赛题分值"]')!.children[0]!
            .textContent,
          "100",
          "current value stays separate from the team's awarded points",
        );
        await act(async () => {
          button.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
            }),
          );
          button.blur();
        });
        await settle(() => !document.querySelector('[role="tooltip"]'));
        const tap = async () => {
          await act(async () => {
            const down = new dom.window.MouseEvent("pointerdown", {
              bubbles: true,
            });
            Object.defineProperty(down, "pointerType", { value: "touch" });
            button.dispatchEvent(down);
            button.dispatchEvent(
              new dom.window.MouseEvent("pointerup", { bubbles: true }),
            );
          });
          await click(button);
        };
        await tap();
        await settle(() => !!document.querySelector('[role="tooltip"]'));
        assert.ok(!document.querySelector('[role="dialog"]'));
        assert.ok(
          !requests.some((path) => path.startsWith(`/scoreboard/${team}?`)),
        );
        await tap();
        await settle(() => !document.querySelector('[role="tooltip"]'));
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
            challenge_id: `c-${i}`,
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
        assert.equal(document.querySelector("thead")!.children.length, 3);
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
              points: [
                {
                  time: new Date(Date.parse(now) - 1800000).toISOString(),
                  score: 100,
                },
              ],
            },
          ],
        };
        await mount(`/contests/${cid}/scoreboard`);
        await settle(
          () =>
            !!document.querySelector('[aria-label="前五名战队积分走势"] svg'),
        );
        await settle(() => !!document.querySelector(".recharts-line-curve"));
        const chart = document.querySelector(
          '[aria-label="前五名战队积分走势"]',
        )!;
        const inspectAt = async (x: number) => {
          await act(async () => {
            chart.dispatchEvent(
              new dom.window.MouseEvent("pointermove", {
                clientX: x,
                clientY: 100,
                bubbles: true,
              }),
            );
            await new Promise<void>((resolve) =>
              dom.window.requestAnimationFrame(() => resolve()),
            );
          });
          await settle(
            () =>
              !!document.querySelector(
                '[role="tooltip"][aria-label="积分详情"]',
              ),
          );
          return document.querySelector(
            '[role="tooltip"][aria-label="积分详情"]',
          )!;
        };
        const early = await inspectAt(200);
        const earlyTime = Number(early.getAttribute("data-time"));
        assert(
          early.textContent?.includes("Nebula0"),
          "scores before a solve remain zero",
        );
        const later = await inspectAt(400);
        const laterTime = Number(later.getAttribute("data-time"));
        assert(
          laterTime > earlyTime && laterTime < Date.parse(now),
          "the pointer inspects intermediate times",
        );
        assert(later.textContent?.includes("Nebula100"));
        await act(async () => {
          chart.dispatchEvent(
            new dom.window.FocusEvent("focusout", {
              relatedTarget: chart.querySelector("svg"),
              bubbles: true,
            }),
          );
        });
        assert.ok(
          document.querySelector('[aria-label="积分详情"]'),
          "touch moving focus inside the chart keeps inspection open",
        );
        await act(async () => {
          chart.dispatchEvent(
            new dom.window.FocusEvent("focusout", {
              relatedTarget: document.body,
              bubbles: true,
            }),
          );
        });
        assert.equal(
          document.querySelector('[aria-label="积分详情"]'),
          null,
          "leaving the chart closes inspection",
        );
        await act(async () => {
          chart.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "Home",
              bubbles: true,
            }),
          );
        });
        assert.equal(
          Number(
            document
              .querySelector('[aria-label="积分详情"]')!
              .getAttribute("data-time"),
          ),
          Date.parse(board.starts_at!),
        );
        await act(async () => {
          chart.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "ArrowRight",
              bubbles: true,
            }),
          );
        });
        assert(
          Number(
            document
              .querySelector('[aria-label="积分详情"]')!
              .getAttribute("data-time"),
          ) > Date.parse(board.starts_at!),
        );
        await act(async () => {
          chart.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
            }),
          );
        });
        assert.equal(document.querySelector('[aria-label="积分详情"]'), null);
        const legend = document.querySelector(
          '[aria-label="隐藏Nebula的积分走势"]',
        )!;
        await click(legend);
        assert.equal(legend.getAttribute("aria-pressed"), "false");
        assert.equal(document.querySelector(".recharts-line-curve"), null);
        assert.ok(document.querySelector('[aria-label="战队排行榜"]'));
        await click(legend);
        await settle(() => !!document.querySelector(".recharts-line-curve"));
        const rangeStart = () =>
          Number(
            document
              .querySelector('[aria-label="时间范围开始"]')!
              .getAttribute("aria-valuenow"),
          );
        const originalStart = rangeStart();
        await click(
          [...document.querySelectorAll("button")].find(
            (button) => button.textContent === "得分时段",
          )!,
        );
        assert(rangeStart() > originalStart);
        await click(document.querySelector('[aria-label="重置时间范围"]')!);
        assert.equal(rangeStart(), originalStart);
        await act(async () => {
          document.querySelector('[aria-label="时间范围开始"]')!.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "ArrowRight",
              bubbles: true,
            }),
          );
        });
        assert(
          rangeStart() > originalStart,
          "range can be adjusted with the keyboard",
        );
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
    // React/Recharts defer animation cleanup to the next frame. Drain it before removing browser globals.
    await act(async () => {
      await new Promise<void>((resolve) =>
        dom.window.requestAnimationFrame(() =>
          dom.window.requestAnimationFrame(() => resolve()),
        ),
      );
    });
    dom.window.close();
    for (const [key, descriptor] of original)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
  }
});
