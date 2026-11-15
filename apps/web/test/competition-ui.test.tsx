import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { challengePoints, scoreCurve } from "../src/lib/scoring";
import type { Contest } from "../src/lib/types";
import type { ContestQuestion } from "../src/lib/competition";
import type { SubmissionOverride } from "../src/lib/submission-limits";
import type { HintOverride } from "../src/lib/hints";

test("score preview uses the same bounded quadratic curve as contest scoring", () => {
  assert.equal(challengePoints(500, 100, 20, 10), 400);
  assert.equal(challengePoints(500, 100, 20, 200), 100);
  assert.equal(challengePoints(500, 100, 20, 10, false), 500);
  const data = scoreCurve(500, 100, 20);
  assert(data.length <= 121);
  assert.equal(data[0]!.points, 500);
  assert.equal(data.at(-1)!.points, 100);
  assert.deepEqual(scoreCurve(100, 500, 20), []);
});

test(
  "contest tabs, score overrides, objective submission and shared start controls",
  { timeout: 15000 },
  async (t) => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: "http://localhost/",
        pretendToBeVisual: true,
      }),
      original = new Map<string, PropertyDescriptor | undefined>();
    Object.assign(dom.window, {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
      scrollTo() {},
    });
    const measure = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.matches(
        '[data-slot="chart"], .recharts-responsive-container, .recharts-wrapper',
      )
        ? new dom.window.DOMRect(0, 0, 640, 208)
        : measure.call(this);
    };
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      Element: dom.window.Element,
      SVGElement: dom.window.SVGElement,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      MutationObserver: dom.window.MutationObserver,
      FormData: dom.window.FormData,
      localStorage: dom.window.localStorage,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
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
    // Browser-dependent UI modules must observe the JSDOM globals during initialization.
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter, useLocation } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query"),
      { LazyMotion, domAnimation } = await import("motion/react");
    const { ContestForm } =
        await import("../src/components/admin/contest-form"),
      { GroupsEditor, readGroups } =
        await import("../src/components/groups-editor"),
      { ObjectiveAnswer } = await import("../src/components/objective-answer"),
      { PhaseCards } = await import("../src/components/contest-timing");
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>,
      saved: any,
      userId = "objective-player",
      answer: any = { answer: {}, correct: null, finalized_at: null };
    const requests: { path: string; body: any }[] = [];
    const ctf = {
        id: "10000000-0000-4000-8000-000000000001",
        title: "CTF service",
        kind: "dynamic_container",
        challenge_type: "ctf",
        category: "Web",
        initial_points: 100,
        minimum_points: 10,
        decay: 10,
        dynamic_score: true,
        parts: [],
        hints: [
          { id: "hint-one", content: "第一条提示" },
          { id: "hint-two", content: "第二条提示" },
        ],
        published: true,
      },
      awdp = {
        ...ctf,
        id: "10000000-0000-4000-8000-000000000002",
        title: "AWDP service",
        challenge_type: "awdp",
        parts: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            title: "Attack",
            initial_points: 200,
            minimum_points: 20,
          },
          {
            id: "30000000-0000-4000-8000-000000000002",
            title: "Defense",
            initial_points: 300,
            minimum_points: 30,
          },
        ],
      };
    const questionBank = [
      ctf,
      awdp,
      ...Array.from({ length: 10 }, (_, i) => ({
        ...ctf,
        id: `10000000-0000-4000-8000-${String(i + 3).padStart(12, "0")}`,
        title: `Extra ${i + 1}`,
      })),
    ];
    globalThis.fetch = async (input, init) => {
      const path = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body) requests.push({ path, body });
      let data: any = {};
      if (path === "/api/me") data = { user: { id: userId } };
      if (path.includes("/admin/challenges")) {
        const params =
          body ??
          Object.fromEntries(new URL(path, "http://localhost").searchParams);
        const ids = params.ids?.split(",");
        const items = questionBank.filter(
          (c) =>
            (!ids || ids.includes(c.id)) &&
            (!params.q || c.title.includes(params.q)),
        );
        if (ids) items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        const page = Number(params.page || 1),
          size = Number(params.page_size || 10);
        data = {
          items: items.slice((page - 1) * size, page * size),
          total: items.length,
        };
      }
      if (path.includes("/admin/teams")) {
        const params = new URL(path, "http://localhost").searchParams;
        const teams = [
          { id: "team-a", name: "Alpha", captain: "alice", members: 3 },
          { id: "team-b", name: "Beta", captain: "bob", members: 2 },
        ];
        data = {
          items: teams.filter(
            (team) =>
              !params.has("ids") ||
              params.get("ids")!.split(",").includes(team.id),
          ),
          total: teams.length,
        };
      }
      if (path.includes("/answer")) {
        if (body)
          answer = {
            practice: answer.practice,
            answer: body.answer,
            correct: body.finalize ? true : null,
            review: body.finalize ? { choices: ["B"] } : null,
            finalized_at: body.finalize ? new Date().toISOString() : null,
          };
        data = answer;
      }
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    };
    const host = () => document.getElementById("root")!;
    const cleanup = async () => {
      if (root) {
        await act(async () => root!.unmount());
        root = undefined;
        cache.clear();
      }
    };
    const mount = async (child: React.ReactNode, path = "/") => {
      await cleanup();
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      root = createRoot(host());
      await act(async () =>
        root!.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[path]}>
              <LazyMotion features={domAnimation}>{child}</LazyMotion>
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
    };
    const settle = async (fn: () => boolean) => {
      for (let i = 0; i < 80 && !fn(); i++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
      assert(fn());
    };
    const click = async (el: Element, event = "click") => {
      assert(el);
      await act(async () =>
        el.dispatchEvent(
          new dom.window.MouseEvent(event, {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        ),
      );
    };
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (el) => el.textContent?.trim() === label,
      )!;
    const change = async (el: Element, value: string) => {
      assert(el);
      const proto =
        el instanceof dom.window.HTMLSelectElement
          ? dom.window.HTMLSelectElement.prototype
          : dom.window.HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(
          new dom.window.Event(
            el instanceof dom.window.HTMLSelectElement ? "change" : "input",
            { bubbles: true },
          ),
        );
      });
    };
    const tab = async (name: string) => {
      const target = ["访问与报名", "报名分组", "报名表单"].includes(name)
        ? "报名设置"
        : name;
      await click(
        [...host().querySelectorAll('[role="tab"]')].find(
          (el) => el.textContent === target,
        )!,
        "mousedown",
      );
    };
    try {
      const dialog = () => document.querySelector('[role="dialog"]')!;
      const dialogButton = (text: string) =>
        [...dialog().querySelectorAll("button")].find(
          (el) => el.textContent?.trim() === text,
        )!;
      const groupToggle = (text: string) =>
        [...dialog().querySelectorAll("label")]
          .find((el) => el.textContent?.trim() === text)!
          .querySelector("button")!;
      await t.test(
        "team picker stages selection, cancellation and selected-only removal",
        async () => {
          const { ContestTeamPicker } =
            await import("../src/components/admin/contest-team-picker");
          let applied: string[] = [];
          function Picker() {
            const [ids, setIds] = React.useState<string[]>([]);
            return (
              <ContestTeamPicker
                value={ids}
                onChange={(next) => {
                  applied = next;
                  setIds(next);
                }}
              />
            );
          }
          await mount(<Picker />);
          assert.equal(
            host().querySelector('[aria-label="搜索可报名战队"]'),
            null,
          );
          await click(button("选择战队"));
          await settle(
            () => !!document.querySelector('[aria-label="选择战队 Alpha"]'),
          );
          await click(document.querySelector('[aria-label="选择战队 Alpha"]')!);
          await click(dialogButton("取消"));
          assert.deepEqual(applied, []);
          await click(button("选择战队"));
          await settle(
            () => !!document.querySelector('[aria-label="选择战队 Alpha"]'),
          );
          assert.equal(
            document
              .querySelector('[aria-label="选择战队 Alpha"]')!
              .getAttribute("aria-checked"),
            "false",
          );
          await click(document.querySelector('[aria-label="选择战队 Alpha"]')!);
          await click(document.querySelector('[aria-label="选择战队 Beta"]')!);
          await click(dialogButton("确认选择"));
          assert.deepEqual(applied, ["team-a", "team-b"]);
          await click(button("选择战队"));
          await click(dialogButton("已选 2"));
          await settle(
            () => !!document.querySelector('[aria-label="选择战队 Beta"]'),
          );
          await click(document.querySelector('[aria-label="选择战队 Beta"]')!);
          await click(dialogButton("确认选择"));
          assert.deepEqual(applied, ["team-a"]);
          await mount(
            <ContestTeamPicker
              value={applied}
              onChange={() => assert.fail("read-only picker changed")}
              disabled
            />,
          );
          assert(button("选择战队").disabled);
        },
      );
      await t.test(
        "group dialogs stage permissions and cancel without replacing the list",
        async () => {
          const selected = questionBank.map((c) => c.id);
          await mount(
            <form>
              <GroupsEditor
                initial={[
                  {
                    id: "group",
                    name: "体验组",
                    description: "",
                    permissions: { score: false },
                  },
                ]}
                challengeIds={selected}
              />
            </form>,
          );
          const values = () =>
            readGroups(
              new dom.window.FormData(host().querySelector("form")!),
              selected,
            )[0]!;
          const listItem = host().querySelector(
            '[aria-label="配置组别 体验组"]',
          )!;
          await click(listItem);
          assert(dialog());
          assert.equal(
            host().querySelector('[aria-label="配置组别 体验组"]'),
            listItem,
          );
          assert.equal(dialog().querySelectorAll('[role="switch"]').length, 8);
          await click(dialog().querySelector('[role="radio"][value="auto"]')!);
          await click(groupToggle("查看赛题"));
          assert.equal(values().permissions.view, true);
          await click(dialogButton("单题权限"));
          await settle(
            () => dialog().querySelectorAll("tbody tr").length === 10,
          );
          const cb = (label: string) =>
            dialog().querySelector<HTMLButtonElement>(
              `[aria-label="${label}"]`,
            )!;
          assert(cb("CTF service查看赛题").disabled);
          await click(cb("CTF service沿用组别权限"));
          await click(cb("CTF service查看赛题"));
          await click(cb("CTF service使用靶机与附件"));
          await click(dialog().querySelector('[aria-label="下一页"]')!);
          assert.equal(dialog().querySelectorAll("tbody tr").length, 2);
          await click(dialog().querySelector('[aria-label="上一页"]')!);
          assert.equal(
            cb("CTF service查看赛题").getAttribute("data-state"),
            "checked",
          );
          await click(dialogButton("确认组别"));
          assert.equal(document.querySelector('[role="dialog"]'), null);
          assert.equal(values().review_mode, "auto");
          assert.equal(values().permissions.view, false);
          assert.equal(
            (values().challenge_permissions[ctf.id] as any).resources,
            false,
          );
          await settle(() => document.activeElement === listItem);
          await click(listItem);
          await click(groupToggle("查看赛题"));
          await click(dialogButton("取消"));
          assert.equal(values().permissions.view, false);
        },
      );
      await t.test(
        "group invitation editing stages changes, validates, generates and clears codes",
        async () => {
          await mount(
            <form>
              <GroupsEditor
                initial={[
                  {
                    id: "invite-group",
                    name: "邀请组",
                    description: "",
                    invite_code: "saved-code",
                  },
                ]}
              />
            </form>,
          );
          const read = () =>
            readGroups(
              new dom.window.FormData(host().querySelector("form")!),
            )[0]!;
          const open = () =>
            click(host().querySelector('[aria-label="配置组别 邀请组"]')!);
          const input = () =>
            dialog().querySelector<HTMLInputElement>(
              'input[placeholder="留空沿用比赛设置"]',
            )!;
          await open();
          assert.equal(input().value, "saved-code");
          await change(input(), "changed-code");
          await click(dialogButton("取消"));
          assert.equal(read().invite_code, "saved-code");
          await open();
          await change(input(), "tiny");
          await click(dialogButton("确认组别"));
          assert.match(dialog().textContent!, /组别邀请码为 6–128 位/);
          await click(
            dialog().querySelector('[aria-label="随机生成组别邀请码"]')!,
          );
          const generated = input().value;
          assert.match(generated, /^[a-f0-9]{12}$/);
          await click(dialogButton("确认组别"));
          assert.equal(read().invite_code, generated);
          await open();
          await click(dialog().querySelector('[aria-label="清除组别邀请码"]')!);
          await click(dialogButton("确认组别"));
          assert.equal(read().invite_code, "");
        },
      );
      await t.test(
        "registration invitation input follows selected group and contest policy",
        async () => {
          const { ContestInviteCodeField } =
            await import("../src/components/contest-invite-code-field");
          const groups = [
            { id: "open", name: "默认组别", description: "" },
            {
              id: "invite",
              name: "邀请组",
              description: "",
              invite_code_set: true,
            },
          ];
          await mount(
            <ContestInviteCodeField
              contest={{ groups, registration_mode: "public" }}
              groupId="open"
              value=""
              onChange={() => {}}
            />,
          );
          assert(!host().querySelector('input[name="invite_code"]'));
          await mount(
            <ContestInviteCodeField
              contest={{ groups, registration_mode: "public" }}
              groupId="invite"
              value=""
              onChange={() => {}}
            />,
          );
          assert.match(host().textContent!, /组别邀请码/);
          assert(
            host().querySelector<HTMLInputElement>('input[name="invite_code"]')!
              .required,
          );
          await mount(
            <ContestInviteCodeField
              contest={{ groups, registration_mode: "invite" }}
              groupId="open"
              value=""
              onChange={() => {}}
            />,
          );
          assert.match(host().textContent!, /比赛邀请码/);
          await mount(
            <ContestInviteCodeField
              contest={{ groups, registration_mode: "invite" }}
              groupId="invite"
              value=""
              onChange={() => {}}
            />,
          );
          assert.match(host().textContent!, /组别邀请码/);
          assert.equal(
            host().querySelectorAll('input[name="invite_code"]').length,
            1,
          );
        },
      );
      await t.test(
        "new groups commit once, cancel cleanly and adopt saved IDs",
        async () => {
          function Harness() {
            const [initial, setInitial] = React.useState<any[]>([]);
            return (
              <form>
                <GroupsEditor initial={initial} challengeIds={[ctf.id]} />
                <button
                  type="button"
                  onClick={() =>
                    setInitial([
                      { id: "saved-group", name: "新组别", description: "" },
                    ])
                  }
                >
                  返回保存结果
                </button>
              </form>
            );
          }
          await mount(<Harness />);
          const read = () =>
            readGroups(new dom.window.FormData(host().querySelector("form")!), [
              ctf.id,
            ]);
          await click(button("添加组别"));
          await change(
            dialog().querySelector('input[maxlength="60"]')!,
            "不要保存",
          );
          await click(dialogButton("取消"));
          assert.equal(read().length, 0);
          await settle(() => document.activeElement === button("添加组别"));
          await click(button("添加组别"));
          await click(dialogButton("确认组别"));
          assert.match(dialog().textContent!, /请输入组别名称/);
          await change(
            dialog().querySelector('input[maxlength="60"]')!,
            " 新组别 ",
          );
          await click(groupToggle("参与三血"));
          await click(dialogButton("确认组别"));
          assert.equal(read().length, 1);
          await click(button("返回保存结果"));
          assert.equal(read()[0].id, "saved-group");
          assert.equal(read()[0].permissions.blood, false);
          await mount(
            <GroupsEditor
              initial={[
                {
                  id: "default-group",
                  name: "默认组别",
                  description: "",
                  is_default: true,
                },
                { id: "g", name: "正式组", description: "" },
              ]}
              challengeIds={[ctf.id]}
              started
            />,
          );
          assert(!button("添加组别").disabled);
          assert(!host().querySelector('[aria-label="删除组别 默认组别"]'));
          assert.match(host().textContent!, /默认组别/);
          await click(host().querySelector('[aria-label="配置组别 正式组"]')!);
          for (const label of [
            "获得积分",
            "参与三血",
            "参与全局排名",
            "影响动态分值",
          ])
            assert(groupToggle(label).disabled);
          assert(!groupToggle("查看赛题").disabled);
          await click(dialogButton("取消"));
        },
      );
      await t.test(
        "group permission summaries track inherited review and per-question differences without editing",
        async () => {
          function SummaryReview() {
            const [review, setReview] = React.useState(false);
            return (
              <form>
                <button type="button" onClick={() => setReview(!review)}>
                  切换比赛审核
                </button>
                <GroupsEditor
                  requireReview={review}
                  challengeIds={[ctf.id]}
                  initial={[
                    {
                      id: "summary-inherit",
                      name: "继承组",
                      description: "",
                      review_mode: "inherit",
                      permissions: { submit: false, score: false },
                      challenge_permissions: { [ctf.id]: { submit: true } },
                    },
                    {
                      id: "summary-auto",
                      name: "免审核组",
                      description: "",
                      review_mode: "auto",
                    },
                  ]}
                />
              </form>
            );
          }
          await mount(<SummaryReview />);
          const state = (group: string, key: string) =>
            host().querySelector(
              `[aria-label="${group}权限"] [data-permission="${key}"]`,
            )!;
          assert.equal(
            state("继承组", "submit").getAttribute("data-permission-state"),
            "mixed",
          );
          assert.equal(
            state("继承组", "score").getAttribute("data-permission-state"),
            "off",
          );
          assert.equal(
            state("默认组别", "require_review").getAttribute(
              "data-permission-state",
            ),
            "off",
          );
          await click(button("切换比赛审核"));
          assert.equal(
            state("默认组别", "require_review").getAttribute(
              "data-permission-state",
            ),
            "on",
          );
          assert.equal(
            state("继承组", "require_review").getAttribute(
              "data-permission-state",
            ),
            "on",
          );
          assert.equal(
            state("免审核组", "require_review").getAttribute(
              "data-permission-state",
            ),
            "off",
          );
          const before = readGroups(
            new dom.window.FormData(host().querySelector("form")!),
          );
          await click(state("继承组", "submit"));
          assert.match(dialog().textContent!, /部分赛题不同/);
          assert(!dialog().querySelector('input[maxlength="60"]'));
          assert.deepEqual(
            readGroups(new dom.window.FormData(host().querySelector("form")!)),
            before,
          );
        },
      );
      await t.test(
        "group dialogs validate names, preserve off-page groups and serialize confirmed changes",
        async () => {
          const ref =
            React.createRef<
              import("../src/components/groups-editor").GroupsEditorHandle
            >();
          await mount(
            <form>
              <GroupsEditor
                ref={ref}
                initial={Array.from({ length: 12 }, (_, i) => ({
                  id: `group-${i}`,
                  name: `组别 ${i + 1}`,
                  description: "",
                  permissions: { score: i !== 11 },
                }))}
              />
            </form>,
          );
          const read = () =>
            readGroups(new dom.window.FormData(host().querySelector("form")!));
          await click(host().querySelector('[aria-label="下一页"]')!);
          await click(host().querySelector('[aria-label="配置组别 组别 12"]')!);
          const name = () =>
            dialog().querySelector<HTMLInputElement>('input[maxlength="60"]')!;
          await change(name(), "组别 1");
          await click(dialogButton("确认组别"));
          assert.equal(
            dialog().querySelector('[role="alert"]')!.textContent,
            "组别名称不能重复",
          );
          assert(document.activeElement === name());
          assert.equal(read()[11].name, "组别 12");
          await change(name(), "   ");
          await click(dialogButton("确认组别"));
          assert.equal(
            dialog().querySelector('[role="alert"]')!.textContent,
            "请输入组别名称",
          );
          await change(name(), "更新后的组别");
          await click(dialogButton("确认组别"));
          await act(async () => assert.equal(ref.current!.validate(), true));
          assert.equal(read().length, 12);
          assert.equal(read()[11].permissions.score, false);
          await click(
            host().querySelector('[aria-label="删除组别 更新后的组别"]')!,
          );
          assert.equal(read().length, 11);
        },
      );
      await t.test(
        "restored unsaved groups have independent editor keys",
        async () => {
          await mount(
            <form>
              <GroupsEditor
                initial={[
                  { id: "", name: "草稿一", description: "" },
                  { id: "", name: "草稿二", description: "" },
                ]}
              />
            </form>,
          );
          await click(host().querySelector('[aria-label="配置组别 草稿二"]')!);
          await change(
            dialog().querySelector('input[maxlength="60"]')!,
            "第二组",
          );
          await click(dialogButton("确认组别"));
          const groups = readGroups(
            new dom.window.FormData(host().querySelector("form")!),
          );
          assert.deepEqual(
            groups.map((g) => g.name),
            ["草稿一", "第二组"],
          );
        },
      );
      await t.test(
        "inline question rules preserve sparse limits, hint policies and editable unlock rules",
        async () => {
          const writes: Record<string, unknown>[] = [];
          function EditorLocation() {
            const location = useLocation();
            return <output data-editor-location>{location.search}</output>;
          }
          const contest: Contest = {
            id: "inline-rules",
            title: "Rules",
            description: "",
            starts_at: "2030-01-01T00:00:00Z",
            ends_at: "2030-01-02T00:00:00Z",
            freeze_at: null,
            team_limit: 4,
            published: false,
            teams: 0,
            registered: false,
            poster_id: null,
            groups: [],
            registration: null,
            challenge_ids: [ctf.id, awdp.id, questionBank[2]!.id],
            submission_limits: { flag: 10, defense: null },
            submission_overrides: [{ challenge_id: awdp.id, defense: 4 }],
          };
          await mount(
            <>
              <ContestForm
                contest={contest}
                pending={false}
                save={async (value) => {
                  writes.push(value);
                }}
              />
              <EditorLocation />
            </>,
            "/?section=challenges&return=%2Fadmin%2Fcontests",
          );
          await settle(
            () => !!host().querySelector('[aria-label="设置 Extra 1"]'),
          );
          await tab("赛题设置");
          const location = new URLSearchParams(
            host().querySelector("[data-editor-location]")!.textContent!,
          );
          assert.equal(location.get("section"), "challenges");
          assert.equal(location.get("return"), "/admin/contests");
          assert(
            ![...host().querySelectorAll('[role="tab"]')].some((el) =>
              ["提交限制", "提示规则"].includes(el.textContent ?? ""),
            ),
          );
          await click(
            host().querySelector('[aria-label="设置 AWDP service"]')!,
          );
          await change(
            host().querySelector(
              '[aria-label="AWDP service Flag 提交次数方式"]',
            )!,
            "unlimited",
          );
          await change(
            host().querySelector('[aria-label="AWDP service 防御申请次数"]')!,
            "12",
          );
          await click(host().querySelector('[aria-label="设置 CTF service"]')!);
          await change(
            host().querySelector('[aria-label="CTF service互斥组"]')!,
            "route",
          );
          await change(
            host().querySelector('[aria-label="AWDP service复用互斥组"]')!,
            "route",
          );
          await change(
            host().querySelector('[aria-label="CTF service 提示 1"]')!,
            "fixed",
          );
          await change(
            host().querySelector('[aria-label="CTF service 提示 1扣分"]')!,
            "40",
          );
          await change(
            host().querySelector('[aria-label="CTF service 提示 2"]')!,
            "factor",
          );
          await change(
            host().querySelector('[aria-label="CTF service 提示 2系数"]')!,
            "0.5",
          );
          await click(host().querySelector('[aria-label="设置 Extra 1"]')!);
          await change(
            host().querySelector('[aria-label="Extra 1依赖范围"]')!,
            "global",
          );
          await click(
            host().querySelector('[aria-label="Extra 1选择前置赛题"]')!,
          );
          await change(
            document.querySelector('[aria-label="Extra 1搜索前置赛题"]')!,
            "CTF",
          );
          assert.equal(
            document.querySelector('[aria-label="依赖 AWDP service"]'),
            null,
          );
          await click(
            document.querySelector('[aria-label="依赖 CTF service"]')!,
          );
          await act(async () =>
            document.dispatchEvent(
              new dom.window.KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
              }),
            ),
          );
          const modes = host().querySelector(
            '[aria-label="Extra 1依赖完成方式"]',
          )!;
          await click(
            [...modes.querySelectorAll("button")].find(
              (el) => el.textContent === "任一完成",
            )!,
          );
          await tab("基本信息");
          await click(button("保存比赛"));
          const first = writes.at(-1)!;
          assert.deepEqual(first.submission_overrides, [
            { challenge_id: awdp.id, defense: 12, flag: null },
          ]);
          assert.deepEqual(
            (first.hint_overrides as HintOverride[]).map((h) => h.policy),
            [
              { mode: "fixed", points: 40 },
              { mode: "factor", factor: 0.5 },
            ],
          );
          const settings = first.challenge_settings as ContestQuestion[];
          assert.equal(
            settings.find((s) => s.challenge_id === awdp.id)!.logic
              .exclusive_group,
            "route",
          );
          assert.deepEqual(
            settings.find((s) => s.challenge_id === questionBank[2]!.id)!.logic
              .dependency,
            { scope: "global", mode: "any", challenge_ids: [ctf.id] },
          );
          await mount(
            <ContestForm
              contest={{
                ...contest,
                challenge_settings: settings,
                submission_overrides:
                  first.submission_overrides as SubmissionOverride[],
                hint_overrides: first.hint_overrides as HintOverride[],
              }}
              pending={false}
              save={async (value) => {
                writes.push(value);
              }}
            />,
          );
          await settle(
            () => !!host().querySelector('[aria-label="设置 AWDP service"]'),
          );
          await tab("赛题设置");
          await click(
            host().querySelector('[aria-label="设置 AWDP service"]')!,
          );
          await change(
            host().querySelector(
              '[aria-label="AWDP service Flag 提交次数方式"]',
            )!,
            "inherit",
          );
          await change(
            host().querySelector('[aria-label="AWDP service互斥组"]')!,
            "",
          );
          await click(host().querySelector('[aria-label="设置 Extra 1"]')!);
          assert.equal(
            host().querySelector<HTMLSelectElement>(
              '[aria-label="Extra 1依赖范围"]',
            )!.value,
            "global",
          );
          await change(
            host().querySelector('[aria-label="Extra 1依赖范围"]')!,
            "team",
          );
          await click(button("保存比赛"));
          assert.deepEqual(writes.at(-1)!.submission_overrides, [
            { challenge_id: awdp.id, defense: 12 },
          ]);
          assert.equal(
            (writes.at(-1)!.challenge_settings as ContestQuestion[]).find(
              (s) => s.challenge_id === questionBank[2]!.id,
            )!.logic.dependency!.scope,
            "team",
          );
          assert.equal(
            (writes.at(-1)!.challenge_settings as ContestQuestion[]).find(
              (s) => s.challenge_id === awdp.id,
            )!.logic.exclusive_group,
            null,
          );
          await click(host().querySelector('[aria-label="设置 CTF service"]')!);
          await change(
            host().querySelector('[aria-label="CTF service 提示 1"]')!,
            "free",
          );
          await change(
            host().querySelector('[aria-label="CTF service 提示 2"]')!,
            "inherit",
          );
          await click(button("保存比赛"));
          assert.deepEqual(writes.at(-1)!.hint_overrides, [
            {
              challenge_id: ctf.id,
              hint_id: "hint-one",
              policy: { mode: "free" },
            },
          ]);
          await click(
            host().querySelector('[aria-label="赛题操作 CTF service"]')!,
            "pointerdown",
          );
          await click(
            document.querySelector('[aria-label="移除 CTF service"]')!,
          );
          await click(button("保存比赛"));
          const final = writes.at(-1)!;
          assert.deepEqual(final.hint_overrides, []);
          assert.equal(
            (final.challenge_settings as ContestQuestion[]).find(
              (s) => s.challenge_id === questionBank[2]!.id,
            )!.logic.dependency,
            null,
          );
        },
      );
      await t.test(
        "mixed questions keep individual scoring and time settings across tabs",
        async () => {
          const contest: any = {
            id: "20000000-0000-4000-8000-000000000001",
            title: "Mixed",
            description: "",
            starts_at: new Date(Date.now() + 3600000).toISOString(),
            ends_at: new Date(Date.now() + 7200000).toISOString(),
            freeze_at: null,
            team_limit: 4,
            published: false,
            groups: [],
            challenge_ids: [ctf.id, awdp.id],
          };
          await mount(
            <ContestForm
              contest={contest}
              pending={false}
              save={(value) => (saved = value)}
            />,
          );
          await settle(() => host().textContent!.includes("CTF service"));
          await tab("赛题设置");
          await click(host().querySelector('[aria-label="设置 CTF service"]')!);
          await click(
            host().querySelector(
              '[aria-label="CTF service计分方式"] [role="radio"][value="dynamic"]',
            )!,
          );
          await change(
            host().querySelector('input[aria-label="CTF service初始分"]')!,
            "400",
          );
          await settle(() => !!host().querySelector(".recharts-line-curve"));
          await click(
            host().querySelector(
              '[aria-label="CTF service计分方式"] [role="radio"][value="round"]',
            )!,
          );
          assert.equal(
            host().querySelector('[aria-label="CTF service每轮时长"]'),
            null,
          );
          await tab("时间规则");
          await change(
            host().querySelector('input[name="round_duration"]')!,
            "60",
          );
          await click(host().querySelector('[aria-label="客观题自由开始"]')!);
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "时间规则",
          );
          const phase = host()
            .querySelector('[aria-label="客观题作答方式"]')!
            .closest("fieldset")!;
          const dates = phase.querySelectorAll('input[type="datetime-local"]');
          await change(
            dates[0]!,
            host().querySelector<HTMLInputElement>('input[name="starts_at"]')!
              .value,
          );
          await change(
            dates[1]!,
            host().querySelector<HTMLInputElement>('input[name="ends_at"]')!
              .value,
          );
          await change(phase.querySelector('input[type="number"]')!, "30");
          await tab("报名分组");
          await click(button("保存比赛"));
          assert.deepEqual(saved.challenge_ids, [ctf.id, awdp.id]);
          assert.equal(
            saved.challenge_settings.find((s: any) => s.challenge_id === ctf.id)
              .scoring.points.initial_points,
            400,
          );
          assert.equal(saved.round_duration, 60);
          assert.equal(
            saved.challenge_settings.find(
              (s: any) => s.challenge_id === awdp.id,
            ).scoring.mode,
            "inherit",
          );
          assert.equal(saved.timing.objective.duration_seconds, 1800);
          assert.equal(ctf.initial_points, 100);
        },
      );
      await t.test(
        "signup uses one navigation layer and field menus preserve edits through preview",
        async () => {
          saved = undefined;
          await mount(
            <ContestForm
              contest={
                {
                  title: "Signup",
                  description: "",
                  starts_at: "2035-01-01T00:00:00Z",
                  ends_at: "2035-01-02T00:00:00Z",
                  team_limit: 4,
                  groups: [],
                  challenge_ids: [],
                } as any
              }
              pending={false}
              save={(v) => {
                saved = v;
              }}
            />,
          );
          await tab("报名设置");
          const panel = host().querySelector('[data-config-tab="signup"]')!;
          assert.equal(panel.querySelectorAll('[role="tablist"]').length, 0);
          assert.equal(host().querySelectorAll("#contest-form").length, 1);
          for (const name of ["access", "registration", "form"])
            assert(panel.querySelector(`[data-config-tab="${name}"]`));
          await click(button("添加字段")!, "pointerdown");
          await click(
            [...document.querySelectorAll('[role="menuitem"]')].find(
              (el) => el.textContent === "自定义字段",
            )!,
          );
          await tab("基本信息");
          await click(button("保存比赛")!);
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector(
              '[role="tablist"][aria-label="比赛配置"] [aria-selected="true"]',
            )!.textContent,
            "报名设置",
          );
          const field = host().querySelector<HTMLInputElement>(
            "[data-registration-field] input",
          )!;
          await change(field, "学校");
          await click(button("预览表单")!);
          const dialog = document.querySelector('[role="dialog"]')!;
          assert(dialog.textContent!.includes("学校"));
          assert.equal(
            host().querySelector("[data-registration-field] input"),
            field,
          );
          await click(
            [...dialog.querySelectorAll("button")].find(
              (el) => el.textContent === "关闭",
            )!,
          );
          assert.equal(field.value, "学校");
          await click(button("保存比赛")!);
          assert.equal(saved.registration_form[0].label, "学校");
          await click(
            host().querySelector('[aria-label="字段 1 操作"]')!,
            "pointerdown",
          );
          await click(
            [...document.querySelectorAll('[role="menuitem"]')].find(
              (el) => el.textContent === "删除字段",
            )!,
          );
          assert.equal(host().querySelector("[data-registration-field]"), null);
        },
      );
      await t.test(
        "access settings preserve independent spectator switches, invitation codes and selected teams across tabs",
        async () => {
          saved = undefined;
          await mount(
            <ContestForm
              contest={
                {
                  title: "Access",
                  description: "",
                  starts_at: new Date(Date.now() + 3600000).toISOString(),
                  ends_at: new Date(Date.now() + 7200000).toISOString(),
                  team_limit: 4,
                  groups: [],
                  challenge_ids: [],
                } as any
              }
              pending={false}
              save={(v) => {
                saved = v;
              }}
            />,
          );
          await tab("访问与报名");
          const toggle = (name: string) =>
            host()
              .querySelector(`input[name="${name}"]`)!
              .closest("label")!
              .querySelector<HTMLButtonElement>("button")!;
          assert.equal(
            toggle("spectator_enabled").getAttribute("data-state"),
            "checked",
          );
          await tab("基本信息");
          for (const name of [
            "published",
            "spectator_enabled",
            "spectator_scoreboard",
            "practice_mode",
          ]) {
            assert.equal(
              toggle(name)
                .closest("[data-config-tab]")
                ?.getAttribute("data-config-tab"),
              "content",
            );
          }
          await click(toggle("spectator_scoreboard"));
          await click(toggle("practice_mode"));
          await tab("访问与报名");
          await click(toggle("auto_approve"));
          const inviteCode = host().querySelector<HTMLInputElement>(
            '[name="registration_code"]',
          )!;
          assert.equal(inviteCode.disabled, false);
          assert.equal(inviteCode.closest("[hidden]"), null);
          await click(
            host().querySelector('[aria-label="随机生成比赛邀请码"]')!,
          );
          assert.match(inviteCode.value, /^[a-f0-9]{12}$/);
          assert.equal(
            host().querySelector<HTMLSelectElement>(
              '[name="registration_mode"]',
            )!.value,
            "invite",
          );
          assert.equal(
            host().querySelector<HTMLButtonElement>(
              '[aria-label="复制比赛邀请码"]',
            )!.disabled,
            false,
          );
          await change(inviteCode, "");
          await change(
            host().querySelector('[name="registration_mode"]')!,
            "public",
          );
          await change(inviteCode, "typed-invite");
          assert.equal(
            host().querySelector<HTMLSelectElement>(
              '[name="registration_mode"]',
            )!.value,
            "invite",
          );
          await change(inviteCode, "");
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector(
              '[role="tablist"][aria-label="比赛配置"] [aria-selected="true"]',
            )!.textContent,
            "报名设置",
          );
          assert.equal(
            host()
              .querySelector('[data-config-tab="signup"]')!
              .hasAttribute("hidden"),
            false,
          );
          assert.equal(
            host()
              .querySelector('[data-config-tab="access"]')!
              .hasAttribute("hidden"),
            false,
          );
          await change(
            host().querySelector('[name="registration_code"]')!,
            "invite-123",
          );
          await tab("报名分组");
          await click(button("保存比赛"));
          assert.equal(saved.spectator_enabled, true);
          assert.equal(saved.spectator_scoreboard, false);
          assert.equal(saved.practice_mode, true);
          assert.equal(saved.require_review, true);
          assert.equal(saved.registration_mode, "invite");
          assert.equal(saved.registration_code, "invite-123");
          await tab("访问与报名");
          await change(
            host().querySelector('[name="registration_mode"]')!,
            "teams",
          );
          assert.equal(
            host().querySelector('[aria-label="搜索可报名战队"]'),
            null,
          );
          await click(button("选择战队"));
          await settle(
            () => !!document.querySelector('[aria-label="选择战队 Alpha"]'),
          );
          await click(document.querySelector('[aria-label="选择战队 Alpha"]')!);
          await click(button("确认选择"));
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved.registration_mode, "teams");
          assert.deepEqual(saved.registration_team_ids, ["team-a"]);
          assert.equal(saved.registration_code, "");
        },
      );
      await t.test(
        "registration dates validate in the signup panel and retain values across tabs",
        async () => {
          saved = undefined;
          await mount(
            <ContestForm
              contest={
                {
                  title: "Schedule",
                  description: "",
                  starts_at: "2035-01-02T00:00:00Z",
                  ends_at: "2035-01-04T00:00:00Z",
                  team_limit: 4,
                  groups: [],
                  challenge_ids: [],
                } as any
              }
              pending={false}
              save={(value) => {
                saved = value;
              }}
            />,
          );
          const opens = host().querySelector<HTMLInputElement>(
            '[name="registration_opens_at"]',
          )!;
          const closes = host().querySelector<HTMLInputElement>(
            '[name="registration_closes_at"]',
          )!;
          for (const input of [
            opens,
            closes,
            host().querySelector('[name="team_limit"]')!,
            host().querySelector('[name="auto_approve"]')!,
          ]) {
            assert.equal(
              input
                .closest("[data-config-tab]")
                ?.getAttribute("data-config-tab"),
              "access",
            );
          }
          await tab("访问与报名");
          await change(opens, "2035-01-03T12:00");
          await change(closes, "2035-01-02T12:00");
          await tab("资源限制");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector(
              '[role="tablist"][aria-label="比赛配置"] [aria-selected="true"]',
            )?.textContent,
            "报名设置",
          );
          assert.equal(
            host().querySelector(
              '[role="tablist"][aria-label="比赛配置"] [aria-selected="true"]',
            )?.textContent,
            "报名设置",
          );
          assert.match(
            host().querySelector('[role="alert"]')?.textContent ?? "",
            /报名开放时间必须早于报名截止时间/,
          );
          await change(opens, "2035-01-01T12:00");
          await change(closes, "2035-01-05T12:00");
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.match(
            host().querySelector('[role="alert"]')?.textContent ?? "",
            /报名截止时间不能晚于比赛结束时间/,
          );
          await change(closes, "2035-01-02T12:00");
          await tab("时间规则");
          await click(button("保存比赛"));
          assert.equal(
            saved.registration_opens_at,
            new Date("2035-01-01T12:00").toISOString(),
          );
          assert.equal(
            saved.registration_closes_at,
            new Date("2035-01-02T12:00").toISOString(),
          );
        },
      );
      await t.test(
        "private visibility and independent resource limits persist across tabs",
        async () => {
          saved = undefined;
          await mount(
            <ContestForm
              contest={
                {
                  title: "Private",
                  description: "",
                  starts_at: new Date(Date.now() + 3600000).toISOString(),
                  ends_at: new Date(Date.now() + 7200000).toISOString(),
                  team_limit: 4,
                  groups: [],
                  challenge_ids: [],
                } as any
              }
              pending={false}
              save={(value) => {
                saved = value;
              }}
            />,
          );
          await tab("访问与报名");
          await change(host().querySelector('[name="visibility"]')!, "private");
          assert.equal(
            host().querySelector<HTMLSelectElement>(
              '[name="registration_mode"]',
            )!.value,
            "teams",
          );
          assert(
            host().querySelector<HTMLOptionElement>(
              '[name="registration_mode"] option[value="invite"]',
            )!.disabled,
          );
          assert.equal(
            host().querySelector('[aria-label="搜索可报名战队"]'),
            null,
          );
          await click(button("选择战队"));
          await settle(
            () => !!document.querySelector('[aria-label="选择战队 Alpha"]'),
          );
          await click(document.querySelector('[aria-label="选择战队 Alpha"]')!);
          await click(button("确认选择"));
          await tab("资源限制");
          await change(
            host().querySelector('[name="containers_per_team"]')!,
            "2",
          );
          await change(
            host().querySelector('[name="attachments_per_team"]')!,
            "0",
          );
          await change(host().querySelector('[name="containers_total"]')!, "8");
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved.visibility, "private");
          assert.equal(saved.registration_mode, "teams");
          assert.deepEqual(saved.registration_team_ids, ["team-a"]);
          assert.deepEqual(saved.resource_limits, {
            containers_per_team: 2,
            attachments_per_team: 0,
            containers_total: 8,
            attachments_total: null,
            container_starts_per_team: null,
          });
          saved = undefined;
          await tab("资源限制");
          await change(
            host().querySelector('[name="containers_per_team"]')!,
            "-1",
          );
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "资源限制",
          );
        },
      );
      await t.test(
        "multipart scores stay together and off-page invalid settings reveal the right question",
        async () => {
          saved = undefined;
          await mount(
            <ContestForm
              contest={
                {
                  title: "All questions",
                  description: "",
                  starts_at: new Date(Date.now() + 3600000).toISOString(),
                  ends_at: new Date(Date.now() + 7200000).toISOString(),
                  freeze_at: null,
                  team_limit: 4,
                  groups: [],
                  challenge_ids: questionBank.map((c) => c.id),
                } as any
              }
              pending={false}
              save={(v) => {
                saved = v;
              }}
            />,
          );
          await tab("赛题设置");
          await settle(
            () => !!host().querySelector('[aria-label="设置 AWDP service"]'),
          );
          const trigger = host().querySelector(
            '[aria-label="设置 AWDP service"]',
          )!;
          await click(trigger.parentElement!);
          assert.equal(trigger.getAttribute("aria-expanded"), "true");
          const enabled = host().querySelector(
            '[aria-label="在比赛中启用 AWDP service"]',
          )!;
          await click(enabled);
          assert.equal(trigger.getAttribute("aria-expanded"), "true");
          await click(enabled);
          const mode = (value: string) =>
            host().querySelector(
              `[aria-label="AWDP service计分方式"] [role="radio"][value="${value}"]`,
            )!;
          assert.equal(
            host().querySelectorAll(
              '[aria-label="AWDP service计分方式"] [role="radio"]',
            ).length,
            4,
          );
          await click(mode("dynamic"));
          await settle(
            () =>
              host().querySelectorAll('[aria-label="动态分数预览"]').length ===
              2,
          );
          assert(host().querySelector('[aria-label="Attack初始分"]'));
          assert(host().querySelector('[aria-label="Defense初始分"]'));
          await change(
            host().querySelector('[aria-label="Attack初始分"]')!,
            "10",
          );
          await click(
            host().querySelector('[aria-label="设置 AWDP service"]')!,
          );
          await click(
            host().querySelector(
              '[aria-label="赛题配置"] [aria-label="下一页"]',
            )!,
          );
          await settle(
            () => !!host().querySelector('[aria-label="设置 Extra 10"]'),
          );
          await click(button("保存比赛"));
          await settle(
            () => !!host().querySelector('[aria-label="Attack初始分"]'),
          );
          assert.equal(saved, undefined);
          assert.match(
            host().querySelector('[role="alert"]')!.textContent!,
            /最低分/,
          );
          await change(
            host().querySelector('[aria-label="Attack初始分"]')!,
            "250",
          );
          await change(
            host().querySelector('[aria-label="Defense初始分"]')!,
            "350",
          );
          await click(
            host().querySelector(
              '[aria-label="AWDP service上线安排"] [role="radio"][value="scheduled"]',
            )!,
          );
          await click(
            host().querySelector('[aria-label="设置 AWDP service"]')!,
          );
          await click(button("保存比赛"));
          await settle(
            () => !!host().querySelector('[aria-label="AWDP service上线时间"]'),
          );
          assert.match(
            host().querySelector('[role="alert"]')!.textContent!,
            /请选择上线时间/,
          );
          await click(
            host().querySelector(
              '[aria-label="AWDP service上线安排"] [role="radio"][value="phase"]',
            )!,
          );
          await click(button("保存比赛"));
          assert.equal(saved.challenge_ids.length, 12);
          const scores = saved.challenge_settings.find(
            (v: any) => v.challenge_id === awdp.id,
          ).scoring.parts;
          assert.equal(scores[0].points.initial_points, 250);
          assert.equal(scores[1].points.initial_points, 350);
          assert.equal(awdp.parts[0]!.initial_points, 200);
        },
      );
      await t.test(
        "objective answers save privately and final submission requires confirmation",
        async () => {
          await mount(
            <ObjectiveAnswer
              id={ctf.id}
              scope="contest"
              definition={{
                type: "single",
                options: [
                  { id: "A", text: "First" },
                  { id: "B", text: "Second" },
                ],
                blanks: [],
                case_sensitive: true,
                trim: true,
              }}
            />,
          );
          await settle(() => !button("保存答案").disabled);
          assert(button("提交答案").disabled);
          await click(host().querySelectorAll('[role="radio"]')[1]!);
          await click(button("保存答案"));
          await settle(() => requests.some((r) => r.body?.finalize === false));
          assert.equal(answer.correct, null);
          await settle(() => !button("保存答案").disabled);
          await click(button("提交答案"));
          assert(document.querySelector('[role="dialog"]'));
          assert(
            !requests.some(
              (r) => r.path.includes("/answer") && r.body?.finalize,
            ),
          );
          await click(button("确认提交"));
          await settle(
            () => !!host().querySelector('label[data-result="correct"]'),
          );
          assert(!host().textContent!.includes("答案正确"));
          assert(!host().querySelector("[data-feedback-motion]"));
          assert(
            host()
              .querySelector('label[data-result="correct"]')
              ?.textContent?.includes("Second"),
          );
          assert.equal(
            host().querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!
              .disabled,
            true,
          );
        },
      );
      await t.test(
        "practice submissions confirm once and stay locked after reload",
        async () => {
          for (const scope of ["practice", "contest"]) {
            userId = `objective-player-${scope}`;
            answer = {
              answer: {},
              correct: null,
              finalized_at: null,
              practice: scope !== "practice",
            };
            const view = (
              <ObjectiveAnswer
                id={ctf.id}
                scope={scope}
                definition={{
                  type: "single",
                  options: [
                    { id: "A", text: "First" },
                    { id: "B", text: "Second" },
                  ],
                  blanks: [],
                  case_sensitive: true,
                  trim: true,
                }}
              />
            );
            await mount(view);
            await settle(
              () => !!button("保存答案") && !button("保存答案").disabled,
            );
            await click(host().querySelectorAll('[role="radio"]')[1]!);
            const count = requests.length;
            await click(button("提交答案"));
            assert(
              document
                .querySelector('[role="dialog"]')
                ?.textContent?.includes("不能修改"),
            );
            assert.equal(
              requests.length,
              count,
              "opening confirmation does not submit",
            );
            await click(button("确认提交"));
            await settle(() => !!answer.finalized_at && !button("提交答案"));
            assert(!button("保存答案"));
            assert(
              [
                ...host().querySelectorAll<HTMLButtonElement>('[role="radio"]'),
              ].every((e) => e.disabled),
            );
            await mount(view);
            await settle(
              () => !!host().querySelector('[data-result="correct"]'),
            );
            assert(!button("提交答案") && !button("保存答案"));
            assert(
              [
                ...host().querySelectorAll<HTMLButtonElement>('[role="radio"]'),
              ].every((e) => e.disabled),
            );
          }
        },
      );
      await t.test(
        "objective submission notice is remembered across questions and reloads per account",
        async () => {
          userId = "notice-player";
          const view = (id: string, scope = "practice") => (
            <ObjectiveAnswer
              id={id}
              scope={scope}
              definition={{
                type: "single",
                options: [{ id: "B", text: "Second" }],
                blanks: [],
                case_sensitive: true,
                trim: true,
              }}
            />
          );
          const open = async (id: string, scope?: string) => {
            answer = { answer: {}, correct: null, finalized_at: null };
            await mount(view(id, scope));
            await settle(
              () => !!button("保存答案") && !button("保存答案").disabled,
            );
            await click(host().querySelector('[role="radio"]')!);
          };
          await open("notice-first");
          const count = requests.length;
          await click(button("提交答案"));
          assert(document.querySelector('[role="dialog"]'));
          await click(button("继续检查"));
          assert.equal(requests.length, count);
          await click(button("提交答案"));
          assert(
            document.querySelector('[role="dialog"]'),
            "cancel does not acknowledge",
          );
          await click(button("确认提交"));
          await settle(() => !!answer.finalized_at && !button("提交答案"));
          assert.equal(requests.length, count + 1);
          for (const scope of ["practice", "contest"]) {
            await open(`notice-next-${scope}`, scope);
            const before = requests.length;
            await click(button("提交答案"));
            assert(!document.querySelector('[role="dialog"]'));
            await settle(() => !!answer.finalized_at && !button("提交答案"));
            assert.equal(requests.length, before + 1);
          }
          userId = "notice-another-player";
          await open("notice-account");
          await click(button("提交答案"));
          assert(
            document.querySelector('[role="dialog"]'),
            "different account is reminded",
          );
          await click(button("继续检查"));
        },
      );
      await t.test(
        "a finalized server answer replaces an older local draft result",
        async () => {
          answer = {
            answer: {},
            correct: null,
            finalized_at: null,
            practice: true,
          };
          await mount(
            <ObjectiveAnswer
              id={ctf.id}
              scope="practice"
              definition={{
                type: "single",
                options: [
                  { id: "A", text: "First" },
                  { id: "B", text: "Second" },
                ],
                blanks: [],
                case_sensitive: true,
                trim: true,
              }}
            />,
          );
          await settle(
            () => !!button("保存答案") && !button("保存答案").disabled,
          );
          await click(host().querySelectorAll('[role="radio"]')[0]!);
          await click(button("保存答案"));
          await settle(
            () =>
              answer.answer.choices?.[0] === "A" &&
              !button("保存答案").disabled,
          );
          answer = {
            answer: { choices: ["B"] },
            correct: true,
            finalized_at: new Date().toISOString(),
            review: { choices: ["B"] },
            practice: true,
          };
          await act(async () => {
            cache.setQueryData(
              [`/challenges/${ctf.id}/answer?scope=practice`],
              answer,
            );
          });
          await settle(() => !button("提交答案"));
          assert(!button("保存答案"));
          const selected =
            host().querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!;
          assert(selected.disabled);
          assert.equal(selected.getAttribute("aria-checked"), "true");
        },
      );
      await t.test(
        "starting a flexible phase explicitly starts the whole team clock",
        async () => {
          await mount(
            <PhaseCards
              scope="contest"
              phases={[
                {
                  section: "practical",
                  mode: "flexible",
                  opens_at: new Date(Date.now() - 1000).toISOString(),
                  closes_at: new Date(Date.now() + 3600000).toISOString(),
                  duration_seconds: 1800,
                  started_at: null,
                  deadline_at: null,
                  status: "ready",
                },
              ]}
            />,
          );
          await click(button("开始实操题"));
          assert.match(
            document.querySelector('[role="dialog"]')!.textContent!,
            /全队共享 30 分钟/,
          );
          await click(button("确认开始"));
          await settle(() =>
            requests.some(
              (r) => r.path === "/api/contests/contest/start/practical",
            ),
          );
          await settle(() => !document.querySelector('[role="dialog"]'));
        },
      );
    } finally {
      await cleanup();
      await new Promise((r) => setTimeout(r, 200));
      dom.window.close();
      for (const [key, value] of original)
        if (value) Object.defineProperty(globalThis, key, value);
        else delete (globalThis as any)[key];
    }
  },
);
