import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test(
  "contest management keeps privileged routes, reviews, live updates and page errors coherent",
  { timeout: 20000 },
  async (t) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });
    const sockets: any[] = [];
    class FakeSocket {
      readyState = 1;
      onmessage?: (event: any) => void;
      onopen?: () => void;
      onclose?: (event: any) => void;
      constructor(public url: string | URL) {
        sockets.push(this);
      }
      close() {
        this.readyState = 3;
      }
    }
    Object.assign(dom.window, {
      matchMedia: () => ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      WebSocket: FakeSocket,
    });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      FormData: dom.window.FormData,
      Element: dom.window.Element,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
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
      fetch: globalThis.fetch,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query"),
      { App } = await import("../src/App");
    const host = document.getElementById("root")!,
      id = "10000000-0000-4000-8000-000000000001",
      team = "20000000-0000-4000-8000-000000000001";
    const contest = {
      id,
      title: "Review Cup",
      description: "比赛介绍",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      published: true,
      team_limit: 4,
      teams: 1,
      registered: false,
      registration: null,
      groups: [],
      challenge_ids: [],
    };
    const registration = {
      team_id: team,
      name: "审核战队",
      captain: "captain",
      member_count: 2,
      group_id: null,
      group_name: null,
      status: "pending",
      created_at: new Date().toISOString(),
      review_note: "",
      accepted_at: null,
      members: [
        {
          id: team,
          username: "captain",
          email: "captain@example.test",
          real_name: "测试选手",
          student_number: "20260001",
          phone: "+86 138 0000 0000",
          email_verified_at: "2026-01-15T08:00:00Z",
          registered: false,
          current_member: true,
          role: "user",
          disabled: false,
          captain: true,
          created_at: "2026-01-15T08:00:00Z",
        },
        {
          id: "30000000-0000-4000-8000-000000000001",
          username: "member",
          email: "member@example.test",
          disabled: true,
          captain: false,
          created_at: "2026-01-16T08:00:00Z",
        },
      ],
    };
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>,
      offline = false,
      reviewError = "",
      writes: any[] = [],
      requests: string[] = [];
    async function cleanup() {
      if (root) await act(async () => root!.unmount());
      root = undefined;
      cache?.clear();
    }
    async function mount(
      path: string,
      role = "admin",
      extra: Record<string, unknown> = {},
    ) {
      await cleanup();
      offline = false;
      reviewError = "";
      writes = [];
      requests = [];
      sockets.length = 0;
      const currentRegistration = structuredClone(registration);
      const user = {
        id: team,
        username: "admin",
        email: "test@example.test",
        role,
      };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input), "http://localhost"),
          p = url.pathname.replace(/^\/api/, "");
        requests.push(p + url.search);
        if (init?.method && init.method !== "GET") {
          const change = JSON.parse(String(init.body));
          writes.push(change);
          if (reviewError)
            return new Response(JSON.stringify({ error: reviewError }), {
              status: 409,
            });
          if (p.endsWith("/registrations")) {
            if (change.status) {
              currentRegistration.status = change.status;
              currentRegistration.review_note = change.review_note ?? "";
            }
            if (change.group_id) {
              currentRegistration.group_id = change.group_id;
              currentRegistration.group_name = (
                extra[`/contests/${id}`] as any
              )?.groups.find((g: any) => g.id === change.group_id)?.name;
            }
          }
          return new Response('{"ok":true}');
        }
        if (offline && p.startsWith("/admin/"))
          return new Response('{"error":"服务暂时不可用"}', { status: 503 });
        let body: any =
          extra[p] ??
          (p === "/me"
            ? { user }
            : p === `/contests/${id}` || p === `/admin/contests/${id}`
              ? contest
              : p === `/admin/contests/${id}/registrations/${team}`
                ? currentRegistration
                : p.endsWith("/registrations")
                  ? {
                      items: [currentRegistration],
                      total: 1,
                      counts: [
                        { status: currentRegistration.status, count: 1 },
                      ],
                    }
                  : p.endsWith("/activity")
                    ? {
                        items: [
                          {
                            id: "event",
                            type: "submission",
                            created_at: new Date().toISOString(),
                            team_name: "审核战队",
                            team_id: team,
                            username: "captain",
                            challenge_title: "Flag challenge",
                            correct: false,
                            detail: null,
                          },
                        ],
                        total: 1,
                      }
                    : p === "/admin/contests"
                      ? { items: [contest], total: 1 }
                      : { items: [], total: 0 });
        return new Response(JSON.stringify(body));
      };
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      cache.setQueryData(["/me"], { user });
      cache.setQueryData(
        [`/contests/${id}`],
        extra[`/contests/${id}`] ?? contest,
      );
      root = createRoot(host);
      await act(async () =>
        root!.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[path]}>
              <App />
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
    }
    async function settle(check: () => boolean) {
      for (let n = 0; n < 100 && !check(); n++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
      assert.ok(check(), "settled");
    }
    async function click(el: Element | null | undefined) {
      assert.ok(el);
      await act(async () => {
        el.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    const button = (name: string) =>
      [...document.querySelectorAll("button")].find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
      );
    try {
      await t.test(
        "whole registration rows expand compact members without intercepting selection or review actions",
        async () => {
          await mount(`/contests/${id}/manage/teams`);
          await settle(
            () => !!host.querySelector('input[aria-label="搜索战队或队长"]'),
          );
          assert.equal(
            host.querySelectorAll(
              'table[aria-label="报名战队"] > tbody > tr:not([data-slot="collapsible-content"])',
            ).length,
            1,
          );
          assert.equal(
            requests.some(
              (p) => p === `/admin/contests/${id}/registrations/${team}`,
            ),
            false,
          );
          const summaryRow = host.querySelector(
            'table[aria-label="报名战队"] > tbody > tr',
          )!;
          await click(summaryRow.children[2]);
          await settle(() =>
            host.textContent!.includes("captain@example.test"),
          );
          assert.equal(
            button("收起 审核战队 的成员")!.getAttribute("aria-expanded"),
            "true",
          );
          assert.match(host.textContent!, /01\/15/);
          const members = host.querySelector(
            '[role="list"][aria-label="战队成员"]',
          )!;
          assert.equal(members.children.length, 2);
          assert(members.textContent!.includes("member@example.test"));
          assert(members.textContent!.includes("队长"));
          for (const value of [
            "测试选手",
            "20260001",
            "+86 138 0000 0000",
            "邮箱已验证",
            "邮箱未验证",
            "待审核",
            "—",
          ])
            assert(members.textContent!.includes(value), value);
          assert(members.textContent!.includes("已禁用"));
          assert(!members.textContent!.includes("正常"));
          assert(!members.textContent!.includes(team));
          assert.equal(
            host.querySelector('table[aria-label="报名战队"] table'),
            null,
          );
          assert.equal(
            document
              .getElementById(
                button("收起 审核战队 的成员")!.getAttribute("aria-controls")!,
              )
              ?.contains(members),
            true,
          );
          await click(host.querySelector('[aria-label="选择 审核战队"]'));
          assert.equal(
            button("收起 审核战队 的成员")!.getAttribute("aria-expanded"),
            "true",
          );
          await click(host.querySelector('[aria-label="选择 审核战队"]'));
          await click(summaryRow.children[6]);
          assert(
            members.closest("[inert]"),
            "collapsed members remain mounted but cannot receive focus",
          );
          // Copying row text and modified clicks must not open details.
          const selection = dom.window.getSelection()!;
          const range = dom.window.document.createRange();
          range.selectNodeContents(summaryRow.children[2]!);
          selection.addRange(range);
          await click(summaryRow.children[2]);
          assert(button("展开 审核战队 的成员"));
          selection.removeAllRanges();
          await act(async () => {
            summaryRow.children[3]!.dispatchEvent(
              new dom.window.MouseEvent("click", {
                bubbles: true,
                ctrlKey: true,
              }),
            );
          });
          assert(button("展开 审核战队 的成员"));
          // The native disclosure button remains a keyboard-accessible entry.
          button("展开 审核战队 的成员")!.focus();
          assert.equal(document.activeElement, button("展开 审核战队 的成员"));
          await click(button("展开 审核战队 的成员"));
          assert(button("收起 审核战队 的成员"));
          await click(button("收起 审核战队 的成员"));
          await click(host.querySelector('[aria-label="选择 审核战队"]'));
          await click(button("通过所选（1）"));
          await settle(() => writes.length === 1);
          assert.deepEqual(writes[0], { team_ids: [team], status: "accepted" });
          assert.equal(
            button("展开 审核战队 的成员")!.getAttribute("aria-expanded"),
            "false",
          );
          await settle(() => !!button("暂停 审核战队"));
          assert.equal(button("通过 审核战队"), undefined);
          assert.equal(
            host.querySelector(
              `a[href="/contests/${id}/manage/teams/${team}"]`,
            ),
            null,
          );
          assert(button("展开 审核战队 的成员"));
        },
      );
      await t.test(
        "inline review retains context, required reasons and failed drafts across every status",
        async () => {
          const groups = [
            { id: "open", name: "公开组" },
            { id: "student", name: "高校组" },
          ];
          await mount(`/contests/${id}/manage/teams?page=2&q=审核`, "admin", {
            [`/contests/${id}`]: { ...contest, groups },
          });
          await settle(() => !!button("展开 审核战队 的成员"));
          await click(button("展开 审核战队 的成员"));
          await settle(() =>
            host.textContent!.includes("captain@example.test"),
          );
          const summary = host.querySelector(
            'table[aria-label="报名战队"] > tbody > tr',
          );
          const checkContext = () => {
            assert(button("收起 审核战队 的成员"));
            assert.equal(
              host.querySelector('table[aria-label="报名战队"] > tbody > tr'),
              summary,
            );
            assert.equal(
              (
                host.querySelector(
                  '[aria-label="搜索战队或队长"]',
                ) as HTMLInputElement
              ).value,
              "审核",
            );
            assert(
              requests.some(
                (p) =>
                  p.includes("/registrations?") &&
                  p.includes("page=2") &&
                  p.includes("q="),
              ),
            );
          };
          await click(button("拒绝 审核战队"));
          await settle(
            () =>
              !!document.querySelector(
                '[role="dialog"][aria-label="拒绝 审核战队"]',
              ),
          );
          assert.equal(
            (button("确认拒绝") as HTMLButtonElement).disabled,
            true,
          );
          const fillReason = async (text: string) => {
            const input = document.querySelector(
              '[role="dialog"] textarea',
            ) as HTMLTextAreaElement;
            assert(input);
            await act(async () => {
              Object.getOwnPropertyDescriptor(
                dom.window.HTMLTextAreaElement.prototype,
                "value",
              )!.set!.call(input, text);
              input.dispatchEvent(
                new dom.window.Event("input", { bubbles: true }),
              );
            });
          };
          await fillReason("请补充报名资料");
          reviewError = "网络异常，请重试";
          await click(button("确认拒绝"));
          await settle(() =>
            document
              .querySelector('[role="dialog"]')!
              .textContent!.includes(reviewError),
          );
          assert.equal(
            (
              document.querySelector(
                '[role="dialog"] textarea',
              ) as HTMLTextAreaElement
            ).value,
            "请补充报名资料",
          );
          checkContext();
          reviewError = "";
          await click(button("确认拒绝"));
          await settle(
            () =>
              !!button("重新审核 审核战队") &&
              !document.querySelector('[role="dialog"]'),
          );
          assert.deepEqual(writes.at(-1), {
            team_ids: [team],
            status: "rejected",
            review_note: "请补充报名资料",
          });
          assert(host.textContent!.includes("请补充报名资料"));
          checkContext();
          await click(button("调整 审核战队 的组别"));
          await settle(
            () => !!document.querySelector('[role="dialog"] select'),
          );
          const select = document.querySelector(
            '[role="dialog"] select',
          ) as HTMLSelectElement;
          await act(async () => {
            select.value = "student";
            select.dispatchEvent(
              new dom.window.Event("change", { bubbles: true }),
            );
          });
          await click(button("保存组别"));
          await settle(() => !document.querySelector('[role="dialog"]'));
          assert.deepEqual(writes.at(-1), {
            team_ids: [team],
            group_id: "student",
          });
          assert(host.textContent!.includes("请补充报名资料"));
          assert(
            button("调整 审核战队 的组别")!.textContent!.includes("高校组"),
          );
          checkContext();
          await click(button("重新审核 审核战队"));
          await settle(() => !!button("拒绝 审核战队"));
          await click(button("通过 审核战队"));
          await settle(() => !!button("暂停 审核战队"));
          checkContext();
          await click(button("暂停 审核战队"));
          await settle(
            () => !!document.querySelector('[role="dialog"] textarea'),
          );
          await fillReason("参赛资料待核实");
          await click(button("确认暂停"));
          await settle(
            () =>
              !!button("恢复 审核战队") &&
              !document.querySelector('[role="dialog"]'),
          );
          assert.deepEqual(writes.at(-1), {
            team_ids: [team],
            status: "suspended",
            review_note: "参赛资料待核实",
          });
          assert.equal(button("重新审核 审核战队"), undefined);
          await click(button("恢复 审核战队"));
          await settle(() => !!button("暂停 审核战队"));
          assert(!host.textContent!.includes("参赛资料待核实"));
          checkContext();
        },
      );
      await t.test(
        "batch rejection stays in the list and post-start groups cannot be edited",
        async () => {
          await mount(`/admin/contests/${id}/manage/teams`, "admin", {
            [`/contests/${id}`]: {
              ...contest,
              starts_at: new Date(Date.now() - 60000).toISOString(),
              groups: [{ id: "open", name: "公开组" }],
            },
          });
          await settle(() => !!button("通过 审核战队"));
          assert.equal(button("调整 审核战队 的组别"), undefined);
          await click(host.querySelector('[aria-label="选择本页待审核战队"]'));
          await click(button("拒绝 所选 1 支战队"));
          await settle(
            () => !!document.querySelector('[role="dialog"] textarea'),
          );
          const input = document.querySelector(
            '[role="dialog"] textarea',
          ) as HTMLTextAreaElement;
          await act(async () => {
            Object.getOwnPropertyDescriptor(
              dom.window.HTMLTextAreaElement.prototype,
              "value",
            )!.set!.call(input, "资料不全");
            input.dispatchEvent(
              new dom.window.Event("input", { bubbles: true }),
            );
          });
          await click(button("确认拒绝"));
          await settle(
            () =>
              !!button("重新审核 审核战队") &&
              !document.querySelector('[role="dialog"]'),
          );
          assert.deepEqual(writes[0], {
            team_ids: [team],
            status: "rejected",
            review_note: "资料不全",
          });
          assert.equal(button("通过所选（1）"), undefined);
          assert(button("展开 审核战队 的成员"));
        },
      );
      await t.test(
        "contest settings preserve the return route and all backend contest pages have a direct contest link",
        async () => {
          const origin = `/contests/${id}/manage/teams?status=pending`;
          await mount(origin);
          await settle(
            () => !!host.querySelector('[aria-label="比赛管理导航"]'),
          );
          assert.equal(button("管理"), undefined);
          assert.ok(
            [...host.querySelectorAll("header a")].some(
              (a) => a.textContent === "管理",
            ),
          );
          assert.equal(
            [...host.querySelectorAll("header a")].some(
              (a) => a.textContent === "观战",
            ),
            false,
          );
          const sidebar = host.querySelector('[aria-label="比赛管理导航"]');
          const settings = [...sidebar!.querySelectorAll("a")].find(
            (a) => a.textContent === "比赛设置",
          );
          assert.ok(settings);
          assert.equal(
            new URL(
              settings.getAttribute("href")!,
              "http://localhost",
            ).searchParams.get("return"),
            origin,
          );
          await click(settings);
          await settle(() => !!host.querySelector('a[aria-label="返回比赛"]'));
          assert.equal(
            host.querySelector('[aria-label="比赛管理导航"]'),
            sidebar,
            "sidebar persists when switching to settings",
          );
          assert.equal(
            host
              .querySelector('a[aria-label="返回比赛"]')!
              .getAttribute("href"),
            origin,
          );
          await click(host.querySelector('a[aria-label="返回比赛"]'));
          await settle(() => !!host.querySelector('[aria-label="报名状态"]'));
          assert.equal(
            (host.querySelector('[aria-label="报名状态"]') as HTMLSelectElement)
              .value,
            "pending",
          );
          for (const path of [
            `/admin/contests/${id}/manage/teams`,
            `/admin/contests/${id}/manage/activity`,
            `/admin/contests/${id}/edit?return=https://example.test`,
          ]) {
            await mount(path);
            await settle(
              () => !!host.querySelector(`header a[href="/contests/${id}"]`),
            );
            if (path.includes("/edit")) {
              await settle(
                () => !!host.querySelector('a[aria-label="返回列表"]'),
              );
              assert.equal(
                host
                  .querySelector('a[aria-label="返回列表"]')!
                  .getAttribute("href"),
                "/admin/contests",
              );
            }
            await click(host.querySelector(`header a[href="/contests/${id}"]`));
            await settle(
              () =>
                !host.querySelector('[aria-label="管理路径"]') &&
                !!host.querySelector('a[href="/contests"]'),
            );
          }
        },
      );
      await t.test(
        "monitor frames invalidate this contest and a page error hides stale tables and controls",
        async () => {
          await mount(`/contests/${id}/manage/activity`);
          await settle(() => host.textContent!.includes("Flag challenge"));
          const socket = sockets.find((s) =>
            String(s.url).includes(`/api/admin/contests/${id}/activity/ws`),
          );
          assert.ok(socket);
          const before = requests.length;
          await act(async () =>
            socket.onmessage?.({
              data: JSON.stringify({
                type: "monitor",
                data: { revision: "new" },
              }),
            }),
          );
          await settle(() => requests.length > before);
          offline = true;
          await act(async () => {
            await cache.invalidateQueries({
              predicate: (q) =>
                String(q.queryKey[0]).startsWith(
                  `/admin/contests/${id}/activity`,
                ),
            });
          });
          await settle(() => host.textContent!.includes("服务暂时不可用"));
          assert.equal(host.querySelector("table"), null);
          assert.equal(
            host.querySelector('input[aria-label="搜索战队、选手或题目"]'),
            null,
          );
        },
      );
      await t.test(
        "ordinary players see no management links and cannot load monitor data",
        async () => {
          await mount(`/contests/${id}/manage/integrity`, "user");
          await settle(() => host.textContent!.includes("403"));
          assert.equal(sockets.length, 0);
          assert.equal(
            requests.some((p) => p.startsWith("/admin/contests/")),
            false,
          );
          assert.equal(
            host.querySelector(`a[href="/contests/${id}/manage/teams"]`),
            null,
          );
        },
      );
      await t.test(
        "pending participants see their review status instead of an arena entrance",
        async () => {
          await mount(`/contests/${id}`, "user", {
            [`/contests/${id}`]: {
              ...contest,
              registration: {
                team_id: team,
                team_name: "审核战队",
                group_name: null,
                status: "pending",
                review_note: "正在核验",
              },
            },
          });
          await settle(() => host.textContent!.includes("等待审核"));
          assert.ok(button("撤回报名"));
          assert.equal(
            host.querySelector(`a[href="/contests/${id}/challenges"]`),
            null,
          );
          assert.match(host.textContent!, /正在核验/);
        },
      );
    } finally {
      await cleanup();
      await new Promise((r) => setTimeout(r, 100));
      dom.window.close();
      for (const [key, value] of originals)
        if (value) Object.defineProperty(globalThis, key, value);
        else delete (globalThis as any)[key];
    }
  },
);
