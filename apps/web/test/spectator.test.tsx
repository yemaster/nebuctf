import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import {
  cityFacilities,
  activeEngagements,
  SpectatorEvents,
  type SpectatorEvent,
  type SpectatorData,
} from "../src/lib/spectator";
import { contestCapabilities } from "../src/lib/contest-access";

const team = (i: number) => ({
  id: `team-${i}`,
  name: `Team ${i}`,
  score: i * 100,
  rank: i + 1,
  solves: i,
  group_name: null,
});
const event = (id: string, time: number): SpectatorEvent => ({
  id,
  type: "solve",
  team_id: "team-0",
  team_name: "Team 0",
  challenge_id: "web",
  challenge_title: "Web",
  part_title: null,
  blood_rank: 1,
  created_at: new Date(time).toISOString(),
});

const question = (i: number) => ({
  id: `q-${i}`,
  challenge_id: `q-${i}`,
  title: `Question ${i}`,
  category: "Web",
  part_title: null,
  solves: i,
});
test("city facilities stay fixed across solve updates and are bounded and collision-free", () => {
  const questions = Array.from({ length: 200 }, (_, i) => question(i));
  const a = cityFacilities(questions);
  assert.deepEqual(
    a,
    cityFacilities(
      [...questions].reverse().map((q) => ({ ...q, solves: q.solves + 10 })),
    ),
  );
  assert.equal(new Set(a.map((n) => `${n.x}:${n.z}`)).size, 200);
  assert(
    a.every((n) => Number.isFinite(n.x) && Math.abs(n.x) < 48 && n.height > 0),
  );
  assert.equal(
    cityFacilities(Array.from({ length: 300 }, (_, i) => question(i))).length,
    256,
  );
  assert.deepEqual(cityFacilities([]), []);
});

test("only new real events animate, without replaying snapshots, stale history or duplicate frames", () => {
  const ledger = new SpectatorEvents(),
    now = Date.now();
  const initial = [event("old", now - 1000)];
  assert.deepEqual(ledger.ingest(initial, true, now), []);
  const next = [event("new", now), ...initial];
  assert.deepEqual(
    ledger.ingest(next, true, now).map((e) => e.id),
    ["new"],
  );
  assert.deepEqual(ledger.ingest(next, true, now), []);
  assert.deepEqual(
    ledger.ingest(
      [event("stale", now - 30000), event("future", now + 6000)],
      true,
      now,
    ),
    [],
  );
  assert.deepEqual(ledger.ingest([event("offline", now)], false, now), []);
  assert.deepEqual(ledger.ingest([event("offline", now)], true, now), []);
  assert.equal(
    ledger.ingest(
      Array.from({ length: 30 }, (_, i) => event(`live-${i}`, now)),
      true,
      now,
    ).length,
    12,
  );
});

test("contest capabilities distinguish visitors, approved teams and staff without bypassing registration", () => {
  const now = Date.now(),
    contest: any = {
      published: true,
      starts_at: new Date(now - 3600000).toISOString(),
      ends_at: new Date(now + 3600000).toISOString(),
      spectator_scoreboard: false,
      spectator_enabled: true,
    };
  assert.deepEqual(contestCapabilities(contest, null, now), {
    role: "spectator",
    practice: false,
    scoreboard: false,
    spectate: true,
    challenges: false,
    instances: false,
    activity: false,
  });
  const user: any = { id: "u", role: "user" };
  assert.equal(contestCapabilities(contest, user, now).challenges, false);
  const accepted = {
    ...contest,
    registered: true,
    registration: { status: "accepted" },
  };
  assert.equal(contestCapabilities(accepted, user, now).scoreboard, true);
  const ended = {
    ...accepted,
    ends_at: new Date(now - 1000).toISOString(),
    practice_mode: true,
  };
  assert.equal(contestCapabilities(ended, user, now).challenges, true);
  assert.equal(
    contestCapabilities(
      { ...ended, registered: false, registration: { status: "suspended" } },
      user,
      now,
    ).challenges,
    false,
  );
  assert.equal(
    contestCapabilities(
      { ...contest, spectator_enabled: false },
      { ...user, role: "admin" },
      now,
    ).spectate,
    true,
  );
  assert.equal(
    contestCapabilities(
      { ...contest, registration: { status: "pending" } },
      { ...user, role: "admin" },
      now,
    ).challenges,
    false,
  );
});

