import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { challengePoints, scoreCurve } from "../src/lib/scoring";

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
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter } = await import("react-router-dom"),
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
      answer: any = { answer: {}, correct: null, finalized_at: null };
    const requests: { path: string; body: any }[] = [];
    const ctf = {
        id: "10000000-0000-4000-8000-000000000001",
        title: "CTF service",
        challenge_type: "ctf",
        category: "Web",
        initial_points: 100,
        minimum_points: 10,
        decay: 10,
        dynamic_score: true,
        parts: [],
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
            answer: body.answer,
            correct: body.finalize ? true : null,
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
    const mount = async (child: React.ReactNode) => {
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
            <MemoryRouter>
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
    const tab = async (name: string) =>
      click(
        [...host().querySelectorAll('[role="tab"]')].find(
          (el) => el.textContent === name,
        )!,
        "mousedown",
      );
    try {
      await t.test(
        "group permissions remain visible, inherit per question and persist across pagination",
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
          const toggle = (label: string) =>
            [...host().querySelectorAll("label")]
              .find((l) => l.textContent?.trim() === label)!
              .querySelector("button")!;
          assert.equal(host().querySelectorAll('[role="switch"]').length, 9);
          assert.equal(values().permissions.score, false);
          await click(toggle("查看赛题"));
          assert.equal(values().permissions.view, false);
          await click(button("单题权限"));
          await settle(() => host().querySelectorAll("tbody tr").length === 10);
          const cb = (label: string) =>
            host().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
          assert(cb("CTF service查看赛题").disabled);
          await click(cb("CTF service沿用组别权限"));
          await click(cb("CTF service查看赛题"));
          await click(cb("CTF service使用靶机与附件"));
          assert.equal(
            (values().challenge_permissions[ctf.id] as any).view,
            true,
          );
          assert.equal(
            (values().challenge_permissions[ctf.id] as any).resources,
            false,
          );
          await click(host().querySelector('[aria-label="下一页"]')!);
          assert.equal(host().querySelectorAll("tbody tr").length, 2);
          await click(host().querySelector('[aria-label="上一页"]')!);
          assert.equal(
            cb("CTF service查看赛题").getAttribute("data-state"),
            "checked",
          );
          await click(cb("CTF service沿用组别权限"));
          assert.equal(values().challenge_permissions[ctf.id], undefined);
        },
      );
      await t.test(
        "saved group IDs are adopted without losing drafts; started scoring controls are locked",
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
          await click(button("添加组别"));
          await change(
            host().querySelector('[name="group_name"]')!,
            " 新组别 ",
          );
          const toggle = [...host().querySelectorAll("label")]
            .find((l) => l.textContent === "参与三血")!
            .querySelector("button")!;
          await click(toggle);
          await click(button("返回保存结果"));
          const [savedGroup] = readGroups(
            new dom.window.FormData(host().querySelector("form")!),
            [ctf.id],
          );
          assert.equal(savedGroup!.id, "saved-group");
          assert.equal(savedGroup!.permissions.blood, false);
          await mount(
            <GroupsEditor
              initial={[{ id: "g", name: "正式组", description: "" }]}
              challengeIds={[ctf.id]}
              started
              registered
            />,
          );
          assert(button("添加组别").disabled);
          for (const label of [
            "获得积分",
            "参与三血",
            "参与全局排名",
            "影响动态分值",
          ]) {
            assert(
              [...host().querySelectorAll("label")]
                .find((l) => l.textContent === label)!
                .querySelector("button")!.disabled,
            );
          }
          assert(
            ![...host().querySelectorAll("label")]
              .find((l) => l.textContent === "查看赛题")!
              .querySelector("button")!.disabled,
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
          await change(
            host().querySelector('select[aria-label="客观题作答方式"]')!,
            "flexible",
          );
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "时间规则",
          );
          const phase = [...host().querySelectorAll("fieldset")].find(
            (el) => el.querySelector("h3")?.textContent === "客观题",
          )!;
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
          await click(toggle("spectator_scoreboard"));
          await click(toggle("practice_mode"));
          await click(toggle("require_review"));
          await click(host().querySelector('[role="radio"][value="invite"]')!);
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            host().querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "访问与报名",
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
          await click(host().querySelector('[role="radio"][value="teams"]')!);
          await settle(() => !!button("添加"));
          await click(button("添加"));
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved.registration_mode, "teams");
          assert.deepEqual(saved.registration_team_ids, ["team-a"]);
          assert.equal(saved.registration_code, "");
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
          await click(host().querySelector('[role="radio"][value="private"]')!);
          assert.equal(
            host()
              .querySelector('[role="radio"][value="teams"]')!
              .getAttribute("data-state"),
            "checked",
          );
          assert(
            (
              host().querySelector(
                '[role="radio"][value="invite"]',
              ) as HTMLButtonElement
            ).disabled,
          );
          await settle(() => !!button("添加"));
          await click(button("添加"));
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
          await settle(() => host().textContent!.includes("答案正确"));
          assert.equal(
            host().querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!
              .disabled,
            true,
          );
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
