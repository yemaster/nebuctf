import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test(
  "standalone administration and cross-page editing",
  { timeout: 30000 },
  async (t) => {
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
    });
    const original = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      Element: dom.window.Element,
      SVGElement: dom.window.SVGElement,
      FormData: dom.window.FormData,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      MutationObserver: dom.window.MutationObserver,
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
        configurable: true,
        writable: true,
        value,
      });
    }
    original.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } =
      await import("@tanstack/react-query");
    const { MemoryRouter } = await import("react-router-dom");
    const { App } = await import("../src/App");
    const id = "10000000-0000-4000-8000-000000000001";
    const challenges = Array.from({ length: 29 }, (_, i) => ({
      id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `题目 ${i + 1}`,
      category: ["Web", "Pwn", "Crypto"][i % 3]!,
      difficulty: "入门",
      kind: "static_attachment",
      published: false,
      publish_at: i === 0 ? "2030-01-01T00:00:00.000Z" : null,
      practice: i % 2 === 0,
      challenge_type: "ctf",
      parts: [],
      hints: [],
      contests: [],
      initial_points: 500,
      minimum_points: 100,
      decay: 20,
      image: "",
      internal_port: 80,
      access_mode: "port",
      cpu: 0.5,
      memory_mb: 128,
      pids: 64,
      ttl: 1800,
      dynamic_score: true,
      description: "题面",
      attachment_count: 0,
    }));
    const contest = {
      id,
      title: "分页赛题",
      description: "规则",
      starts_at: "2030-01-01T00:00:00.000Z",
      ends_at: "2030-01-02T00:00:00.000Z",
      freeze_at: null,
      team_limit: 4,
      published: true,
      groups: [],
      challenge_ids: challenges.slice(0, 13).map((c) => c.id),
      teams: 0,
    };
    const article = {
      id,
      title: "教程",
      slug: "intro",
      category: "Web",
      kind: "tutorial",
      body: "正文",
      published: true,
    };
    const tree = {
      id,
      title: "Web 路线",
      description: "",
      published: true,
      nodes: [
        {
          id: "start",
          title: "基础",
          article_id: id,
          challenge_id: null,
          prerequisites: [],
          position: { x: -120, y: 80 },
          article_title: "教程",
        },
        {
          id: "next",
          title: "进阶",
          article_id: null,
          challenge_id: challenges[0]!.id,
          prerequisites: ["start"],
          position: { x: 400, y: 180 },
          challenge_title: "题目 1",
        },
      ],
    };
    const container = document.getElementById("root")!;
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>;
    let role = "admin";
    let releasePublication: (() => void) | undefined,
      publicationFails = false;
    const selections: { ids: string; page_size: number }[] = [];
    const requests: string[] = [],
      writes: { path: string; method: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), "http://localhost"),
        path = url.pathname.replace(/^\/api/, "");
      requests.push(path + url.search);
      if (path === "/admin/challenges/search") {
        const body = JSON.parse(String(init?.body));
        selections.push(body);
        Object.entries(body).forEach(([key, value]) =>
          url.searchParams.set(key, String(value)),
        );
      }
      if (
        init?.method &&
        init.method !== "GET" &&
        path !== "/admin/challenges/search"
      ) {
        writes.push({
          path,
          method: init.method,
          body: JSON.parse(String(init.body)),
        });
        if (path === "/admin/challenges" && init.method === "POST") {
          const created = {
            ...challenges[0]!,
            ...JSON.parse(String(init.body)),
            id: "30000000-0000-4000-8000-000000000001",
          };
          delete created.flag;
          challenges.push(created);
          return Response.json({ id: created.id });
        }
        if (path.endsWith("/publication")) {
          await new Promise<void>((resolve) => {
            releasePublication = resolve;
          });
          if (publicationFails)
            return Response.json({ error: "状态保存失败" }, { status: 503 });
          const c = challenges.find((c) => path.includes(c.id))!;
          Object.assign(c, JSON.parse(String(init.body)));
        }
        return Response.json({ id });
      }
      let value: any = { items: [], total: 0 };
      if (path === "/me")
        value = { user: { id: "admin", username: "管理员", role } };
      else if (
        ["/admin/challenges", "/admin/challenges/search"].includes(path)
      ) {
        const page = Number(url.searchParams.get("page") || 1),
          size = Number(url.searchParams.get("page_size") || 24);
        const ids = url.searchParams.get("ids")?.split(","),
          q = url.searchParams.get("q") || "";
        const rows = challenges.filter(
          (c) =>
            (!ids || ids.includes(c.id)) &&
            c.title.includes(q) &&
            (!url.searchParams.get("category") ||
              c.category === url.searchParams.get("category")) &&
            (!url.searchParams.get("practice") ||
              String(c.practice) === url.searchParams.get("practice")) &&
            (!url.searchParams.get("challenge_type") ||
              c.challenge_type === url.searchParams.get("challenge_type")),
        );
        if (ids) rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        value = {
          items: rows.slice((page - 1) * size, page * size),
          total: rows.length,
        };
      } else if (path.startsWith("/admin/challenges/"))
        value = challenges.find((c) => c.id === path.split("/").at(-1));
      else if (path === `/admin/contests/${id}`) value = contest;
      else if (path === `/admin/articles/${id}`) value = article;
      else if (path === `/admin/learning/trees/${id}`) value = tree;
      else if (path === `/admin/problemsets/${id}`)
        value = {
          id,
          title: "题单",
          description: "",
          published: true,
          challenges: challenges.map((c) => ({ id: c.id, title: c.title })),
        };
      else if (path === `/admin/announcements/${id}`)
        value = { id, title: "通知", body: "正文", contest_id: null };
      return Response.json(value);
    };
    async function settle(predicate: () => boolean) {
      for (let i = 0; i < 100 && !predicate(); i++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      assert.ok(predicate(), "page settled");
    }
    async function mount(path: string) {
      if (root) await cleanup();
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      requests.length = writes.length = selections.length = 0;
      root = createRoot(container);
      await act(async () =>
        root!.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[path]}>
              <App />
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
      await settle(
        () =>
          !!container.querySelector(
            role === "admin" ? '[aria-label="管理导航"]' : "h1",
          ),
      );
    }
    async function cleanup() {
      if (root) await act(async () => root!.unmount());
      root = undefined;
      cache?.clear();
    }
    async function click(element: Element | null) {
      assert.ok(element);
      await act(async () =>
        element.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    async function change(element: HTMLInputElement, value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(element, value);
        element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    }
    const button = (text: string, within: Element = container) =>
      Array.from(within.querySelectorAll("button")).find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text,
      ) ?? null;
    try {
      await t.test(
        "list paging, search reset, sidebar persistence and return links",
        async () => {
          await mount("/admin/challenges?page=2");
          await settle(() => container.textContent!.includes("题目 11"));
          assert.equal(container.querySelectorAll("tbody tr").length, 10);
          const sidebar = container.querySelector('[data-slot="sidebar"]');
          await change(container.querySelector('input[name="q"]')!, "题目 1");
          await act(async () =>
            container.querySelector('form[role="search"]')!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
          await settle(() => requests.some((p) => p.includes("page=1&q=")));
          await settle(
            () => container.querySelectorAll("tbody tr").length === 10,
          );
          assert.match(container.textContent!, /CTF 题/);
          await click(button("下一页"));
          await settle(
            () => container.querySelectorAll("tbody tr").length === 1,
          );
          await click(button("上一页"));
          await settle(
            () => container.querySelectorAll("tbody tr").length === 10,
          );
          await click(container.querySelector('a[aria-label="编辑 题目 1"]'));
          await settle(() => !!container.querySelector("#challenge-form"));
          assert.equal(
            container.querySelector('[data-slot="sidebar"]'),
            sidebar,
          );
          assert.equal(container.querySelector('[role="dialog"]'), null);
          assert.match(
            container
              .querySelector('a[aria-label="返回列表"]')!
              .getAttribute("href")!,
            /page=1&q=/,
          );
          assert.equal(
            container.querySelector('input[name="publish_at"]'),
            null,
          );
          await cleanup();
        },
      );
      await t.test(
        "publication switch saves in place, blocks repeat operations and rolls back on failure",
        async () => {
          await mount("/admin/challenges");
          await settle(
            () => !!container.querySelector('[aria-label="启用 题目 1"]'),
          );
          const control = () =>
            container.querySelector<HTMLButtonElement>(
              '[aria-label="启用 题目 1"]',
            )!;
          await click(control());
          await settle(() => !!releasePublication && control().disabled);
          assert.equal(control().getAttribute("aria-checked"), "true");
          assert.equal(container.querySelector("#challenge-form"), null);
          await act(async () => releasePublication!());
          await settle(() => !control().disabled);
          assert.equal(control().getAttribute("aria-checked"), "true");
          assert.equal(writes.at(-1)!.body.publish_at, null);
          publicationFails = true;
          releasePublication = undefined;
          await click(control());
          await settle(() => !!releasePublication && control().disabled);
          assert.equal(control().getAttribute("aria-checked"), "false");
          await act(async () => releasePublication!());
          await settle(() => !control().disabled);
          assert.equal(control().getAttribute("aria-checked"), "true");
          publicationFails = false;
          await cleanup();
        },
      );
      await t.test(
        "every content type has independent new and edit routes",
        async () => {
          for (const [section, form, existingId] of [
            ["challenges", "challenge", challenges[0]!.id],
            ["contests", "contest", id],
            ["problemsets", "problemset", id],
            ["articles", "article", id],
            ["announcements", "announcement", id],
            ["learning", "tree", id],
          ]) {
            for (const suffix of ["new", `${existingId}/edit`]) {
              await mount(`/admin/${section}/${suffix}`);
              await settle(() => !!container.querySelector(`#${form}-form`));
              assert.equal(container.querySelector('[role="dialog"]'), null);
              assert.equal(container.querySelectorAll("form form").length, 0);
              assert.ok(container.querySelector(`button[form="${form}-form"]`));
              await cleanup();
            }
          }
        },
      );
      await t.test(
        "contest edits retain off-page selections and save all selected ids",
        async () => {
          await mount(
            `/admin/contests/${id}/edit?return=${encodeURIComponent("/admin/contests?page=2")}`,
          );
          await settle(() => !!button("收起选题"));
          await act(async () => {
            const tab = [...container.querySelectorAll('[role="tab"]')].find(
              (el) => el.textContent === "赛题设置",
            )!;
            tab.dispatchEvent(
              new dom.window.MouseEvent("mousedown", {
                bubbles: true,
                button: 0,
              }),
            );
          });
          await settle(
            () => !!container.querySelector('[aria-label="选择 题目 1"]'),
          );
          const picker = container.querySelector('[aria-label="选择题目"]')!;
          assert.equal(picker.querySelectorAll('[role="checkbox"]').length, 10);
          assert.match(picker.textContent!, /练习场已开放|练习题/);
          await click(button("下一页", picker));
          await settle(
            () => !!container.querySelector('[aria-label="选择 题目 14"]'),
          );
          assert.equal(
            container
              .querySelector('[aria-label="选择 题目 13"]')!
              .getAttribute("data-state"),
            "checked",
          );
          await click(container.querySelector('[aria-label="选择 题目 14"]'));
          const chosen = container.querySelector('[aria-label="已选赛题"]')!;
          await settle(
            () =>
              chosen.querySelectorAll("[data-selected-question]").length === 14,
          );
          assert.equal(picker.querySelector("button[aria-pressed]"), null);
          assert.equal(
            chosen.querySelectorAll('[aria-label="Web 已选赛题"] li').length,
            5,
          );
          assert.equal(
            chosen.querySelectorAll('[aria-label="Pwn 已选赛题"] li').length,
            5,
          );
          assert.equal(
            chosen.querySelectorAll('[aria-label="Crypto 已选赛题"] li').length,
            4,
          );
          await change(
            picker.querySelector('[aria-label="搜索可添加题目"]')!,
            "题目 29",
          );
          await click(button("搜索题目", picker));
          await settle(
            () => !!picker.querySelector('[aria-label="选择 题目 29"]'),
          );
          assert.equal(picker.querySelectorAll('[role="checkbox"]').length, 1);
          assert.equal(
            chosen.querySelectorAll("[data-selected-question]").length,
            14,
          );
          await click(button("移除已选 题目 14", chosen));
          await click(button("移除已选 题目 13", chosen));
          assert.equal(
            chosen.querySelectorAll("[data-selected-question]").length,
            12,
          );
          await change(
            picker.querySelector('[aria-label="搜索可添加题目"]')!,
            "题目 14",
          );
          await click(button("搜索题目", picker));
          await settle(
            () => !!picker.querySelector('[aria-label="选择 题目 14"]'),
          );
          assert.equal(
            picker
              .querySelector('[aria-label="选择 题目 14"]')!
              .getAttribute("aria-checked"),
            "false",
          );
          await click(button("收起选题"));
          await settle(() => !!button("设置 题目 1"));
          const schedule = container.querySelector('[aria-label="赛题配置"]')!;
          await click(button("下一页", schedule));
          await settle(() => !!button("设置 题目 11"));
          await click(button("上移 题目 11"));
          await settle(
            () => !!button("设置 题目 11") && !!button("设置 题目 1"),
          );
          const order = [
            ...schedule.querySelectorAll("[data-question-id]"),
          ].map((el) => el.getAttribute("data-question-id"));
          assert.equal(order.at(-1), challenges[10]!.id);
          await act(async () =>
            container.querySelector("#contest-form")!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
          await settle(() =>
            writes.some((w) => w.path === `/admin/contests/${id}`),
          );
          const saved = writes.find((w) => w.path === `/admin/contests/${id}`)!;
          assert.equal(saved.method, "PUT");
          assert.deepEqual(
            saved.body.challenge_ids,
            [
              ...challenges.slice(0, 9),
              challenges[10]!,
              challenges[9]!,
              challenges[11]!,
            ].map((c) => c.id),
          );
          await settle(() => !button("保存比赛")?.hasAttribute("disabled"));
          assert(container.querySelector("#contest-form"));
          assert(button("设置 题目 11"));
          await cleanup();
        },
      );
      await t.test(
        "grouped selection loads all 200 questions and honors the started contest lock",
        async () => {
          const count = challenges.length,
            previous = contest.challenge_ids,
            starts = contest.starts_at;
          for (let i = count; i < 200; i++)
            challenges.push({
              ...challenges[0]!,
              id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
              title: `题目 ${i + 1}`,
              category: ["Web", "Pwn", "Crypto"][i % 3]!,
            });
          contest.challenge_ids = challenges.map((c) => c.id);
          contest.starts_at = new Date(Date.now() - 60000).toISOString();
          try {
            await mount(`/admin/contests/${id}/edit`);
            const chosen = () =>
              container.querySelector('[aria-label="已选赛题"]')!;
            await settle(
              () =>
                chosen()?.querySelectorAll("[data-selected-question]")
                  .length === 200,
            );
            assert.equal(
              chosen().querySelectorAll('[aria-label="Web 已选赛题"] li')
                .length,
              67,
            );
            assert.equal(
              chosen().querySelectorAll('[aria-label="Pwn 已选赛题"] li')
                .length,
              67,
            );
            assert.equal(
              chosen().querySelectorAll('[aria-label="Crypto 已选赛题"] li')
                .length,
              66,
            );
            assert(button("移除已选 题目 200", chosen())!.disabled);
            assert(
              container.querySelector<HTMLButtonElement>(
                '[aria-label="选择 题目 1"]',
              )!.disabled,
            );
            const batches = selections.filter((s) => s.page_size === 100);
            assert.equal(batches.length, 2);
            assert(batches.every((s) => s.ids.split(",").length === 100));
            assert.equal(writes.length, 0);
          } finally {
            await cleanup();
            challenges.splice(count);
            contest.challenge_ids = previous;
            contest.starts_at = starts;
          }
        },
      );
      await t.test(
        "graph page edits node content and preserves dependencies and coordinates",
        async () => {
          await mount(`/admin/learning/${id}/edit`);
          await settle(() => !!container.querySelector("#tree-form"));
          await change(
            container.querySelector('[aria-label="节点名称"]')!,
            "基础知识",
          );
          await act(async () =>
            container.querySelector("#tree-form")!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
          await settle(() => writes.length > 0);
          const saved = writes[0]!.body;
          assert.equal(saved.nodes[0].title, "基础知识");
          assert.deepEqual(saved.nodes[0].position, { x: -120, y: 80 });
          assert.deepEqual(saved.nodes[1].prerequisites, ["start"]);
          await cleanup();
        },
      );
      await t.test(
        "tree arrangement and child creation preserve prerequisites",
        async () => {
          await mount(`/admin/learning/${id}/edit`);
          await settle(() => !!container.querySelector("#tree-form"));
          await click(button("树形排列"));
          await act(async () =>
            container.querySelector("#tree-form")!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
          await settle(() => writes.length > 0);
          const saved = writes[0]!.body;
          assert.equal(saved.nodes[0].position.x, saved.nodes[1].position.x);
          assert.ok(saved.nodes[0].position.y < saved.nodes[1].position.y);
          assert.deepEqual(saved.nodes[1].prerequisites, ["start"]);
          await cleanup();
          await mount(`/admin/learning/${id}/edit`);
          await settle(() => !!container.querySelector("#tree-form"));
          await click(button("添加子节点"));
          await settle(
            () => container.querySelectorAll(".react-flow__node").length === 3,
          );
          assert.equal(
            (
              container.querySelector(
                '[aria-label="节点名称"]',
              ) as HTMLInputElement
            ).value,
            "",
          );
          assert.equal(
            container.querySelectorAll('button[aria-label="移除前置依赖"]')
              .length,
            1,
          );
          assert.ok(
            container.querySelector("aside")!.textContent!.includes("基础"),
          );
          await cleanup();
        },
      );
      await t.test(
        "creating a challenge continues in its editor and enables attachments without losing the return destination",
        async () => {
          const destination = "/admin/challenges?page=2&q=draft";
          await mount(
            `/admin/challenges/new?return=${encodeURIComponent(destination)}`,
          );
          await settle(() => !!container.querySelector("#challenge-form"));
          await change(
            container.querySelector('input[name="title"]')!,
            "New draft",
          );
          await change(
            container.querySelector('input[name="flag"]')!,
            "flag{draft}",
          );
          await act(async () => {
            container.querySelector("#challenge-form")!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(() =>
            requests.includes(
              "/admin/challenges/30000000-0000-4000-8000-000000000001",
            ),
          );
          await settle(
            () =>
              !!container.querySelector<HTMLInputElement>(
                'input[type="file"]',
              ) &&
              !container.querySelector<HTMLInputElement>('input[type="file"]')!
                .disabled,
          );
          assert.equal(
            container.querySelector<HTMLInputElement>('input[name="title"]')!
              .value,
            "New draft",
          );
          assert.equal(
            container
              .querySelector('a[aria-label="返回列表"]')!
              .getAttribute("href"),
            destination,
          );
          assert.equal(container.querySelectorAll("form form").length, 0);
          await cleanup();
        },
      );
      await t.test(
        "ordinary users cannot open administration or fetch its data",
        async () => {
          role = "user";
          await mount("/admin/challenges/new");
          await settle(() => container.textContent!.includes("403"));
          assert.equal(container.querySelector("#challenge-form"), null);
          assert.equal(
            requests.some((p) => p.startsWith("/admin/")),
            false,
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
  },
);