test(
  "spectator page keeps rankings and live events usable without WebGL and revokes the entire view",
  { timeout: 15000 },
  async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: "http://localhost/contests/demo/spectate",
      pretendToBeVisual: true,
    });
    const original = new Map<string, PropertyDescriptor | undefined>();
    class Socket {
      static current: Socket;
      readyState = 0;
      onopen?: () => void;
      onmessage?: (message: { data: string }) => void;
      onclose?: (event: { code: number }) => void;
      onerror?: () => void;
      constructor(public url: URL) {
        Socket.current = this;
      }
      close() {
        this.readyState = 3;
      }
    }
    Object.assign(dom.window, {
      WebSocket: Socket,
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
      scrollTo() {},
    });
    dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as any;
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      Element: dom.window.Element,
      SVGElement: dom.window.SVGElement,
      Node: dom.window.Node,
      Event: dom.window.Event,
      MutationObserver: dom.window.MutationObserver,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    }
    original.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
    const data: SpectatorData = {
      contest: {
        id: "demo",
        title: "观战测试",
        starts_at: new Date(Date.now() - 3600000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
      },
      started: true,
      frozen: false,
      cutoff: new Date().toISOString(),
      stats: { teams: 11, challenges: 1, solves: 1, attacks: 0 },
      leaders: Array.from({ length: 10 }, (_, i) => team(i)),
      challenges: [],
      events: [event("first", Date.now())],
      groups: [],
    };
    let denied = false,
      resolveNext: ((res: Response) => void) | undefined;
    globalThis.fetch = async (input) => {
      const path = String(input);
      if (denied)
        return Response.json(
          { error: "本场比赛未开放观战大屏" },
          { status: 403 },
        );
      if (path.includes("ranking?page=2"))
        return new Promise<Response>((resolve) => {
          resolveNext = resolve;
        });
      return Response.json(
        path.includes("ranking")
          ? { items: data.leaders.slice(0, 10), total: 11, page: 1 }
          : data,
      );
    };
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter, Routes, Route } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query"),
      { LazyMotion, domAnimation } = await import("motion/react"),
      { ContestSpectator } = await import("../src/pages/ContestSpectator");
    const cache = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      }),
      root = createRoot(document.getElementById("root")!);
    const settle = async (predicate: () => boolean) => {
      for (let i = 0; i < 150 && !predicate(); i++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      assert(predicate(), "spectator UI settled");
    };
    const button = (label: string) =>
      document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={["/contests/demo/spectate"]}>
              <LazyMotion features={domAnimation}>
                <Routes>
                  <Route
                    path="/contests/:id/spectate"
                    element={<ContestSpectator />}
                  />
                </Routes>
              </LazyMotion>
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
      await settle(() => !!button("下一页排名"));
      assert.equal(new URL(Socket.current.url).protocol, "ws:");
      await act(async () => {
        Socket.current.readyState = 1;
        Socket.current.onopen?.();
      });
      await settle(() =>
        document.body.textContent!.includes("当前设备无法显示 3D"),
      );
      assert(document.body.textContent!.includes("Team 0"));
      assert(document.body.textContent!.includes("一血"));
      await act(async () => button("下一页排名").click());
      await settle(() => !!resolveNext);
      assert(
        document.body.textContent!.includes("Team 0"),
        "current ranking remains visible while next page is pending",
      );
      await act(async () =>
        resolveNext!(Response.json({ items: [team(10)], total: 11, page: 2 })),
      );
      await settle(() => document.body.textContent!.includes("Team 10"));
      assert(!button("重置视角"));
      assert(!button("查看 Team 10，第 11 名，1000 分"));
      await act(async () => {
        denied = true;
        Socket.current.onclose?.({ code: 1008 });
      });
      await settle(() => !document.querySelector("[data-spectator-screen]"));
      assert(document.body.textContent!.includes("本场比赛的观战权限已变更"));
      assert(!document.body.textContent!.includes("Team 0"));
    } finally {
      await act(async () => root.unmount());
      cache.clear();
      await new Promise((r) => setTimeout(r, 100));
      dom.window.close();
      for (const [key, value] of original)
        if (value) Object.defineProperty(globalThis, key, value);
        else delete (globalThis as any)[key];
    }
  },
);

