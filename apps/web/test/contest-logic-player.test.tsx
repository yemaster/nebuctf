import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { setTimeout as delay } from "node:timers/promises";
import type { Objective, QuestionLogic } from "../src/lib/competition";
import type {
  ObjectiveResponse,
  ObjectiveSaved,
  Paper,
} from "../src/lib/objective-paper";

test("player submissions confirm exclusive routes without locking drafts", async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(dom.window, {
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    scrollTo() {},
  });
  class Socket {
    static instances: Socket[] = [];
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    constructor() {
      Socket.instances.push(this);
    }
    close() {}
  }
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    FormData: dom.window.FormData,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    SVGElement: dom.window.SVGElement,
    localStorage: dom.window.localStorage,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: globalThis.fetch,
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(dom.window, "WebSocket", {
    value: Socket,
    configurable: true,
  });
  // DOM-aware modules must initialize after the JSDOM globals are installed.
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { LazyMotion, domAnimation } = await import("motion/react");
  const { App } = await import("../src/App");
  const { ObjectiveAnswer } =
    await import("../src/components/objective-answer");
  const { ObjectivePaper } = await import("../src/components/objective-paper");
  const { PatchPanel } = await import("../src/components/patch-panel");
  const { useObjectivePaper } = await import("../src/lib/use-objective-paper");
  const { useContestRealtime } = await import("../src/lib/contest-realtime");
  const { useAPI } = await import("../src/lib/api");
  const logic: QuestionLogic & { exclusive_selected: boolean } = {
    exclusive_group: "路线甲",
    dependency: null,
    exclusive_selected: false,
  };
  const definition: Objective = {
    type: "single",
    options: [
      { id: "A", text: "答案 A" },
      { id: "B", text: "答案 B" },
    ],
    blanks: [],
    case_sensitive: true,
    trim: true,
  };
  const empty: ObjectiveSaved = {
    answer: {},
    correct: null,
    finalized_at: null,
    revision: null,
  };
  let answer = { ...empty };
  let challenge = {
    id: "route-a",
    title: "路线题 A",
    description: "路线正文",
    category: "Misc",
    difficulty: "入门",
    kind: "static_attachment",
    challenge_type: "ctf",
    points: 100,
    solves: 0,
    solved: false,
    solved_parts: 0,
    total_parts: 1,
    parts: [],
    hints: [],
    attachments: [],
    contest_logic: { ...logic },
    defense_enabled: false,
    permissions: { view: true, submit: true, resources: false, score: true },
  };
  let paper: Paper = {
    server_time: new Date().toISOString(),
    preview: false,
    practice: false,
    can_submit: true,
    phase: {
      section: "objective",
      mode: "inherit",
      status: "active",
      started_at: null,
      deadline_at: new Date(Date.now() + 3600000).toISOString(),
      opens_at: null,
      closes_at: null,
      duration_seconds: null,
    },
    items: [],
  };
  type Body = {
    finalize?: boolean;
    answer?: ObjectiveResponse;
    answers?: {
      id: string;
      answer: ObjectiveResponse;
      revision: string | null;
    }[];
  };
  const writes: { path: string; body: Body | null }[] = [];
  const reads: string[] = [];
  let root: Root | undefined;
  let cache = new QueryClient();
  const paperPath = "/contests/cup/objective-paper";
  const listPath = "/challenges?scope=cup&category=&q=&page=1";
  const contest = {
    id: "cup",
    title: "测试比赛",
    registered: true,
    groups: [],
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  };
  globalThis.fetch = async (input, init) => {
    const path = String(input).replace(/^\/api/, "");
    if (init?.method === "POST") {
      const body: Body | null =
        init.body instanceof dom.window.FormData
          ? null
          : JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path.endsWith("/answer")) {
        answer = {
          ...empty,
          answer: body?.answer ?? {},
          finalized_at: body?.finalize ? new Date().toISOString() : null,
          correct: body?.finalize ? false : null,
        };
        return Response.json(answer);
      }
      if (path === paperPath) {
        const items = (body?.answers ?? []).map((item) => ({
          ...item,
          correct: body?.finalize ? false : null,
          finalized_at: body?.finalize ? new Date().toISOString() : null,
          revision: "saved-revision",
        }));
        paper = {
          ...paper,
          items: paper.items.map((q) => ({
            ...q,
            saved: items.find((item) => item.id === q.id) ?? q.saved,
          })),
        };
        return Response.json({ server_time: new Date().toISOString(), items });
      }
      challenge = {
        ...challenge,
        contest_logic: { ...logic, exclusive_selected: true },
      };
      if (path.includes("/patches"))
        return Response.json({ id: "job", status: "queued" });
      return Response.json({
        correct: false,
        already_solved: false,
        completed: false,
      });
    }
    reads.push(path);
    if (path.endsWith("/answer?scope=cup")) return Response.json(answer);
    if (path.includes("/patches?"))
      return Response.json({ items: [], usage: null });
    if (path === paperPath) return Response.json(paper);
    if (path.startsWith("/challenges?"))
      return Response.json({ items: [challenge], total: 1 });
    if (path.startsWith("/challenges/")) return Response.json(challenge);
    if (path === "/contests/cup") return Response.json(contest);
    if (path === "/me")
      return Response.json({
        user: { id: "route-player", username: "player", role: "user" },
      });
    if (path === "/site")
      return Response.json({ name: "NebuCTF", footer_text: "" });
    if (path.includes("/activity"))
      return Response.json({
        items: [],
        frozen: true,
        permissions_version: "1",
      });
    return Response.json({ items: [] });
  };
  const mount = async (view: React.ReactNode, path = "/") => {
    if (root) await act(async () => root!.unmount());
    cache?.clear();
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { gcTime: Infinity },
      },
    });
    cache.setQueryData(["/me"], {
      user: { id: "route-player", username: "player", role: "user" },
    });
    cache.setQueryData(["/site"], { name: "NebuCTF", footer_text: "" });
    cache.setQueryData(["/contests/cup"], contest);
    cache.setQueryData([listPath], { items: [challenge], total: 1 });
    cache.setQueryData([`/challenges/${challenge.id}?scope=cup`], challenge);
    cache.setQueryData(
      [`/challenges/${challenge.id}/answer?scope=cup`],
      answer,
    );
    cache.setQueryData([`/challenges/${challenge.id}/patches?scope=cup`], {
      items: [],
    });
    cache.setQueryData([paperPath], paper);
    cache.setQueryData(["/contests/cup/activity"], {
      items: [],
      frozen: true,
      permissions_version: "1",
    });
    root = createRoot(document.getElementById("root")!);
    await act(async () =>
      root!.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[path]}>
            <LazyMotion features={domAnimation}>{view}</LazyMotion>
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  };
  const button = (text: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === text,
    );
  const click = async (node: Element | undefined | null) => {
    assert(node);
    await act(async () => {
      node.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  };
  const settle = async (check: () => boolean) => {
    for (let n = 0; n < 60 && !check(); n++)
      await act(async () => {
        await delay(20);
      });
    assert(check());
  };
  t.after(async () => {
    if (root) await act(async () => root!.unmount());
    cache?.clear();
    dom.window.close();
    for (const [key, value] of original)
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
  });

  await t.test(
    "Flag and AWD attack cancel safely, bind wrong submissions and skip selected routes",
    async () => {
      for (const type of ["ctf", "awd"]) {
        challenge = {
          ...challenge,
          challenge_type: type,
          contest_logic: { ...logic },
        };
        await mount(
          <App />,
          `/contests/cup/challenges?challenge=${challenge.id}`,
        );
        await settle(() => !!document.querySelector(`#flag-${challenge.id}`));
        const flag = document.querySelector<HTMLInputElement>(
          `#flag-${challenge.id}`,
        )!;
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLInputElement.prototype,
            "value",
          )?.set?.call(flag, "flag{wrong}");
          flag.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        const form = document
          .querySelector(`#flag-${challenge.id}`)!
          .closest("form")!;
        const before = writes.length;
        await act(async () => {
          form.dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          );
        });
        assert(
          document
            .querySelector('[role="dialog"]')
            ?.textContent?.includes("路线题 A · 路线甲"),
        );
        await click(button("取消"));
        assert.equal(writes.length, before);
        assert.equal(challenge.contest_logic.exclusive_selected, false);
        await act(async () => {
          form.dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          );
        });
        const readCount = reads.filter((path) =>
          path.startsWith("/challenges?"),
        ).length;
        await click(button("确认提交"));
        await settle(
          () =>
            writes.length === before + 1 &&
            !document.querySelector('[role="dialog"]'),
        );
        assert.equal(
          writes.at(-1)?.path,
          `/challenges/${challenge.id}/${type === "awd" ? "attack" : "submit"}`,
        );
        await settle(
          () =>
            reads.filter((path) => path.startsWith("/challenges?")).length >
            readCount,
        );
        await settle(
          () =>
            cache.getQueryData<typeof challenge>([
              `/challenges/${challenge.id}?scope=cup`,
            ])?.contest_logic.exclusive_selected === true,
        );
        await act(async () => {
          form.dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          );
        });
        await settle(() => writes.length === before + 2);
        assert(!document.querySelector('[role="dialog"]'));
      }
    },
  );

  await t.test(
    "defense upload does not run before confirmation and skips an already selected route",
    async () => {
      challenge = { ...challenge, contest_logic: { ...logic } };
      const view = (selected: boolean) => (
        <PatchPanel
          id={challenge.id}
          scope="cup"
          title={challenge.title}
          contestLogic={{ ...logic, exclusive_selected: selected }}
        />
      );
      for (const selected of [false, true]) {
        await mount(view(selected));
        const file =
          document.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(file, "files", {
          value: [new dom.window.File(["patch"], "defense.tar.gz")],
          configurable: true,
        });
        await act(async () => {
          file.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        });
        const before = writes.length;
        await click(button("提交补丁"));
        if (!selected) {
          await click(button("取消"));
          assert.equal(writes.length, before);
          await click(button("提交补丁"));
          await click(button("确认提交"));
        } else assert(!document.querySelector('[role="dialog"]'));
        await settle(() => writes.length === before + 1);
        assert(writes.at(-1)?.path.includes("/patches?"));
        await settle(() => !document.querySelector('[role="dialog"]'));
      }
    },
  );

  await t.test(
    "single answers save drafts freely and preserve both submission notices",
    async () => {
      answer = { ...empty };
      dom.window.localStorage.clear();
      await mount(
        <ObjectiveAnswer
          id={challenge.id}
          scope="cup"
          title={challenge.title}
          definition={definition}
          contestLogic={logic}
        />,
      );
      await click(document.querySelector('[role="radio"][value="A"]'));
      let before = writes.length;
      await click(button("保存答案"));
      await settle(
        () => writes.length === before + 1 && !button("保存答案")?.disabled,
      );
      assert.equal(writes.at(-1)?.body?.finalize, false);
      assert(!document.querySelector('[role="dialog"]'));
      before = writes.length;
      await click(button("提交答案"));
      assert(
        document
          .querySelector('[role="dialog"]')
          ?.textContent?.includes("提交后不能修改"),
      );
      await click(button("继续检查"));
      assert.equal(writes.length, before);
      await click(button("提交答案"));
      await click(button("确认提交"));
      assert(
        document
          .querySelector('[role="dialog"]')
          ?.textContent?.includes("固定路线"),
      );
      await click(button("取消"));
      assert.equal(writes.length, before);
      assert.equal(answer.finalized_at, null);
      await click(button("提交答案"));
      await click(button("确认提交"));
      await settle(() => writes.length === before + 1 && !button("提交答案"));
      assert.equal(writes.at(-1)?.body?.finalize, true);
      answer = { ...empty, answer: { choices: ["A"] } };
      await mount(
        <ObjectiveAnswer
          id={challenge.id}
          scope="cup"
          title={challenge.title}
          definition={definition}
          contestLogic={{ ...logic, exclusive_selected: true }}
        />,
      );
      before = writes.length;
      await click(button("提交答案"));
      assert(!document.querySelector('[role="dialog"]'));
      await settle(() => writes.length === before + 1);
    },
  );

  function PaperView() {
    const model = useObjectivePaper("cup", true, true);
    return <ObjectivePaper scope="cup" model={model} focus={null} active />;
  }
  await t.test(
    "paper requires an explicit branch, saves both drafts and finalizes only the chosen branch",
    async () => {
      dom.window.localStorage.clear();
      paper = {
        ...paper,
        items: ["route-a", "route-b", "plain"].map((id) => ({
          id,
          title: id,
          description: "",
          objective: definition,
          points: 100,
          permissions: { submit: true },
          saved: { ...empty },
          contest_logic: id === "plain" ? undefined : { ...logic },
        })),
      };
      await mount(<PaperView />);
      for (const q of paper.items)
        await click(
          document.querySelector(
            `#paper-question-${q.id} [role="radio"][value="A"]`,
          ),
        );
      assert(
        button("提交答卷")?.disabled,
        "answer order must not choose a branch",
      );
      let before = writes.length;
      await click(button("保存草稿"));
      await settle(
        () =>
          writes.length === before + 1 && button("保存草稿")?.disabled === true,
      );
      assert.equal(writes.at(-1)?.body?.finalize, false);
      assert.deepEqual(
        writes.at(-1)?.body?.answers?.map((q) => q.id),
        ["route-a", "route-b", "plain"],
      );
      assert(!document.querySelector('[role="dialog"]'));
      await click(
        document.querySelector(
          '[aria-label="路线甲 提交题目"] [value="route-b"]',
        ),
      );
      await click(button("提交答卷"));
      assert(
        document
          .querySelector('[role="dialog"]')
          ?.textContent?.includes("提交后不能修改"),
      );
      await click(button("确认交卷"));
      assert(
        document
          .querySelector('[role="dialog"]')
          ?.textContent?.includes("route-b · 路线甲"),
      );
      before = writes.length;
      await click(button("取消"));
      assert.equal(writes.length, before);
      await click(button("提交答卷"));
      await click(button("确认提交"));
      await settle(
        () =>
          writes.length === before + 1 &&
          !document.querySelector('[role="dialog"]'),
      );
      assert.equal(writes.at(-1)?.body?.finalize, true);
      assert.deepEqual(
        writes.at(-1)?.body?.answers?.map((q) => q.id),
        ["route-b", "plain"],
      );
      assert.equal(
        paper.items.find((q) => q.id === "route-a")?.saved.finalized_at,
        null,
      );
      paper = {
        ...paper,
        items: paper.items
          .filter((q) => q.id !== "route-a")
          .map((q) => ({
            ...q,
            saved: { ...empty, answer: { choices: ["A"] } },
            contest_logic: q.contest_logic
              ? { ...q.contest_logic, exclusive_selected: true }
              : undefined,
          })),
      };
      await mount(<PaperView />);
      assert(!document.querySelector('[aria-label="路线甲 提交题目"]'));
      before = writes.length;
      await click(button("提交答卷"));
      assert(!document.querySelector('[role="dialog"]'));
      await settle(() => writes.length === before + 1);
      assert.deepEqual(
        writes.at(-1)?.body?.answers?.map((q) => q.id),
        ["route-b", "plain"],
      );
    },
  );

  function LiveQuestions() {
    useContestRealtime("cup");
    const list = useAPI<{ items: { title: string }[] }>(listPath);
    const current = useAPI<Paper>(paperPath);
    return (
      <div>
        {list.data?.items.map((q) => q.title).join(",")}
        {current.data?.items.map((q) => q.title).join(",")}
      </div>
    );
  }
  await t.test(
    "opaque logic revisions refresh visible questions and paper even while activity is frozen",
    async () => {
      await mount(<LiveQuestions />);
      const socket = Socket.instances.at(-1)!;
      assert(socket);
      challenge = { ...challenge, title: "全场解锁题" };
      paper = {
        ...paper,
        items: [
          { ...paper.items[0]!, id: "unlocked", title: "全场解锁客观题" },
        ],
      };
      await act(async () => {
        socket.onmessage?.({
          data: JSON.stringify({ type: "logic", revision: "opaque-revision" }),
        });
      });
      await settle(() =>
        document
          .getElementById("root")!
          .textContent!.includes("全场解锁客观题"),
      );
      assert(
        document.getElementById("root")!.textContent!.includes("全场解锁题"),
      );
      assert.equal(
        cache.getQueryData<{ frozen: boolean }>(["/contests/cup/activity"])
          ?.frozen,
        true,
      );
    },
  );
});
