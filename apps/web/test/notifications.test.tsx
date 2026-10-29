import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("notification inbox, details, mutations and standalone administration", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  dom.window.matchMedia = (() => ({
    matches: true,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    SVGElement: dom.window.SVGElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
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
    WebSocket: undefined,
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
  const { createRoot } = await import("react-dom/client"),
    { MemoryRouter } = await import("react-router-dom"),
    { QueryClient, QueryClientProvider } =
      await import("@tanstack/react-query"),
    { App } = await import("../src/App");
  const items = Array.from({ length: 13 }, (_, i) => ({
    id: `notice-${i}`,
    kind: i % 2 ? "reminder" : "contest",
    title: `审核消息 ${i}`,
    excerpt: "通知摘要",
    body: "审核说明正文",
    href: "/contests",
    action_label: "查看比赛",
    created_at: new Date().toISOString(),
    read_at: null as string | null,
    archived_at: null as string | null,
    sender: null,
  }));
  let error = false,
    admin = false,
    revision: string | null = null,
    posted: any;
  const writes: any[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost"),
      p = url.pathname.replace(/^\/api/, ""),
      body = init?.body ? JSON.parse(String(init.body)) : {};
    if (p === "/me")
      return Response.json({
        user: {
          id: "user",
          username: "测试选手",
          email: "user@example.test",
          role: admin ? "admin" : "user",
        },
      });
    if (p === "/site") return Response.json({ name: "NebuCTF" });
    if (p === "/notifications/summary")
      return Response.json({
        unread: items.filter((n) => !n.read_at && !n.archived_at).length,
        revision,
      });
    if (p === "/notifications") {
      if (error)
        return Response.json({ error: "消息读取失败" }, { status: 503 });
      const state = url.searchParams.get("state"),
        kind = url.searchParams.get("kind"),
        q = url.searchParams.get("q") ?? "",
        page = Number(url.searchParams.get("page") ?? 1);
      const filtered = items.filter(
        (n) =>
          (state === "archived" ? !!n.archived_at : !n.archived_at) &&
          (state !== "unread" || !n.read_at) &&
          (!kind || kind === n.kind) &&
          n.title.includes(q),
      );
      return Response.json({
        items: filtered.slice((page - 1) * 10, page * 10),
        total: filtered.length,
        page_size: 10,
        as_of: new Date().toISOString(),
      });
    }
    if (p === "/notifications/read-all") {
      items.forEach((n) => (n.read_at = new Date().toISOString()));
      writes.push({ p, body });
      return Response.json({ ok: true });
    }
    if (p.startsWith("/notifications/")) {
      const notice = items.find((n) => n.id === p.split("/").at(-1))!;
      if (init?.method === "PUT") {
        if (body.read !== undefined)
          notice.read_at = body.read ? new Date().toISOString() : null;
        if (body.archived !== undefined)
          notice.archived_at = body.archived ? new Date().toISOString() : null;
        writes.push({ p, body });
        return Response.json({ ok: true });
      }
      return Response.json(notice);
    }
    if (p === "/admin/notifications" && init?.method === "POST") {
      posted = body;
      return Response.json({ id: "sent", recipients: 1 });
    }
    if (p === "/admin/notifications")
      return Response.json({ items: [], total: 0 });
    return Response.json({ items: [], total: 0 });
  }) as typeof fetch;
  const host = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot> | undefined,
    cache: InstanceType<typeof QueryClient> | undefined;
  const settle = async (check: () => boolean) => {
    for (let i = 0; i < 150; i++) {
      if (check()) return;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    assert.ok(check(), host.textContent ?? "page ready");
  };
  async function mount(path: string) {
    if (root) await act(async () => root!.unmount());
    cache?.clear();
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <QueryClientProvider client={cache!}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  }
  const click = async (selector: string) => {
    const node = host.querySelector(selector) as HTMLElement;
    assert.ok(node, selector);
    await act(async () => node.click());
  };
  try {
    await t.test(
      "the complete list renders with pagination and opening marks only that message read",
      async () => {
        await mount("/messages");
        await settle(
          () =>
            !!host.querySelector('[aria-label="消息列表"] [role="listitem"]'),
        );
        assert.equal(
          host.querySelectorAll('[aria-label="消息列表"] [role="listitem"]')
            .length,
          10,
        );
        await click('button[aria-label="下一页"]');
        await settle(
          () =>
            host.querySelectorAll('[aria-label="消息列表"] [role="listitem"]')
              .length === 3,
        );
        await click('button[aria-label="查看消息：审核消息 10"]');
        await settle(() => document.body.textContent!.includes("审核说明正文"));
        await settle(() =>
          writes.some((w) => w.p === "/notifications/notice-10" && w.body.read),
        );
        assert.equal(items[10]!.read_at !== null, true);
        assert.equal(items[11]!.read_at, null);
        const dialog = document.querySelector('[role="dialog"]')!;
        assert.ok(dialog.querySelector('a[href="/contests"]'));
        await act(async () => {
          (
            dialog.querySelector('button[aria-label="标为未读"]') as HTMLElement
          ).click();
        });
        await settle(() => !document.querySelector('[role="dialog"]'));
        assert.equal(items[10]!.read_at, null);
      },
    );
    await t.test(
      "archiving clears the unread count, filters reset pages and failures replace the list",
      async () => {
        await mount("/messages");
        await settle(() => !!host.querySelector('[aria-label="消息列表"]'));
        await click('button[aria-label="归档"]');
        await settle(() => items[0]!.archived_at !== null);
        const archive = [...host.querySelectorAll("button")].find(
          (b) => b.textContent === "已归档",
        )!;
        await act(async () => archive.click());
        await settle(
          () =>
            host.querySelectorAll('[aria-label="消息列表"] [role="listitem"]')
              .length === 1,
        );
        await click('button[aria-label="移回收件箱"]');
        await settle(() => host.textContent!.includes("暂无归档消息"));
        error = true;
        await mount("/messages");
        await settle(() => host.textContent!.includes("消息读取失败"));
        assert.equal(host.querySelector('[aria-label="消息列表"]'), null);
        error = false;
        const retry = [...host.querySelectorAll("button")].find(
          (b) => b.textContent === "重试",
        )!;
        await act(async () => retry.click());
        await settle(() => !!host.querySelector('[aria-label="消息列表"]'));
      },
    );
    await t.test(
      "HTTP summary refresh also updates the inbox without WebSocket",
      async () => {
        await mount("/messages");
        await settle(() => !!host.querySelector('[aria-label="消息列表"]'));
        items.unshift({
          ...items[0]!,
          id: "new-notice",
          title: "新的审核通知",
          read_at: null,
          archived_at: null,
        });
        revision = new Date().toISOString();
        await act(async () => {
          await cache!.invalidateQueries({
            queryKey: ["notifications", "user", "summary"],
            exact: true,
          });
        });
        await settle(
          () =>
            !!host.querySelector('button[aria-label="查看消息：新的审核通知"]'),
        );
      },
    );
    await t.test(
      "system messages are composed on their own page and include an idempotency key",
      async () => {
        admin = true;
        await mount("/admin/messages/new");
        await settle(() => !!host.querySelector('textarea[name="body"]'));
        for (const [name, value] of Object.entries({
          title: "赛程调整",
          body: "延后十分钟",
          recipients: "测试选手",
          href: "/contests",
        }))
          (host.querySelector(`[name="${name}"]`) as HTMLInputElement).value =
            value;
        const form = host
          .querySelector('textarea[name="body"]')!
          .closest("form")!;
        await act(async () =>
          form.dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
        await settle(
          () => !!posted && host.textContent!.includes("暂无发送记录"),
        );
        assert.equal(posted.title, "赛程调整");
        assert.deepEqual(posted.recipients, ["测试选手"]);
        assert.equal(posted.audience, "users");
        assert.match(posted.request_id, /^[\da-f-]{36}$/i);
        assert.equal(document.querySelector('[role="dialog"]'), null);
      },
    );
  } finally {
    if (root) await act(async () => root!.unmount());
    cache?.clear();
    dom.window.close();
    for (const [key, value] of original) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
