import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import {
  arenaNodes,
  arenaSectors,
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

test("arena layout stays deterministic across ranking changes and bounds GPU work", () => {
  const teams = Array.from({ length: 20 }, (_, i) => team(i));
  const a = arenaNodes(teams),
    b = arenaNodes([...teams].reverse());
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((n) => `${n.x}:${n.z}`)).size, 20);
  assert(
    a.every((n) => Number.isFinite(n.x) && n.height >= 1 && n.height <= 4.8),
  );
  assert.equal(
    arenaNodes(Array.from({ length: 200 }, (_, i) => team(i))).length,
    60,
  );
  assert.equal(arenaNodes([{ ...team(0), score: -100 }])[0]!.height, 1);
  assert.deepEqual(arenaNodes([]), []);
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
      await act(async () => button("查看 Team 10，第 11 名，1000 分").click());
      assert(document.body.textContent!.includes("#11"));
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

test("category islands map every real challenge once and bound large category sets", () => {
  const challenges = Array.from({ length: 30 }, (_, i) => ({
    id: `part-${i}`,
    challenge_id: `challenge-${Math.floor(i / 2)}`,
    category: `Category ${Math.floor(i / 2)}`,
    title: "Question",
    part_title: "Part",
    solves: i,
  }));
  const sectors = arenaSectors(challenges);
  assert.equal(sectors.length, 8);
  const ids = sectors.flatMap((s) => s.challengeIds);
  assert.equal(ids.length, 15);
  assert.equal(new Set(ids).size, 15);
  assert.deepEqual(sectors, arenaSectors([...challenges].reverse()));
  assert.deepEqual(arenaSectors([]), []);
  assert.equal(
    arenaSectors([{ ...challenges[0]!, category: "" }])[0]!.name,
    "其他",
  );
});

test("scene models replace category geometry and reclaim bounded event effects", async () => {
  const T = await import("three"),
    { createArenaWorld } =
      await import("../src/components/spectator/arena-world"),
    { createArenaEffects } =
      await import("../src/components/spectator/arena-effects");
  const world = createArenaWorld(new T.Color("#60a5fa"), true);
  const question = {
    id: "part",
    challenge_id: "web",
    title: "Web",
    category: "Web",
    part_title: null,
    solves: 0,
  };
  world.setChallenges([question]);
  const objectCount = () => {
    let count = 0;
    world.group.traverse(() => count++);
    return count;
  };
  const initial = objectCount();
  let disposed = 0;
  world.group.traverse((o) => {
    if (o instanceof T.InstancedMesh)
      o.addEventListener("dispose", () => disposed++);
  });
  world.setChallenges([{ ...question, challenge_id: "new" }]);
  assert.equal(objectCount(), initial);
  assert.equal(disposed, 1, "replaced category instance buffers are released");
  assert.equal(world.anchors.has("web"), false);
  assert.equal(world.anchors.has("new"), true);
  const station = world.createStation("team");
  station.object.position.set(18, 0, 0);
  assert(
    new T.Box3()
      .setFromObject(station.object)
      .getSize(new T.Vector3())
      .length() > 0,
  );
  station.dispose();
  assert.equal(objectCount(), initial);
  const effects = createArenaEffects(world.group, new T.Color("#60a5fa"), true);
  const children = world.group.children.length;
  effects.add(event("missing", Date.now()), undefined, undefined);
  assert.equal(
    world.group.children.length,
    children,
    "missing endpoints create no fabricated trajectory",
  );
  for (let i = 0; i < 30; i++)
    effects.add(
      event(`e-${i}`, Date.now()),
      new T.Vector3(18, 2, 0),
      new T.Vector3(0, 2, 10),
    );
  assert.equal(world.group.children.length, children + 12);
  effects.tick(0.6);
  effects.tick(4);
  assert.equal(world.group.children.length, children);
  effects.clear();
  world.dispose();
  assert.equal(world.group.children.length, 0);
  assert.equal(world.anchors.size, 0);
});