test("multi-flag challenges occupy one facility each", () => {
  const questions = Array.from({ length: 30 }, (_, i) => ({
    ...question(Math.floor(i / 2)),
    id: `part-${i}`,
    part_title: `Part ${i}`,
    solves: i,
  }));
  const facilities = cityFacilities(questions);
  assert.equal(facilities.length, 15);
  assert.equal(new Set(facilities.map((f) => f.id)).size, 15);
  assert.deepEqual(facilities, cityFacilities([...questions].reverse()));
  assert.equal(
    cityFacilities([{ ...question(0), category: "" }])[0]!.category,
    "Misc",
  );
});

test("city buffers and attack effects remain bounded and are released", async () => {
  const T = await import("three"),
    { createArenaWorld } =
      await import("../src/components/spectator/arena-world"),
    { createArenaEffects } =
      await import("../src/components/spectator/arena-effects");
  const world = createArenaWorld();
  world.setChallenges([]);
  let buildings = 0;
  world.group.traverse((o) => {
    if (o instanceof T.InstancedMesh) buildings += o.count;
  });
  assert(buildings > 400, "city is populated even before questions open");
  world.setChallenges([{ ...question(0), challenge_id: "web" }]);
  let disposed = 0;
  world.group.traverse((o) => {
    if (o instanceof T.InstancedMesh)
      o.addEventListener("dispose", () => disposed++);
  });
  world.setChallenges([{ ...question(0), challenge_id: "new" }]);
  assert(disposed > 0, "replaced instance buffers are released");
  assert(!world.anchors.has("web"));
  assert(world.anchors.has("new"));
  const replaced = disposed;
  world.setChallenges([{ ...question(0), challenge_id: "new", solves: 10 }]);
  assert.equal(
    disposed,
    replaced,
    "score updates do not rebuild city geometry",
  );
  const effects = createArenaEffects(world.group),
    children = world.group.children.length;
  assert.equal(effects.add(event("missing", Date.now()), undefined), false);
  assert.equal(world.group.children.length, children);
  for (let i = 0; i < 30; i++)
    effects.add(event(`e-${i}`, Date.now()), world.anchors.get("new"));
  assert.equal(effects.count, 12);
  effects.tick(0.6);
  effects.tick(4);
  assert.equal(effects.count, 0);
  assert.equal(world.group.children.length, children);
  effects.dispose();
  world.dispose();
  assert.equal(world.group.children.length, 0);
  assert.equal(world.anchors.size, 0);
});

test("attack broadcasts expire and cannot reveal frozen, hidden or post-contest activity", () => {
  const now = Date.now(),
    at = new Date(now).toISOString();
  const data = {
    started: true,
    frozen: false,
    contest: { ends_at: new Date(now + 60000).toISOString() },
    challenges: [question(0)],
    engagements: [
      {
        challenge_id: "q-0",
        challenge_title: "Question",
        last_seen: at,
        teams: [{ id: "t", name: "Team", last_seen: at }],
      },
    ],
  } as SpectatorData;
  assert.equal(activeEngagements(data, now).length, 1);
  for (const hidden of [
    { ...data, frozen: true },
    { ...data, started: false },
    { ...data, challenges: [] },
  ])
    assert.deepEqual(activeEngagements(hidden, now), []);
  assert.deepEqual(activeEngagements(data, now + 91000), []);
});
