import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test(
  "resource, flag, directory and team interactions",
  { timeout: 15000 },
  async (t) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });
    Object.assign(dom.window, {
      matchMedia: () => ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    const original = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      CustomEvent: dom.window.CustomEvent,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      HTMLInputElement: dom.window.HTMLInputElement,
      Element: dom.window.Element,
      SVGElement: dom.window.SVGElement,
      MutationObserver: dom.window.MutationObserver,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
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
    const { MemoryRouter } = await import("react-router-dom");
    const { QueryClient, QueryClientProvider } =
      await import("@tanstack/react-query");
    const { App } = await import("../src/App");
    const id = "10000000-0000-4000-8000-000000000001";
    const challenge = {
      id,
      title: "分步题",
      category: "Misc",
      difficulty: "入门",
      kind: "static_attachment",
      description: "题面",
      points: 200,
      solves: 0,
      solved: false,
      solved_parts: 0,
      total_parts: 2,
      hints: [],
      attachments: [],
      parts: [
        { id: "a", title: "第一步", points: 100, solves: 0, solved: false },
        { id: "b", title: "第二步", points: 100, solves: 0, solved: false },
      ],
    };
    const instance = {
      id,
      challenge_id: id,
      title: "测试靶机",
      scope: "practice",
      kind: "dynamic_container",
      shared: false,
      status: "running",
      endpoint: "localhost:32000",
      created_at: new Date(Date.now() - 10_000).toISOString(),
      expires_at: new Date(Date.now() + 1800_000).toISOString(),
      ttl: 1800,
    };
    const container = document.getElementById("root")!;
    let cache: InstanceType<typeof QueryClient>,
      root: ReturnType<typeof createRoot>;
    const requests: string[] = [];
    let responses: Record<string, any>;
    async function mount(path: string, extra: Record<string, any> = {}) {
      responses = {
        "/me": { user: { id: "player", username: "选手", role: "user" } },
        "/teams/mine": { items: [] },
        "/contests": { items: [] },
        [`/challenges?scope=practice&category=&q=&page=1`]: {
          items: [challenge],
          total: 1,
        },
        [`/challenges/${id}?scope=practice`]: challenge,
        [`/challenges/${id}/submit`]: { correct: false, completed: false },
        "/instances?scope=practice&owned=true": { items: [instance] },
        ...extra,
      };
      requests.length = 0;
      globalThis.fetch = async (input) => {
        const path = String(input).replace(/^\/api/, "");
        requests.push(path);
        if (responses[path] instanceof Response) return responses[path].clone();
        return new Response(JSON.stringify(responses[path] ?? {}), {
          status: 200,
        });
      };
      cache = new QueryClient({
        defaultOptions: {
          mutations: { gcTime: Infinity },
          queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        },
      });
      cache.setQueryData(["/site"], {
        name: "NebuCTF",
        footer_text: "",
        footer_link_label: "",
        footer_link_url: "",
        email_verification: false,
      });
      Object.entries(responses).forEach(([path, data]) =>
        cache.setQueryData([path], data),
      );
      root = createRoot(container);
      await act(async () =>
        root.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[path]}>
              <App />
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
    }
    async function click(element: Element) {
      await act(async () => {
        element.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    async function cleanup() {
      await act(async () => root.unmount());
      cache.clear();
    }
    async function settle(check: () => boolean) {
      for (let n = 0; n < 40 && !check(); n++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      assert.ok(check());
    }
    try {
      await t.test(
        "practice rows open from their score and preserve filters for normal and modified clicks",
        async () => {
          await mount("/challenges?page=3&category=Misc&q=flag", {
            "/challenges?scope=practice&category=Misc&q=flag&page=3": {
              items: [challenge],
              total: 73,
            },
          });
          await settle(
            () => !!container.querySelector('ul[aria-label="题目列表"] a'),
          );
          const row = container.querySelector('ul[aria-label="题目列表"] a')!;
          const href = new URL(row.getAttribute("href")!, "http://localhost");
          assert.equal(href.pathname, "/challenges");
          assert.equal(href.searchParams.get("page"), "3");
          assert.equal(href.searchParams.get("category"), "Misc");
          assert.equal(href.searchParams.get("q"), "flag");
          assert.equal(href.searchParams.get("challenge"), id);
          const score = row.querySelector('[aria-label="200 分"]')!;
          assert.ok(score);
          assert.ok(row.querySelector('[aria-label="未完成"]'));
          for (const modifier of ["ctrlKey", "metaKey"]) {
            let intercepted: boolean | undefined;
            document.addEventListener(
              "click",
              (event) => {
                intercepted = event.defaultPrevented;
                event.preventDefault(); // jsdom cannot open a browser tab.
              },
              { once: true },
            );
            await act(async () => {
              score.dispatchEvent(
                new dom.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  [modifier]: true,
                }),
              );
            });
            assert.equal(intercepted, false);
            assert.equal(container.querySelector(`#flag-${id}`), null);
          }
          await click(score);
          await settle(() => !!container.querySelector(`#flag-${id}`));
          const back = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "返回题库",
          )!;
          await click(back);
          await settle(
            () => !!container.querySelector('ul[aria-label="题目列表"] a'),
          );
          assert.equal(
            container
              .querySelector('ul[aria-label="题目列表"] a')!
              .getAttribute("href"),
            href.pathname + href.search,
          );
          await cleanup();
        },
      );
      await t.test(
        "problemset rows open an isolated ordered directory and return to the original page",
        async () => {
          const nextId = "10000000-0000-4000-8000-000000000002";
          const next = { ...challenge, id: nextId, title: "题单第二题" };
          await mount(`/problemsets/${id}?page=2`, {
            [`/problemsets/${id}?page=2`]: {
              id,
              title: "入门题单",
              total: 26,
              completed: 0,
              items: [next, challenge],
            },
            [`/challenges/${nextId}?scope=practice`]: next,
            "/challenges?scope=practice&category=&q=&page=2": {
              items: [{ ...challenge, title: "题单外的练习" }],
              total: 1,
            },
          });
          await settle(
            () => !!container.querySelector('ul[aria-label="题目列表"] a'),
          );
          const row = container.querySelectorAll(
            'ul[aria-label="题目列表"] a',
          )[1]!;
          const href = new URL(row.getAttribute("href")!, "http://localhost");
          assert.equal(href.searchParams.get("problemset"), id);
          assert.equal(href.searchParams.get("page"), "2");
          await click(row.querySelector('[aria-label="未完成"]')!);
          await settle(() => !!container.querySelector(`#flag-${id}`));
          const directory = container.querySelector('[aria-label="题单题目"]')!;
          assert.ok(directory);
          assert.ok(!directory.textContent?.includes("题单外的练习"));
          assert.ok(
            directory.textContent!.indexOf("题单第二题") <
              directory.textContent!.indexOf("分步题"),
          );
          await click(
            [...directory.querySelectorAll("button")].find((b) =>
              b.textContent?.includes("题单第二题"),
            )!,
          );
          await settle(() => !!container.querySelector(`#flag-${nextId}`));
          const back = [...container.querySelectorAll("a")].find(
            (a) => a.textContent === "返回题单",
          )!;
          assert.equal(back.getAttribute("href"), `/problemsets/${id}?page=2`);
          await click(back);
          await settle(
            () => !!container.querySelector('ul[aria-label="题目列表"] a'),
          );
          assert.equal(
            container.querySelectorAll('ul[aria-label="题目列表"] a').length,
            2,
          );
          assert.ok(!requests.some((path) => path.startsWith("/challenges?")));
          await cleanup();
        },
      );
      await t.test(
        "a refreshed problemset workspace keeps scoped paging and category filters",
        async () => {
          await mount(`/challenges?problemset=${id}&challenge=${id}&page=2`, {
            [`/problemsets/${id}?page=2`]: {
              title: "入门题单",
              total: 25,
              filtered_total: 25,
              items: [challenge],
            },
            [`/problemsets/${id}?page=1`]: {
              title: "入门题单",
              total: 25,
              filtered_total: 25,
              items: [challenge],
            },
            [`/problemsets/${id}?page=1&category=Misc`]: {
              title: "入门题单",
              total: 25,
              filtered_total: 1,
              items: [challenge],
            },
          });
          await settle(
            () => !!container.querySelector('[aria-label="题单题目"]'),
          );
          await click(container.querySelector('[aria-label="上一页"]')!);
          await settle(
            () =>
              container
                .querySelector('a[href*="/problemsets/"]')
                ?.getAttribute("href") === `/problemsets/${id}?page=1`,
          );
          await act(async () => {
            const select = container.querySelector(
              '[aria-label="题目分类"]',
            ) as HTMLSelectElement;
            select.value = "Misc";
            select.dispatchEvent(
              new dom.window.Event("change", { bubbles: true }),
            );
          });
          await settle(
            () =>
              cache.getQueryState([`/problemsets/${id}?page=1&category=Misc`])
                ?.isInvalidated === false,
          );
          assert.equal(container.querySelector('[aria-label="下一页"]'), null);
          assert.ok(
            container
              .querySelector('[aria-label="题单题目"]')
              ?.textContent?.includes("分步题"),
          );
          assert.ok(!container.querySelector('[aria-label="返回题库"]'));
          assert.ok(!requests.some((path) => path.startsWith("/challenges?")));
          await cleanup();
        },
      );
      await t.test(
        "running resources show measured lifetime and adjacent copy/open icons; queued resources do not count down",
        async () => {
          await mount("/instances");
          assert.ok(
            container.querySelector(
              '[role="progressbar"][aria-label="靶机剩余时间"]',
            ),
          );
          const copy = container.querySelector('[aria-label="复制地址"]')!;
          const open = container.querySelector('a[aria-label="打开靶机"]')!;
          assert.equal(copy.parentElement, open.parentElement);
          assert.equal(open.getAttribute("target"), "_blank");
          assert.ok(!container.textContent?.includes("到期自动释放"));
          await cleanup();
          await mount("/instances", {
            "/instances?scope=practice&owned=true": {
              items: [{ ...instance, status: "queued", endpoint: null }],
            },
          });
          assert.equal(
            container.querySelector('[aria-label="靶机剩余时间"]'),
            null,
          );
          assert.ok(container.textContent?.includes("正在排队"));
          await cleanup();
        },
      );
      await t.test(
        "container and attachment lifetime waits for creation completion to leave",
        async () => {
          for (const attachment of [false, true]) {
            const row = {
              ...instance,
              kind: attachment ? "dynamic_attachment" : "dynamic_container",
              status: "starting",
              endpoint: null,
            };
            const path = "/instances?scope=practice&owned=true";
            await mount("/instances", { [path]: { items: [row] } });
            try {
              const lifetime = () =>
                container.querySelector(
                  `[role="progressbar"][aria-label="${attachment ? "附件" : "靶机"}剩余时间"]`,
                );
              assert.equal(lifetime(), null);
              responses[path] = {
                items: [{ ...row, status: attachment ? "ready" : "running" }],
              };
              await act(async () =>
                cache.setQueryData([path], responses[path]),
              );
              assert.equal(
                lifetime(),
                null,
                "ready does not bypass completion feedback",
              );
              await settle(
                () =>
                  !!container.querySelector(
                    `[role="progressbar"][aria-label="${attachment ? "专属附件已生成" : "靶机已就绪"}"]`,
                  ),
              );
              assert.equal(
                lifetime(),
                null,
                "success hold still owns the progress area",
              );
              assert.equal(
                container.querySelectorAll('[role="progressbar"]').length,
                1,
              );
              await act(async () => {
                await new Promise((r) => setTimeout(r, 900));
              });
              assert(lifetime());
              assert.equal(
                container.querySelectorAll('[role="progressbar"]').length,
                1,
              );
            } finally {
              await cleanup();
            }
          }
        },
      );
      await t.test(
        "failed resources retain error guidance and cooldown blocks destructive operations",
        async () => {
          await mount("/instances", {
            "/instances?scope=practice&owned=true": {
              items: [
                {
                  ...instance,
                  next_operation_at: new Date(
                    Date.now() + 60_000,
                  ).toISOString(),
                },
              ],
            },
          });
          const stop = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("秒后可销毁"),
          );
          assert.ok(stop?.disabled);
          await cleanup();
          await mount("/instances", {
            "/instances?scope=practice&owned=true": {
              items: [{ ...instance, status: "failed", error: "环境创建失败" }],
            },
          });
          assert.ok(
            container
              .querySelector('[role="alert"]')
              ?.textContent?.includes("环境创建失败"),
          );
          assert.ok(
            container.querySelector(`a[href="/challenges?challenge=${id}"]`),
          );
          await cleanup();
        },
      );
      await t.test(
        "wrong flag preserves the same input, reports invalid state, and multipart directory toggles",
        async () => {
          await mount(`/challenges?challenge=${id}`);
          const trigger = container.querySelector(
            '[aria-label="分步题 小题展开或折叠"]',
          )!;
          assert.equal(trigger.getAttribute("aria-expanded"), "true");
          await click(trigger);
          assert.equal(trigger.getAttribute("aria-expanded"), "false");
          await click(trigger);
          assert.equal(trigger.getAttribute("aria-expanded"), "true");
          const input = container.querySelector(
            `#flag-${id}`,
          ) as HTMLInputElement;
          await act(async () => {
            Object.getOwnPropertyDescriptor(
              dom.window.HTMLInputElement.prototype,
              "value",
            )!.set!.call(input, "wrong");
            input.dispatchEvent(
              new dom.window.Event("input", { bubbles: true }),
            );
          });
          await act(async () => {
            input.closest("form")!.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(() => input.getAttribute("aria-invalid") === "true");
          assert.equal(container.querySelector(`#flag-${id}`), input);
          assert.equal(input.value, "wrong");
          const alert = container.querySelector(
            `#feedback-${id} [role="alert"]`,
          )!;
          assert.equal(alert.textContent, "Flag 不正确");
          assert.equal(alert.querySelector("svg"), null);
          await cleanup();
        },
      );
      await t.test(
        "resource failures keep retry beside the title, collapse diagnostics, and retain limit guidance",
        async () => {
          const diagnostic =
            "Docker engine: " + "container could not be started\n".repeat(40);
          for (const kind of ["dynamic_container", "dynamic_attachment"]) {
            await mount(`/challenges?challenge=${id}`, {
              [`/challenges/${id}?scope=practice`]: { ...challenge, kind },
              [`/challenges/${id}/instance-policy?scope=practice&resource_type=container`]:
                {
                  next_operation_at: null,
                },
              "/instances?scope=practice": {
                items: [
                  { ...instance, kind, status: "failed", error: diagnostic },
                ],
              },
              [`/challenges/${id}/instances`]: Response.json(
                {
                  error: "已达到个人或战队环境数量上限",
                  action: {
                    label: "释放不用的靶机",
                    href: "/instances?scope=practice",
                  },
                },
                { status: 409 },
              ),
            });
            await settle(
              () =>
                !!container.querySelector(
                  '[aria-label="题目资源"] [role="alert"]',
                ),
            );
            const resource = container.querySelector(
              '[aria-label="题目资源"] [data-slot="item"]',
            )!;
            const retry = [...resource.querySelectorAll("button")].find((b) =>
              b.textContent?.includes(
                kind === "dynamic_attachment" ? "重新生成" : "重试启动",
              ),
            )!;
            assert.ok(retry);
            assert.equal(resource.querySelector("pre"), null);
            assert.ok(
              !resource
                .querySelector('[role="alert"]')!
                .className.includes("bg-destructive"),
            );
            await click(
              [...resource.querySelectorAll("button")].find((b) =>
                b.textContent?.includes("错误详情"),
              )!,
            );
            assert.equal(
              resource.querySelector("pre")?.textContent,
              diagnostic,
            );
            await click(retry);
            await settle(
              () =>
                !!resource.querySelector('a[href="/instances?scope=practice"]'),
            );
            assert.equal(
              requests.filter((path) => path.endsWith("/instances")).length,
              1,
            );
            assert.ok(resource.contains(retry));
            assert.equal(resource.querySelectorAll('[role="alert"]').length, 1);
            await cleanup();
          }
        },
      );
      await t.test(
        "resource retry remains disabled during its cooldown",
        async () => {
          await mount(`/challenges?challenge=${id}`, {
            [`/challenges/${id}?scope=practice`]: {
              ...challenge,
              kind: "dynamic_container",
            },
            [`/challenges/${id}/instance-policy?scope=practice&resource_type=container`]:
              {
                next_operation_at: new Date(Date.now() + 60_000).toISOString(),
              },
            "/instances?scope=practice": {
              items: [{ ...instance, status: "failed", error: "启动失败" }],
            },
          });
          await settle(
            () => !!container.querySelector('[aria-label="题目资源"]'),
          );
          const retry = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("秒后可启动"),
          )!;
          assert.ok(retry.disabled);
          await click(retry);
          assert.equal(
            requests.filter((path) => path.endsWith("/instances")).length,
            0,
          );
          await cleanup();
        },
      );
      await t.test(
        "resource quota guidance prevents a request and clears when a slot is released",
        async () => {
          const policy = `/challenges/${id}/instance-policy?scope=practice&resource_type=container`;
          await mount(`/challenges?challenge=${id}`, {
            [`/challenges/${id}?scope=practice`]: {
              ...challenge,
              kind: "dynamic_container",
            },
            "/instances?scope=practice": { items: [] },
            [policy]: {
              next_operation_at: null,
              quota: {
                team_used: 1,
                team_limit: 1,
                total_used: 1,
                total_limit: 3,
                blocked: {
                  message: "本队靶机已达上限（1）",
                  action: { label: "管理靶机", href: "/instances" },
                },
              },
            },
          });
          try {
            const start = () =>
              [...container.querySelectorAll<HTMLButtonElement>("button")].find(
                (b) => b.textContent === "启动靶机",
              );
            await settle(() => !!start());
            assert(start()!.disabled);
            assert(container.textContent!.includes("本队 1 / 1"));
            assert(container.querySelector('a[href="/instances"]'));
            await click(start());
            assert(
              !requests.some((path) => path === `/challenges/${id}/instances`),
            );
            await act(async () =>
              cache.setQueryData([policy], {
                next_operation_at: null,
                quota: {
                  team_used: 0,
                  team_limit: 1,
                  total_used: 0,
                  total_limit: 3,
                  blocked: null,
                },
              }),
            );
            await settle(() => !!start() && !start()!.disabled);
            assert(!container.textContent!.includes("已达上限"));
          } finally {
            await cleanup();
          }
        },
      );
      await t.test(
        "starting at capacity asks for confirmation and names only the proposed replacements",
        async () => {
          const endpoint = `/challenges/${id}/instances`;
          await mount(`/challenges?challenge=${id}`, {
            [`/challenges/${id}?scope=practice`]: {
              ...challenge,
              kind: "dynamic_container",
            },
            "/instances?scope=practice": { items: [] },
            [`/challenges/${id}/instance-policy?scope=practice&resource_type=container`]:
              {
                next_operation_at: null,
                auto_destroy: true,
                quota: {
                  team_limit: 1,
                  team_used: 1,
                  total_limit: null,
                  total_used: 1,
                  blocked: {
                    message: "已达上限",
                    action: { label: "管理靶机", href: "/instances" },
                  },
                },
              },
            [endpoint]: {
              requires_confirmation: true,
              replacements: [{ id: "old-instance", title: "旧靶机题目" }],
            },
          });
          const writes: any[] = [],
            originalFetch = globalThis.fetch;
          globalThis.fetch = async (url, options) => {
            if (String(url) === `/api${endpoint}`) {
              const body = JSON.parse(String(options?.body));
              writes.push(body);
              if (body.replace_ids.length)
                return Response.json({ id: "new-instance", status: "queued" });
            }
            return originalFetch(url, options);
          };
          try {
            const start = () =>
              [...container.querySelectorAll("button")].find(
                (b) => b.textContent === "启动靶机",
              )!;
            await settle(() => !!start());
            await click(start());
            await settle(() => !!document.querySelector('[role="dialog"]'));
            assert(
              document
                .querySelector('[role="dialog"]')!
                .textContent!.includes("旧靶机题目"),
            );
            assert.deepEqual(writes[0].replace_ids, []);
            await click(
              [...document.querySelectorAll('[role="dialog"] button')].find(
                (b) => b.textContent === "取消",
              )!,
            );
            assert.equal(writes.length, 1);
            await click(start());
            await settle(() => !!document.querySelector('[role="dialog"]'));
            await click(
              [...document.querySelectorAll('[role="dialog"] button')].find(
                (b) => b.textContent === "销毁并启动",
              )!,
            );
            await settle(() => writes.length === 3);
            assert.deepEqual(writes[2].replace_ids, ["old-instance"]);
          } finally {
            globalThis.fetch = originalFetch;
            await cleanup();
          }
        },
      );
      await t.test(
        "administrators have an enabled flag submit control and receive solve feedback",
        async () => {
          await mount(`/challenges?challenge=${id}`, {
            "/me": { user: { id: "admin", username: "管理员", role: "admin" } },
            [`/challenges/${id}/submit`]: {
              correct: true,
              already_solved: false,
              completed: true,
            },
          });
          await settle(() => !!container.querySelector(`#flag-${id}`));
          const form = container.querySelector(`#flag-${id}`)!.closest("form")!;
          assert.equal(
            (form.querySelector('button[type="submit"]') as HTMLButtonElement)
              .disabled,
            false,
          );
          assert.ok(!container.textContent?.includes("管理员账号不参与计分"));
          await act(async () => {
            form.dispatchEvent(
              new dom.window.Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(
            () => container.textContent?.includes("该题目已解答") === true,
          );
          assert.equal(
            requests.filter((path) => path === `/challenges/${id}/submit`)
              .length,
            1,
          );
          await cleanup();
        },
      );
      await t.test(
        "only a fresh correct submission animates the completed status",
        async () => {
          await mount(`/challenges?challenge=${id}`, {
            [`/challenges/${id}/submit`]: {
              correct: true,
              already_solved: false,
              completed: true,
            },
          });
          await settle(() => !!container.querySelector(`#flag-${id}`));
          await act(async () => {
            container
              .querySelector(`#flag-${id}`)!
              .closest("form")!
              .dispatchEvent(
                new dom.window.Event("submit", {
                  bubbles: true,
                  cancelable: true,
                }),
              );
          });
          await settle(
            () => !!container.querySelector('[data-feedback-motion="submit"]'),
          );
          assert.equal(container.querySelector(`#flag-${id}`), null);
          await cleanup();
          await mount(`/challenges?challenge=${id}`, {
            [`/challenges/${id}?scope=practice`]: {
              ...challenge,
              solved: true,
            },
          });
          await settle(
            () => !!container.querySelector('[data-feedback-motion="none"]'),
          );
          assert.equal(
            container.querySelector('[data-feedback-motion="submit"]'),
            null,
          );
          await cleanup();
        },
      );
      await t.test(
        "skill branches open compactly and content links return to the same selected branch",
        async () => {
          const treePath = `/learning/${id}`;
          const rootNode = {
            id: "root",
            title: "Web 基础",
            prerequisites: [],
            article_id: null,
            challenge_id: null,
            unlocked: true,
            completed: false,
          };
          const branchNode = {
            ...rootNode,
            id: "branch",
            title: "协议",
            prerequisites: ["root"],
          };
          const leaf = {
            ...rootNode,
            id: "leaf",
            title: "HTTP",
            prerequisites: ["branch"],
            article_id: id,
            slug: "http",
            article_title: "HTTP 教程",
            challenge_id: id,
            challenge_title: "分步题",
          };
          const extra = {
            [`/learning/trees/${id}`]: {
              id,
              title: "Web 路线",
              completed: 0,
              nodes: [rootNode, branchNode, leaf],
            },
            "/articles/http": {
              id,
              slug: "http",
              title: "HTTP 教程",
              kind: "tutorial",
              category: "Web",
              body: "教程正文",
              updated_at: new Date().toISOString(),
            },
          };
          await mount(treePath, extra);
          await settle(
            () => !!container.querySelector('[aria-label="展开协议的分支"]'),
          );
          assert.equal(
            container.querySelector('button[aria-label="HTTP，可学习"]'),
            null,
          );
          await click(
            container.querySelector('[aria-label="展开协议的分支"]')!,
          );
          await settle(
            () =>
              !!container.querySelector('button[aria-label="HTTP，可学习"]'),
          );
          await click(
            [...container.querySelectorAll("button")].find((b) =>
              b.textContent?.includes("进入分支"),
            )!,
          );
          await settle(
            () =>
              container.querySelector('[aria-label="技能分支"]')
                ?.textContent === "协议",
          );
          await click(
            container.querySelector('button[aria-label="HTTP，可学习"]')!,
          );
          const article = container.querySelector('a[href^="/library/http?"]')!;
          const returnPath = new URL(
            article.getAttribute("href")!,
            "http://localhost",
          ).searchParams.get("from")!;
          assert.equal(returnPath, `${treePath}?node=leaf&branch=branch`);
          await click(article);
          await settle(
            () =>
              !!container.querySelector('[data-card-detail="/library/http"]'),
          );
          const backToTree = () =>
            [...container.querySelectorAll("a")].find(
              (a) => a.getAttribute("href") === returnPath,
            )!;
          const back = backToTree();
          assert.ok(back.textContent?.includes("返回技能树"));
          await click(back);
          await settle(
            () => !!container.querySelector('[aria-label="当前技能"]'),
          );
          assert.ok(
            container
              .querySelector('[aria-label="当前技能"]')
              ?.textContent?.includes("HTTP 教程"),
          );
          await click(
            container.querySelector('a[href^="/challenges?challenge="]')!,
          );
          await settle(() => !!container.querySelector(`#flag-${id}`));
          assert.ok(backToTree()?.textContent?.includes("返回技能树"));
          await click(backToTree());
          await settle(
            () => !!container.querySelector('[aria-label="技能分支"]'),
          );
          assert.equal(
            container.querySelector('[aria-label="技能分支"]')?.textContent,
            "协议",
          );
          await cleanup();
        },
      );
      await t.test(
        "team landing is a list, empty teams have guidance and creation is a separate OR form",
        async () => {
          await mount("/team", {
            "/teams/mine": {
              items: [
                { id, name: "测试战队", captain_id: "player", members: 3 },
              ],
            },
          });
          assert.ok(container.querySelector(`a[href="/team?team=${id}"]`));
          assert.equal(
            container.querySelector('select[aria-label="选择战队"]'),
            null,
          );
          assert.equal(requests.filter((p) => p === "/team").length, 0);
          await cleanup();
          await mount("/team");
          assert.ok(container.textContent?.includes("还没有战队"));
          await cleanup();
          await mount("/team/new?next=%2Fcontests%2Fexample");
          assert.equal(container.querySelectorAll("form").length, 2);
          assert.ok(container.textContent?.includes("OR"));
          assert.ok(
            container.querySelector(
              'a[href="/team?next=%2Fcontests%2Fexample"]',
            ),
          );
          await cleanup();
        },
      );
    } finally {
      if (root!) await act(async () => root.unmount());
      cache?.clear();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
      dom.window.close();
    }
  },
);
