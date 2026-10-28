import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
test(
  "basic admin pages save coherent settings without exposing credentials",
  { timeout: 30000 },
  async (t) => {
    const dom = new JSDOM("<div id='root'></div>", {
        url: "http://localhost/",
        pretendToBeVisual: true,
      }),
      original = new Map<string, PropertyDescriptor | undefined>();
    dom.window.matchMedia = (() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    })) as any;
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      MutationObserver: dom.window.MutationObserver,
      FormData: dom.window.FormData,
      Event: dom.window.Event,
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
        configurable: true,
        writable: true,
        value,
      });
    }
    original.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query"),
      { App } = await import("../src/App");
    const container = document.getElementById("root")!;
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>;
    const writes: { path: string; body: any }[] = [];
    const site = {
      name: "Training CTF",
      footer_text: "教学平台",
      footer_link_label: "文档",
      footer_link_url: "https://example.com/docs",
      email_verification: false,
    };
    const settings: any = {
      site: {
        name: site.name,
        footer_text: site.footer_text,
        footer_link_label: site.footer_link_label,
        footer_link_url: site.footer_link_url,
      },
      containers: {
        default_ttl: 1800,
        renew_limit: 7,
        renew_seconds: 1800,
        auto_destroy: false,
        max_instances: 64,
        max_owner_instances: 2,
        destroy_on_solve: false,
      },
      mail: {
        require_verification: false,
        allowed_emails: ["example.com"],
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        username: "test",
        password_set: true,
        from_address: "test@example.com",
        from_name: "Training",
      },
    };
    const route = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test route",
      enabled: true,
      protocol: "openai",
      base_url: "https://example.com/v1",
      key_set: true,
      access_prefix: "nebu_ai_example",
      models: [{ alias: "contest", upstream: "model-one" }],
      rpm: 30,
      daily_limit: 500,
      concurrency: 2,
      max_tokens: 1024,
      timeout_seconds: 60,
      calls: 0,
      failures: 0,
    };
    let fail = false;
    const cleanup = async () => {
      if (root) {
        await act(async () => root!.unmount());
        root = undefined;
      }
      cache?.clear();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
    };
    const settle = async (fn: () => boolean) => {
      for (let i = 0; i < 120 && !fn(); i++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
      assert(fn(), "UI settled");
    };
    const click = async (el: Element | null) => {
      assert(el);
      await act(async () =>
        el.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    const submit = async () => {
      await act(async () =>
        container
          .querySelector("form")!
          .dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
    };
    const input = (name: string, value: string) => {
      (container.querySelector(`[name="${name}"]`) as HTMLInputElement).value =
        value;
    };
    const mount = async (path: string) => {
      await cleanup();
      writes.length = 0;
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      globalThis.fetch = async (url, options) => {
        const path = String(url).replace(/^\/api/, "");
        if (path === "/site") return Response.json(site);
        if (path === "/me")
          return Response.json({
            user: { id: "admin", username: "admin", role: "admin" },
          });
        if (options?.method && options.method !== "GET") {
          const body = options.body ? JSON.parse(String(options.body)) : {};
          writes.push({ path, body });
          if (path === "/admin/ai-routes")
            return Response.json({
              id: route.id,
              access_key: "nebu_ai_once_only",
            });
          return Response.json({ ok: true });
        }
        if (path.startsWith("/admin/settings/")) {
          if (fail) return Response.json({ error: "offline" }, { status: 503 });
          return Response.json(settings[path.split("/").at(-1)!]);
        }
        if (path.startsWith("/admin/overview"))
          return Response.json({
            users: 12,
            teams: 3,
            challenges: 8,
            published_challenges: 6,
            active_contests: 1,
            pending_registrations: 2,
            new_users: 4,
            activity: [{ day: "2026-10-26", submissions: 10, correct: 5 }],
            categories: [{ category: "Web", count: 8 }],
            resources: {
              n: 2,
              cpu: 500,
              memory: 256,
              limits: { n: 8, cpu: 2000, memory: 1024 },
              states: [],
            },
            failures: [],
            ai: { requests: 0, failed: 0, tokens: 0 },
            worker_at: new Date().toISOString(),
            sampled_at: new Date().toISOString(),
          });
        if (path.startsWith("/admin/ai-routes?"))
          return Response.json({ items: [route], total: 1 });
        if (path === `/admin/ai-routes/${route.id}`)
          return Response.json(route);
        return Response.json({ items: [], total: 0 });
      };
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
        () => !!container.querySelector('nav[aria-label="管理导航"]'),
      );
    };
    t.after(async () => {
      await cleanup();
      dom.window.close();
      for (const [key, d] of original)
        if (d) Object.defineProperty(globalThis, key, d);
        else delete (globalThis as any)[key];
    });
    await t.test(
      "overview is the admin landing page and the basic group comes first",
      async () => {
        await mount("/admin");
        await settle(() => !!container.textContent?.includes("提交趋势"));
        const nav = container.querySelector('nav[aria-label="管理导航"]')!;
        assert(
          nav.textContent!.indexOf("基础") < nav.textContent!.indexOf("内容"),
        );
        assert(
          nav.querySelector('a[aria-current="page"][href="/admin/overview"]'),
        );
        assert(container.textContent!.includes("Worker 在线"));
        assert.equal(document.title, `概览 - ${site.name}`);
        assert(container.textContent!.includes("教学平台"));
        assert.equal(
          container.querySelectorAll('[aria-label="CPU 配额"]').length,
          1,
        );
      },
    );
    await t.test(
      "site and container forms save independent sections with explicit units",
      async () => {
        await mount("/admin/settings");
        await settle(() => !!container.querySelector('input[name="name"]'));
        input("name", "New CTF");
        await submit();
        await settle(() => writes.length === 1);
        assert.equal(writes[0]!.body.name, "New CTF");
        assert(!("password" in writes[0]!.body));
        await mount("/admin/containers");
        await settle(() => !!container.querySelector('[name="default_ttl"]'));
        input("default_ttl", "45");
        input("renew_limit", "3");
        input("renew_seconds", "10");
        await click(
          container.querySelector(
            '[role="switch"][aria-label="自动销毁旧实例"]',
          ),
        );
        await submit();
        await settle(() => writes.length === 1);
        assert.deepEqual(writes[0]!.body, {
          default_ttl: 2700,
          renew_limit: 3,
          renew_seconds: 600,
          auto_destroy: true,
          max_instances: 64,
          max_owner_instances: 2,
          destroy_on_solve: false,
        });
      },
    );
    await t.test(
      "mail credentials remain blank and tests require a separate explicit action",
      async () => {
        await mount("/admin/mail");
        await settle(() => !!container.querySelector('[name="password"]'));
        assert.equal(
          (container.querySelector('[name="password"]') as HTMLInputElement)
            .value,
          "",
        );
        assert.equal(writes.length, 0);
        await click(
          container.querySelector(
            '[role="switch"][aria-label="注册时验证邮箱"]',
          ),
        );
        input("allowed_emails", "example.edu\nme@example.org");
        await submit();
        await settle(() => writes.length === 1);
        assert.equal(writes[0]!.body.require_verification, true);
        assert.deepEqual(writes[0]!.body.allowed_emails, [
          "example.edu",
          "me@example.org",
        ]);
        assert.equal(writes[0]!.body.password, "");
        assert(!writes.some((w) => w.path.endsWith("/test")));
      },
    );
    await t.test(
      "AI editing displays every mapping and the key only after creation",
      async () => {
        await mount("/admin/ai");
        await settle(
          () =>
            !!container.querySelector(`a[href="/admin/ai/${route.id}/edit"]`),
        );
        await click(
          container.querySelector(`a[href="/admin/ai/${route.id}/edit"]`),
        );
        await settle(() => !!container.querySelector('[name="api_key"]'));
        assert.equal(
          (container.querySelector('[name="api_key"]') as HTMLInputElement)
            .value,
          "",
        );
        assert(container.querySelector('[aria-label="调用模型名 1"]'));
        assert(container.querySelector('[aria-label="上游模型名 1"]'));
        assert(container.querySelector('[aria-label="OpenAI 基础地址"]'));
        assert.equal(writes.length, 0);
      },
    );
    await t.test(
      "a failed settings request replaces all form content",
      async () => {
        fail = true;
        await mount("/admin/mail");
        await settle(() => !!container.textContent?.includes("暂时无法加载"));
        assert.equal(container.querySelector("form"), null);
        fail = false;
      },
    );
  },
);
