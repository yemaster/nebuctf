import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Paper } from "../src/lib/objective-paper";

test("whole objective paper keeps navigation, drafts and team submission together", async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const original = new Map<string, PropertyDescriptor | undefined>();
  Object.assign(dom.window, {
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    scrollTo() {},
  });
  let scrolled = "";
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrolled = this.id;
  };
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
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
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
  const { createRoot } = await import("react-dom/client"),
    { MemoryRouter } = await import("react-router-dom"),
    { QueryClient, QueryClientProvider } =
      await import("@tanstack/react-query"),
    { LazyMotion, domAnimation } = await import("motion/react"),
    { Challenges } = await import("../src/pages/Challenges");
  const empty = {
    answer: {},
    correct: null,
    finalized_at: null,
    revision: null,
  };
  const paper: Paper = {
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
    items: ["single", "multiple", "blank"].map((type, i) => ({
      id: `q${i + 1}`,
      title: ["协议基础", "编码识别", "命令填空"][i]!,
      description: "测试题目",
      points: 100,
      permissions: { submit: true },
      objective: {
        type: type as any,
        options: [
          { id: "A", text: "选项一" },
          { id: "B", text: "选项二" },
        ],
        blanks: [{ id: "value", label: "命令" }],
        case_sensitive: true,
        trim: true,
      },
      saved: { ...empty },
    })),
  };
  const ctf = {
    id: "ctf",
    title: "Cookie Shop",
    description: "Web challenge",
    category: "Web",
    kind: "static_attachment",
    challenge_type: "ctf",
    points: 300,
    solves: 2,
    solved: false,
    solved_parts: 0,
    total_parts: 1,
    parts: [],
    attachments: [],
    hints: [],
    bloods: [
      {
        rank: 1,
        name: "ALPHA",
        team_id: "alpha",
        created_at: new Date().toISOString(),
      },
    ],
  };
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const path = "/contests/cup/objective-paper";
  const list = { items: [ctf], total: 4, objective_count: 3 };
  cache.setQueryData([path], paper);
  cache.setQueryData(["/challenges?scope=cup&category=&q=&page=1"], list);
  cache.setQueryData(["/challenges/ctf?scope=cup"], ctf);
  cache.setQueryData(["/me"], {
    user: { id: "player", role: "user", username: "player" },
  });
  cache.setQueryData(["/contests/cup"], {
    id: "cup",
    title: "Test",
    registered: true,
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  });
  let conflict = false;
  const writes: any[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input).replace(/^\/api/, "");
    if (url === path && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (conflict)
        return Response.json(
          { error: "队友已更新答案，请刷新答卷后重新检查" },
          { status: 409 },
        );
      const items = body.answers.map((a: any) => ({
        ...a,
        correct: body.finalize ? a.id === "q1" : null,
        review: body.finalize
          ? a.id === "q3"
            ? { blanks: { value: false } }
            : { choices: a.id === "q1" ? ["A"] : ["B"] }
          : null,
        finalized_at: body.finalize ? new Date().toISOString() : null,
        revision: `revision-${writes.length}`,
      }));
      paper.items = paper.items.map((q) => ({
        ...q,
        saved: items.find((a: any) => a.id === q.id) ?? q.saved,
      }));
      return Response.json({ items, server_time: new Date().toISOString() });
    }
    if (url === path) return Response.json(paper);
    if (url.startsWith("/challenges?")) return Response.json(list);
    return Response.json({ items: [] });
  };
  const root = createRoot(document.getElementById("root")!);
  t.after(async () => {
    await act(async () => root.unmount());
    cache.clear();
    dom.window.close();
    for (const [key, value] of original)
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
  });
  const click = async (el: Element | null) => {
    assert(el);
    await act(async () =>
      el.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
  };
  const button = (text: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    )!;
  const wait = async (check: () => boolean) => {
    for (let n = 0; n < 60 && !check(); n++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    assert(check());
  };
  const number = (n: number) =>
    document.querySelector(
      `nav[aria-label="客观题题号"] button[aria-label^="第 ${n} 题"]`,
    )!;
  await act(async () =>
    root.render(
      <QueryClientProvider client={cache}>
        <MemoryRouter
          initialEntries={["/contests/cup/challenges?challenge=objective"]}
        >
          <LazyMotion features={domAnimation}>
            <Challenges scope="cup" />
          </LazyMotion>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await wait(() => !!document.getElementById("paper-question-q3"));
  assert.equal(
    document.querySelectorAll('[aria-label="客观题答卷"] section').length,
    3,
  );
  assert(
    !document
      .querySelector('[aria-label="客观题答卷"]')!
      .textContent!.includes("解出"),
  );
  assert(number(1).className.includes("bg-muted"));
  await click(
    document.querySelector('#paper-question-q1 [role="radio"][value="A"]'),
  );
  assert.equal(number(1).getAttribute("aria-label"), "第 1 题 已填写");
  assert(number(1).className.includes("bg-blue-100"));
  await click(number(3));
  await wait(() => scrolled === "paper-question-q3");
  scrolled = "";
  await click(number(3));
  await wait(() => scrolled === "paper-question-q3");
  // Switching to a CTF question keeps the same paper and local draft mounted.
  await click(
    document
      .querySelector('[aria-label="题目目录"] button[aria-current]')
      ?.closest('[data-slot="collapsible"]')
      ?.querySelector("button") ??
      Array.from(document.querySelectorAll("aside button")).find((b) =>
        b.textContent!.includes("Cookie Shop"),
      )!,
  );
  await wait(
    () =>
      !!document
        .querySelector('[role="tabpanel"][data-state="active"]')
        ?.textContent?.includes("Web challenge"),
  );
  await click(
    Array.from(document.querySelectorAll("aside button")).find((b) =>
      b.textContent!.includes("客观题"),
    )!,
  );
  await wait(
    () =>
      !!document.querySelector(
        '[data-state="active"] [aria-label="客观题答卷"]',
      ),
  );
  assert.equal(number(1).getAttribute("aria-label"), "第 1 题 已填写");
  assert.equal(
    document
      .querySelector('aside [data-slot="accordion-trigger"]')
      ?.getAttribute("aria-expanded"),
    "true",
  );
  await click(document.querySelector('#paper-question-q2 [role="checkbox"]'));
  await click(button("保存草稿"));
  await wait(
    () =>
      writes.length === 1 &&
      !!document
        .querySelector('[role="status"]')
        ?.textContent?.includes("已保存"),
  );
  assert.equal(writes[0].answers.length, 2);
  assert.equal(number(1).getAttribute("aria-label"), "第 1 题 已填写");
  conflict = true;
  await click(button("提交答卷"));
  assert(
    document
      .querySelector('[role="dialog"]')!
      .textContent!.includes("还有 1 题未完成"),
  );
  await click(button("确认交卷"));
  await wait(
    () =>
      !!document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes("队友已更新答案"),
  );
  assert.equal(
    writes[1].answers.length,
    3,
    "whole paper includes unanswered questions",
  );
  assert.equal(writes[1].answers[0].revision, "revision-1");
  assert.equal(
    number(1).getAttribute("aria-label"),
    "第 1 题 已填写",
    "failed submission does not report success",
  );
  conflict = false;
  await click(button("确认交卷"));
  await wait(
    () =>
      !document.querySelector('[role="dialog"]') &&
      number(1).getAttribute("aria-label") === "第 1 题 正确",
  );
  assert(number(1).className.includes("text-success"));
  assert.equal(number(2).getAttribute("aria-label"), "第 2 题 错误");
  assert(number(2).className.includes("text-destructive"));
  assert.equal(number(3).getAttribute("aria-label"), "第 3 题 未作答");
  assert(!button("提交答卷"));
  assert(
    document.querySelector('#paper-question-q1 label[data-result="correct"]'),
  );
  assert(
    document.querySelector('#paper-question-q2 label[data-result="incorrect"]'),
  );
  assert(
    document.querySelector('#paper-question-q2 label[data-result="missed"]'),
  );
  assert(
    document.querySelector(
      '#paper-question-q3 input[data-result="incorrect"][aria-invalid="true"]',
    ),
  );
  assert(!document.querySelector("[data-feedback-motion]"));
  assert(
    (
      document.querySelector(
        '#paper-question-q1 [role="radio"]',
      ) as HTMLButtonElement
    ).disabled,
  );
  await act(async () =>
    cache.setQueryData([path], { ...paper, practice: true }),
  );
  assert(
    !button("提交答卷") && !button("保存草稿"),
    "practice final answers have no write actions",
  );
  assert(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="客观题答卷"] [role="radio"], [aria-label="客观题答卷"] [role="checkbox"]',
      ),
    ].every((e) => e.disabled),
  );
  assert(
    (
      document.querySelector("#paper-question-q3 input") as HTMLInputElement
    ).matches(":disabled"),
  );
  // Hover/focus details do not navigate away from the paper.
  const blood = document.querySelector(
    'button[aria-label="Cookie Shop 一血：ALPHA"]',
  ) as HTMLButtonElement;
  assert(blood);
  await act(async () => blood.focus());
  await wait(() => !!document.querySelector('[role="tooltip"]'));
  assert(
    document.querySelector('[role="tooltip"]')!.textContent!.includes("ALPHA"),
  );
  assert(
    document.querySelector('[data-state="active"] [aria-label="客观题答卷"]'),
  );
  await act(async () =>
    blood.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await wait(() => !document.querySelector('[role="tooltip"]'));
});
