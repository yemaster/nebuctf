import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Challenge } from "../src/lib/types";

test(
  "organized challenge editor preserves drafts and submits complete settings",
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
      }),
    });
    const measure = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.matches(
        '[data-slot="chart"], .recharts-responsive-container, .recharts-wrapper',
      )
        ? new dom.window.DOMRect(0, 0, 640, 208)
        : measure.call(this);
    };
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      // Public HTTP origins expose getRandomValues, but not randomUUID.
      crypto: {
        getRandomValues: globalThis.crypto.getRandomValues.bind(
          globalThis.crypto,
        ),
      },
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      localStorage: dom.window.localStorage,
      Element: dom.window.Element,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      FormData: dom.window.FormData,
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
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    }
    originals.set(
      "fetch",
      Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    );
    // Load DOM-dependent modules only after installing the JSDOM globals.
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter, useLocation } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query");
    const { ChallengeForm } =
      await import("../src/components/admin/challenge-form");
    const { ThemeProvider, useTheme } =
      await import("../src/components/theme-provider");
    function RouterLocation() {
      const location = useLocation();
      return (
        <output data-editor-location>
          {location.pathname}
          {location.search}
        </output>
      );
    }
    function ThemeSwitch() {
      const { setTheme } = useTheme();
      return (
        <button onClick={() => setTheme("light")}>Test light theme</button>
      );
    }
    const base = {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Draft",
      description: "Original",
      category: "Web",
      difficulty: "入门",
      kind: "static_attachment",
      image: "",
      access_mode: "port",
      parts: [],
      hints: ["old hint"],
      attachments: [{ id: "file-1", name: "original.zip", size: 1024 }],
      initial_points: 500,
      minimum_points: 100,
      decay: 20,
      dynamic_score: true,
      published: false,
      practice: false,
      publish_at: null,
      port: 8080,
      cpu: 500,
      memory: 256,
      ttl: 1800,
    } as unknown as Challenge;
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>,
      saved: any;
    const calls: { path: string; method: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const path = String(input).replace(/^\/api/, ""),
        method = init?.method ?? "GET";
      calls.push({ path, method, body: init?.body });
      if (path === "/admin/flag-template/preview") {
        const { template } = JSON.parse(init!.body as string);
        if (template === "flag{short}")
          return Response.json({ error: "模板变化空间不足" }, { status: 400 });
        await new Promise((r) => setTimeout(r, 30));
        return Response.json({
          samples: [
            template
              .replace("[GUID]", "sample-uuid")
              .replace("[TEAM_HASH]", "012345abcdef"),
          ],
          length: 42,
          entropy: 122,
        });
      }
      if (method === "DELETE") return Response.json({ ok: true });
      if (method === "POST" && path.endsWith("/attachments"))
        return Response.json({ id: "uploaded" });
      if (path.startsWith("/admin/images/status?"))
        return Response.json({
          image: "nebuctf/edited:local",
          present: true,
          challenges: [],
          worker: { online: true },
        });
      if (path.endsWith("/test-instance"))
        return Response.json({ instance: null, next_operation_at: null });
      throw Error(`Unexpected ${method} ${path}`);
    };
    const host = document.getElementById("root")!;
    async function cleanup() {
      if (root) await act(async () => root!.unmount());
      root = undefined;
      cache?.clear();
    }
    async function mount(
      c: Challenge | null = base,
      entry = "/admin/challenges/new",
    ) {
      await cleanup();
      saved = undefined;
      calls.length = 0;
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      root = createRoot(host);
      await act(async () =>
        root!.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[entry]}>
              <RouterLocation />
              <ThemeProvider>
                <ThemeSwitch />
                <ChallengeForm
                  challenge={c}
                  pending={false}
                  onSave={(body) => {
                    saved = body;
                  }}
                />
              </ThemeProvider>
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
      await settle(() => !!host.querySelector(".w-md-editor-text-input"));
    }
    const editorURL = () =>
      new URL(
        host.querySelector("[data-editor-location]")!.textContent!,
        "https://nebuctf.test",
      );
    const field = (name: string) =>
      host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${name}"]`,
      )!;
    const select = (name: string) =>
      host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
    const button = (name: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
      )!;
    async function change(
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      value: string,
    ) {
      assert.ok(el);
      await reveal(el);
      await act(async () => {
        const proto =
          el instanceof dom.window.HTMLTextAreaElement
            ? dom.window.HTMLTextAreaElement.prototype
            : el instanceof dom.window.HTMLSelectElement
              ? dom.window.HTMLSelectElement.prototype
              : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(
          new dom.window.Event(
            el instanceof dom.window.HTMLSelectElement ? "change" : "input",
            { bubbles: true },
          ),
        );
      });
    }
    async function click(el: Element, event = "click") {
      assert.ok(el);
      await reveal(el);
      await act(async () => {
        el.dispatchEvent(
          new dom.window.MouseEvent(event, {
            bubbles: true,
            cancelable: true,
            button: 0,
            ctrlKey: false,
          }),
        );
      });
    }
    async function reveal(el: Element) {
      const panel = el.closest<HTMLElement>("[data-config-tab]");
      if (!panel?.hidden) return;
      await click(
        host.querySelector(`[role="tab"][aria-controls="${panel.id}"]`)!,
        "mousedown",
      );
    }
    async function tab(name: string) {
      const trigger = [...host.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent === name,
      )!;
      await click(trigger, "mousedown");
      assert.equal(trigger.getAttribute("aria-selected"), "true");
      assert.equal(
        host.querySelectorAll("[data-config-tab]:not([hidden])").length,
        1,
      );
      assert.equal(
        document.getElementById(trigger.getAttribute("aria-controls")!)!.hidden,
        false,
      );
    }
    async function submit() {
      const form = host.querySelector("form")!;
      assert.equal(
        form.checkValidity(),
        true,
        "only relevant controls validate",
      );
      await act(async () => {
        form.dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      assert.ok(saved);
    }
    async function settle(fn: () => boolean) {
      for (let n = 0; n < 100 && !fn(); n++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      assert.ok(fn(), "settled");
    }
    try {
      await t.test(
        "selected sections survive remounts and reject unavailable URL sections",
        async () => {
          const returnTo = "/admin/challenges?page=3&search=draft";
          await mount(
            base,
            `/admin/challenges/new?return=${encodeURIComponent(returnTo)}&section=scoring&filter=web`,
          );
          assert.equal(
            host
              .querySelector('[data-config-tab="scoring"]')!
              .hasAttribute("hidden"),
            false,
          );
          await tab("题目内容");
          await change(field("title"), "URL draft");
          assert.equal(editorURL().searchParams.has("section"), false);
          await tab("附件管理");
          assert.equal(editorURL().searchParams.get("section"), "attachments");
          assert.equal(editorURL().searchParams.get("return"), returnTo);
          assert.equal(editorURL().searchParams.get("filter"), "web");
          await tab("题目内容");
          assert.equal(field("title").value, "URL draft");
          await tab("发布设置");
          const selectedURL = editorURL().pathname + editorURL().search;
          await mount(base, selectedURL);
          assert.equal(
            host
              .querySelector('[data-config-tab="publication"]')!
              .hasAttribute("hidden"),
            false,
          );
          for (const section of ["unknown", "judging"]) {
            await mount(base, `/admin/challenges/new?section=${section}`);
            assert.equal(
              host
                .querySelector('[data-config-tab="content"]')!
                .hasAttribute("hidden"),
              false,
            );
          }
          await mount(
            { ...base, challenge_type: "objective" },
            "/admin/challenges/new?section=environment",
          );
          assert.equal(
            host
              .querySelector('[data-config-tab="content"]')!
              .hasAttribute("hidden"),
            false,
          );
        },
      );
      await t.test(
        "configuration tabs keep one visible panel and preserve drafts and editor identity",
        async () => {
          await mount();
          assert.deepEqual(
            [...host.querySelectorAll('[role="tab"]')].map(
              (el) => el.textContent,
            ),
            ["题目内容", "Flag 与计分", "靶机配置", "附件管理", "发布设置"],
          );
          const source = host.querySelector<HTMLTextAreaElement>(
            "#challenge-description",
          )!;
          await change(source, "## Draft across tabs");
          await change(field("title"), "Tabbed draft");
          await tab("Flag 与计分");
          await change(field("initial_points"), "450");
          await tab("附件管理");
          assert.ok(
            host
              .querySelector('[data-config-tab="content"]')!
              .hasAttribute("hidden"),
          );
          await tab("发布设置");
          await change(select("上线方式"), "enabled");
          await tab("题目内容");
          assert.equal(host.querySelector("#challenge-description"), source);
          assert.equal(source.value, "## Draft across tabs");
          await submit();
          assert.equal(saved.title, "Tabbed draft");
          assert.equal(saved.description, source.value);
          assert.equal(saved.initial_points, 450);
          assert.equal(saved.published, true);
          const trigger = host.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]',
          )!;
          await act(async () => {
            trigger.focus();
            trigger.dispatchEvent(
              new dom.window.KeyboardEvent("keydown", {
                key: "ArrowRight",
                bubbles: true,
              }),
            );
            await new Promise((r) => setTimeout(r, 10));
          });
          await settle(
            () =>
              host.querySelector('[role="tab"][aria-selected="true"]')!
                .textContent === "Flag 与计分",
          );
        },
      );
      await t.test(
        "saving locates invalid controls in other tabs and ignores inactive challenge modes",
        async () => {
          await mount(
            null,
            "/admin/challenges/new?return=%2Fadmin%2Fchallenges%3Fpage%3D2",
          );
          await change(field("title"), "New with tabs");
          await tab("发布设置");
          await click(button("保存题目"));
          assert.equal(saved, undefined);
          assert.equal(document.activeElement, field("flag"));
          assert.equal(editorURL().searchParams.get("section"), "scoring");
          assert.equal(
            editorURL().searchParams.get("return"),
            "/admin/challenges?page=2",
          );
          assert.equal(
            host.querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "Flag 与计分",
          );
          await change(field("flag"), "flag{valid}");
          await tab("靶机配置");
          await click(
            [...host.querySelectorAll("label")]
              .find((e) => e.textContent === "启用靶机")!
              .querySelector('[role="switch"]')!,
          );
          await tab("发布设置");
          await click(button("保存题目"));
          assert.equal(saved, undefined);
          assert.equal(document.activeElement, field("container-image"));
          assert.equal(editorURL().searchParams.get("section"), "environment");
          await change(field("container-image"), "nebuctf/edited:local");
          await change(field("container-cpu"), "50");
          await tab("附件管理");
          await click(button("保存题目"));
          assert.equal(document.activeElement, field("container-cpu"));
          assert.equal(editorURL().searchParams.get("section"), "environment");
          await change(field("container-cpu"), "500");
          await tab("发布设置");
          assert.equal(host.querySelector('input[name="publish_at"]'), null);
          assert(
            ![...select("上线方式").querySelectorAll("option")].some(
              (o) => o.value === "scheduled",
            ),
          );
          await submit();
          assert.equal(saved.challenge_type, "ctf");
          assert.equal(saved.flag, "flag{valid}");
          assert.equal(saved.resources.container.image, "nebuctf/edited:local");
          assert.equal(saved.publish_at, null);
        },
      );
      await t.test(
        "advanced container tabs preserve invalid drafts and graph edits in saved profiles",
        async () => {
          await mount(null);
          await change(field("title"), "Container graph");
          await change(field("flag"), "flag{graph}");
          await tab("靶机配置");
          await click(
            [...host.querySelectorAll("label")]
              .find((el) => el.textContent === "启用靶机")!
              .querySelector('[role="switch"]')!,
          );
          await change(field("container-image"), "nebuctf/main:1");
          const panel = (name: string) =>
            host.querySelector<HTMLElement>(`[data-topology-panel="${name}"]`)!;
          const advancedTab = async (name: string) => {
            await click(
              host.querySelector(
                `[role="tab"][aria-controls="${panel(name).id}"]`,
              )!,
              "mousedown",
            );
          };
          const service = (name: string) =>
            host.querySelector<HTMLElement>(
              `[role="group"][aria-label="辅助服务 ${name}"]`,
            )!;
          const member = (scope: HTMLElement, name: string) =>
            [...scope.querySelectorAll("label")]
              .find((el) => el.textContent?.trim() === name)!
              .querySelector('[role="checkbox"]')!;
          await advancedTab("services");
          await click(button("添加服务"));
          await change(service("service-1").querySelector("input")!, "backend");
          const backendImage =
            service("backend").querySelectorAll<HTMLInputElement>("input")[1]!;
          await tab("发布设置");
          await click(button("保存题目"));
          assert.equal(saved, undefined);
          assert.equal(document.activeElement, backendImage);
          assert.equal(panel("services").hidden, false);
          await change(backendImage, "nebuctf/backend:1");
          await change(
            service("backend").querySelectorAll<HTMLTextAreaElement>(
              "textarea",
            )[1]!,
            "CUSTOM=x=y",
          );
          await advancedTab("main");
          const mainEnvironment =
            panel("main").querySelectorAll<HTMLTextAreaElement>("textarea")[1]!;
          await change(mainEnvironment, "invalid=value");
          await advancedTab("networks");
          await click(button("添加网络"));
          const network = host.querySelector(
            '[role="group"][aria-label="网络 network-1"]',
          )!;
          await change(network.querySelector("input")!, "data");
          await advancedTab("main");
          assert.equal(mainEnvironment.value, "invalid=value");
          await click(member(panel("main"), "data（内部）"));
          await advancedTab("services");
          await click(member(service("backend"), "data（内部）"));
          await click(button("添加服务"));
          await change(service("service-1").querySelector("input")!, "cache");
          await change(
            service("cache").querySelectorAll<HTMLInputElement>("input")[1]!,
            "nebuctf/cache:1",
          );
          await click(member(service("cache"), "backend"));
          await change(service("backend").querySelector("input")!, "database");
          await tab("发布设置");
          await click(button("保存题目"));
          assert.equal(saved, undefined);
          assert.equal(document.activeElement, mainEnvironment);
          assert.equal(panel("main").hidden, false);
          assert.equal(mainEnvironment.value, "invalid=value");
          await change(mainEnvironment, "VALUE=a=b");
          await change(
            panel("main").querySelector("textarea")!,
            "python\n-B\nserver.py",
          );
          await submit();
          assert.deepEqual(saved.resources.container.command, [
            "python",
            "-B",
            "server.py",
          ]);
          assert.deepEqual(saved.resources.container.environment, {
            VALUE: "a=b",
          });
          assert.deepEqual(
            saved.resources.container.topology.primary_networks,
            ["default", "data"],
          );
          assert.deepEqual(
            saved.resources.container.topology.services[0].networks,
            ["default", "data"],
          );
          assert.deepEqual(
            saved.resources.container.topology.services[0].environment,
            { CUSTOM: "x=y" },
          );
          assert.deepEqual(
            saved.resources.container.topology.services[1].depends_on,
            ["database"],
          );
          await advancedTab("networks");
          await click(button("删除网络 data"));
          await advancedTab("services");
          await click(button("删除辅助服务 database"));
          await submit();
          assert.deepEqual(
            saved.resources.container.topology.primary_networks,
            ["default"],
          );
          assert.deepEqual(
            saved.resources.container.topology.services[0].depends_on,
            [],
          );
          assert.deepEqual(
            saved.resources.container.topology.services[0].networks,
            ["default"],
          );
          await click(button("删除辅助服务 cache"));
          await submit();
          assert.equal(saved.resources.container.topology, undefined);
          assert.deepEqual(saved.resources.container.environment, {
            VALUE: "a=b",
          });
        },
      );
      await t.test(
        "Markdown toolbar edits real source, previews safely, and saves from preview",
        async () => {
          await mount();
          let source = host.querySelector<HTMLTextAreaElement>(
            "#challenge-description",
          )!;
          await change(source, "payload");
          source.focus();
          source.setSelectionRange(0, 7);
          await click(button("粗体"));
          assert.equal(source.value, "**payload**");
          source.setSelectionRange(source.value.length, source.value.length);
          await click(button("表格"));
          assert.match(source.value, /\| Header \|/);
          await change(
            source,
            source.value +
              '\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n```python\nprint("flag")\n```',
          );
          await click(button("分屏预览"));
          assert.ok(host.querySelector(".w-md-editor-show-live"));
          assert.ok(host.querySelector(".markdown table"));
          assert.ok(host.querySelector(".markdown strong"));
          assert.equal(host.querySelector(".markdown script"), null);
          assert.equal(
            host.querySelector('.markdown a[href^="javascript:"]'),
            null,
          );
          assert.ok(
            host.querySelector(".w-md-editor-text-pre .token"),
            "source highlighting loaded",
          );
          await click(button("预览"));
          assert.equal(button("粗体").disabled, true);
          await submit();
          assert.equal(saved.description, source.value);
          await click(button("编辑"));
          source = host.querySelector<HTMLTextAreaElement>(
            "#challenge-description",
          )!;
          assert.equal(button("粗体").disabled, false);
          assert.equal(source.value, saved.description);
          await change(source, "Heading");
          source.setSelectionRange(0, 7);
          await click(button("标题"), "pointerdown");
          await settle(() => !!document.querySelector('[role="menuitem"]'));
          const heading = [
            ...document.querySelectorAll('[role="menuitem"]'),
          ].find((el) => el.textContent === "2 级标题")!;
          await click(heading);
          await settle(() => document.activeElement === source);
          assert.equal(source.value, "## Heading");
          await change(source, "a".repeat(19999));
          source.setSelectionRange(0, 1);
          await click(button("粗体"));
          assert.equal(host.querySelector("form")!.checkValidity(), false);
          assert.match(
            host.querySelector('[role="alert"]')!.textContent!,
            /20000/,
          );
          await click(button("预览"));
          assert.ok(host.querySelector(".w-md-editor-show-edit"));
          assert.equal(host.querySelector("form")!.checkValidity(), false);
          source = host.querySelector<HTMLTextAreaElement>(
            "#challenge-description",
          )!;
          await change(source, "Within limit");
          assert.equal(host.querySelector("form")!.checkValidity(), true);
        },
      );
      await t.test(
        "fullscreen exits with Escape, restores scrolling on unmount, and follows the theme",
        async () => {
          localStorage.setItem("nebuctf-theme", "dark");
          await mount();
          const editor = host.querySelector(".nebuctf-markdown-editor")!;
          assert.equal(editor.getAttribute("data-color-mode"), "dark");
          await click(button("Test light theme"));
          assert.equal(editor.getAttribute("data-color-mode"), "light");
          document.body.style.overflow = "auto";
          await click(button("全屏编辑"));
          assert.ok(editor.classList.contains("w-md-editor-fullscreen"));
          assert.equal(document.body.style.overflow, "hidden");
          await act(async () => {
            document.dispatchEvent(
              new dom.window.KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
              }),
            );
          });
          assert.equal(
            editor.classList.contains("w-md-editor-fullscreen"),
            false,
          );
          assert.equal(document.body.style.overflow, "auto");
          await click(button("全屏编辑"));
          await cleanup();
          assert.equal(document.body.style.overflow, "auto");
        },
      );
      await t.test(
        "content preview and publication toggles retain entered values",
        async () => {
          await mount();
          assert.equal(host.querySelectorAll("form").length, 1);
          assert.equal(host.querySelector('[role="dialog"]'), null);
          await change(field("title"), "Changed");
          await change(
            host.querySelector<HTMLTextAreaElement>("#challenge-description")!,
            "## Preview heading\n\n**content**",
          );
          await change(
            host.querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="提示 1"]',
            )!,
            "one\ntwo",
          );
          await click(button("添加提示"));
          await change(
            host.querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="提示 2"]',
            )!,
            "third",
          );
          await click(button("预览"));
          await settle(() => !!host.querySelector(".markdown h2"));
          assert.equal(
            host.querySelector(".markdown h2")!.textContent,
            "Preview heading",
          );
          await change(select("上线方式"), "enabled");
          await change(select("上线方式"), "disabled");
          await click(host.querySelector("#challenge-practice")!);
          await submit();
          assert.equal(saved.description, "## Preview heading\n\n**content**");
          assert.equal(saved.title, "Changed");
          assert.deepEqual(
            saved.hints.map((h: { content: string }) => h.content),
            ["one\ntwo", "third"],
          );
          assert.equal(
            new Set(saved.hints.map((h: { id: string }) => h.id)).size,
            2,
          );
          assert.equal(saved.practice, true);
          assert.equal(saved.published, false);
          assert.equal(saved.publish_at, null);
          assert.equal(saved.flag, undefined);
        },
      );
      await t.test(
        "environment and mode changes retain inputs while generators omit network controls",
        async () => {
          await mount();
          await tab("靶机配置");
          await click(
            [...host.querySelectorAll("label")]
              .find((e) => e.textContent === "启用靶机")!
              .querySelector('[role="switch"]')!,
          );
          await click(
            [...host.querySelectorAll("label")]
              .find((el) => el.textContent === "使用平台默认时长")!
              .querySelector('[role="switch"]')!,
          );
          for (const [name, value] of Object.entries({
            "container-image": "nebuctf/edited:local",
            "container-port": "9090",
            "container-cpu": "750",
            "container-memory": "512",
            "container-ttl": "2400",
          }))
            await change(field(name), value);
          await click(button("公共靶机"));
          await click(button("独立靶机"));
          await click(button("泛域名代理"));
          await tab("附件管理");
          await click(
            [...host.querySelectorAll("label")]
              .find((e) => e.textContent === "生成专属附件")!
              .querySelector('[role="switch"]')!,
          );
          await change(field("attachment-image"), "nebuctf/generator:1");
          await change(field("attachment-memory"), "128");
          await click(button("动态 Flag"));
          await submit();
          assert.equal(saved.resources.container.image, "nebuctf/edited:local");
          assert.equal(saved.resources.container.port, 9090);
          assert.equal(saved.resources.container.cpu, 750);
          assert.equal(saved.resources.container.memory, 512);
          assert.equal(saved.resources.container.ttl, 2400);
          assert.equal(saved.resources.attachment.image, "nebuctf/generator:1");
          assert.equal(saved.resources.attachment.memory, 128);
          assert.equal(saved.flag_mode, "dynamic");
          assert.equal(saved.flag_template, "");
          assert.equal(saved.flag, undefined);
          await tab("靶机配置");
          assert.equal(field("container-image").value, "nebuctf/edited:local");
          assert.equal(
            host.querySelector('input[name="attachment-port"]'),
            null,
          );
        },
      );
      await t.test(
        "resource sliders enforce keyboard bounds and preserve precise values on save",
        async () => {
          await mount(null);
          await change(field("title"), "Resource controls");
          await change(field("flag"), "flag{resource}");
          await tab("靶机配置");
          await click(
            [...host.querySelectorAll("label")]
              .find((el) => el.textContent === "启用靶机")!
              .querySelector('[role="switch"]')!,
          );
          await change(field("container-image"), "nebuctf/resources:1");
          const key = async (label: string, value: string) => {
            const slider = host.querySelector<HTMLElement>(
              `[role="slider"][aria-label="${label}"]`,
            )!;
            await act(async () => {
              slider.focus();
              slider.dispatchEvent(
                new dom.window.KeyboardEvent("keydown", {
                  key: value,
                  bubbles: true,
                }),
              );
            });
          };
          await key("CPU配额", "End");
          assert.equal(field("container-cpu").value, "4000");
          await key("CPU配额", "Home");
          assert.equal(field("container-cpu").value, "100");
          await key("内存配额", "End");
          assert.equal(field("container-memory").value, "4096");
          await key("内存配额", "Home");
          assert.equal(field("container-memory").value, "32");
          await change(field("container-cpu"), "775");
          await change(field("container-memory"), "321");
          await tab("发布设置");
          await submit();
          assert.equal(saved.resources.container.cpu, 775);
          assert.equal(saved.resources.container.memory, 321);
        },
      );
      await t.test(
        "multiple flags, ordering and fixed scoring remain complete when switching modes",
        async () => {
          await mount();
          await click(button("多个小题"));
          const titles = Array.from(
            host.querySelectorAll<HTMLInputElement>(
              'input[name^="part-"][name$="-title"]',
            ),
          );
          const flags = Array.from(
            host.querySelectorAll<HTMLInputElement>(
              'input[name^="part-"][name$="-flag"]',
            ),
          );
          await change(titles[0]!, "First");
          await change(titles[1]!, "Second");
          await change(flags[0]!, "flag{first}");
          await change(flags[1]!, "flag{second}");
          await change(
            field(titles[0]!.name.replace(/-title$/, "-description")),
            "First description",
          );
          await change(
            field(titles[1]!.name.replace(/-title$/, "-description")),
            "Second description",
          );
          await click(button("单 Flag"));
          await click(button("多个小题"));
          assert.equal(titles[0]!.value, "First");
          assert.equal(flags[0]!.value, "flag{first}");
          await click(button("下移小题"));
          await submit();
          assert.deepEqual(
            saved.parts.map((p: any) => p.title),
            ["Second", "First"],
          );
          assert.deepEqual(
            saved.parts.map((p: any) => p.flag),
            ["flag{second}", "flag{first}"],
          );
          assert.deepEqual(
            saved.parts.map((p: { description: string }) => p.description),
            ["Second description", "First description"],
          );
          await click(button("固定积分"));
          const point = host.querySelector<HTMLInputElement>(
            'input[name^="part-"][name$="-initial_points"]',
          )!;
          await change(point, "20");
          await submit();
          assert.equal(saved.dynamic_score, false);
          assert.equal(saved.parts[0].initial_points, 20);
          assert.ok(saved.parts[0].minimum_points <= 20);
          await click(button("动态 Flag"));
          await submit();
          assert.ok(saved.parts.every((p: any) => !Object.hasOwn(p, "flag")));
          await click(button("静态 Flag"));
          await submit();
          assert.equal(saved.parts[0].flag, "flag{second}");
        },
      );
      await t.test(
        "each part keeps its own score chart and environment binding when reordered",
        async () => {
          await mount({
            ...base,
            flag_mode: "dynamic",
            flag_template: "NebuCTF{[GUID]}",
            resources: {
              container: {
                image: "nebuctf/edited:local",
                cpu: 500,
                memory: 256,
                ttl: 600,
                mode: "private",
                topology: {
                  networks: [{ name: "default", internal: false }],
                  primary_networks: ["default"],
                  services: [
                    {
                      name: "vault",
                      image: "nebuctf/vault:local",
                      cpu: 100,
                      memory: 32,
                      networks: ["default"],
                      depends_on: [],
                      inject_flag: false,
                    },
                  ],
                },
                port: 8080,
                access_mode: "port",
              },
              attachment: null,
            },
            parts: [
              {
                id: "10000000-0000-4000-8000-000000000011",
                title: "Entry",
                description: "",
                initial_points: 300,
                minimum_points: 100,
                flag_env: "ENTRY_FLAG",
                flag_template: "Entry{[TEAM_HASH]}",
                role: "flag",
              },
              {
                id: "10000000-0000-4000-8000-000000000012",
                title: "Root",
                description: "",
                initial_points: 700,
                minimum_points: 200,
                flag_env: "ROOT_FLAG",
                role: "flag",
              },
            ],
          } as unknown as Challenge);
          await tab("Flag 与计分");
          await settle(
            () =>
              host.querySelectorAll('figure[aria-label="动态分数预览"]')
                .length === 2,
          );
          assert(!host.querySelector('[aria-label="预览小题计分"]'));
          const fieldset = (title: string) =>
            host
              .querySelector<HTMLInputElement>(`input[value="${title}"]`)!
              .closest("fieldset")!;
          assert.match(
            fieldset("Entry").querySelector("figcaption")!.textContent!,
            /初始 300 分/,
          );
          assert.match(
            fieldset("Root").querySelector("figcaption")!.textContent!,
            /初始 700 分/,
          );
          await change(
            fieldset("Entry").querySelector('input[name$="initial_points"]')!,
            "450",
          );
          assert.match(
            fieldset("Entry").querySelector("figcaption")!.textContent!,
            /初始 450 分/,
          );
          const templateInput = (scope: Element) =>
            scope.querySelector<HTMLInputElement>(
              'section[aria-label="Flag 模板配置"] input',
            )!;
          assert.equal(templateInput(host).value, "NebuCTF{[GUID]}");
          assert.equal(
            templateInput(fieldset("Entry")).value,
            "Entry{[TEAM_HASH]}",
          );
          const rootTemplate = fieldset("Root").querySelector(
            'section[aria-label="Flag 模板配置"]',
          )!;
          await click(rootTemplate.querySelector("button")!);
          await settle(() =>
            rootTemplate.textContent!.includes("NebuCTF{sample-uuid}"),
          );
          await change(templateInput(host), "Event{[GUID]}");
          assert(
            !rootTemplate.textContent!.includes("NebuCTF{sample-uuid}"),
            "inherited preview clears when parent changes",
          );
          await click(rootTemplate.querySelector("button")!);
          await change(templateInput(fieldset("Root")), "Root{[TEAM_HASH]}");
          await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
          });
          assert(
            !rootTemplate.textContent!.includes("Event{sample-uuid}"),
            "old in-flight preview cannot overwrite edited template",
          );
          await change(templateInput(fieldset("Entry")), "flag{short}");
          const entryTemplate = fieldset("Entry").querySelector(
            'section[aria-label="Flag 模板配置"]',
          )!;
          await click(entryTemplate.querySelector("button")!);
          await settle(() => !!entryTemplate.querySelector('[role="alert"]'));
          assert.equal(
            templateInput(fieldset("Entry")).getAttribute("aria-invalid"),
            "true",
          );
          await change(templateInput(fieldset("Entry")), "Entry{[TEAM_HASH]}");
          assert(!entryTemplate.querySelector('[role="alert"]'));
          await click(button("下移小题"));
          await tab("靶机配置");
          const variable = host.querySelector<HTMLInputElement>(
            '[aria-label="Entry环境变量"]',
          )!;
          assert.equal(variable.value, "ENTRY_FLAG");
          await change(variable, "WEB_FLAG");
          await click(host.querySelector('[aria-label="Entry注入 vault"]')!);
          await click(host.querySelector('[aria-label="Entry注入 主服务"]')!);
          await tab("Flag 与计分");
          assert.match(
            fieldset("Entry").querySelector("figcaption")!.textContent!,
            /初始 450 分/,
          );
          await submit();
          assert.deepEqual(
            saved.parts.find((p: any) => p.title === "Entry").flag_targets,
            ["vault"],
          );
          assert.equal(saved.parts[0].title, "Root");
          assert.equal(saved.parts[0].flag_env, "ROOT_FLAG");
          assert.equal(saved.parts[1].flag_env, "WEB_FLAG");
          assert.equal(saved.flag_template, "Event{[GUID]}");
          assert.equal(saved.parts[0].flag_template, "Root{[TEAM_HASH]}");
          assert.equal(saved.parts[1].flag_template, "Entry{[TEAM_HASH]}");
        },
      );
      await t.test(
        "question types show only relevant controls and AWDP keeps attack and defense roles",
        async () => {
          await mount(null);
          await change(field("title"), "Objective");
          await change(select("题目类型"), "objective");
          await tab("答案与计分");
          await change(
            host.querySelector('textarea[aria-label="选项 A"]')!,
            "First",
          );
          await change(
            host.querySelector('textarea[aria-label="选项 B"]')!,
            "Second",
          );
          await submit();
          assert.equal(saved.challenge_type, "objective");
          assert.equal(saved.dynamic_score, false);
          assert.deepEqual(saved.objective.correct_options, ["A"]);
          assert.equal(saved.patch_config, null);
          assert.equal(saved.flag_template, "");
          assert.equal(saved.resources.container, null);
          await change(select("题目类型"), "awdp");
          await tab("靶机配置");
          await change(field("container-image"), "nebuctf/awdp:1");
          await tab("防守校验");
          await change(
            host.querySelector('[data-config-tab="judging"] input')!,
            "nebuctf/checker:1",
          );
          await submit();
          assert.equal(saved.challenge_type, "awdp");
          assert.deepEqual(
            saved.parts.map((p: any) => p.role),
            ["attack", "defense"],
          );
          assert.equal(saved.flag_mode, "dynamic");
          assert.equal(saved.flag_template, "flag{[GUID]}");
          assert.equal(
            saved.parts.find((p: any) => p.role === "defense").flag_template,
            null,
          );
          assert.equal(saved.resources.container.mode, "private");
          assert.equal(saved.objective, null);
        },
      );
      await t.test(
        "defense controls enforce checker bounds and preserve independent patch and patrol settings",
        async () => {
          await mount(null);
          await change(field("title"), "Defense controls");
          await change(select("题目类型"), "awdp");
          await change(field("container-image"), "nebuctf/target:1");
          await change(field("patch-checker-image"), "nebuctf/checker:1");
          const key = async (label: string, value: string) => {
            const slider = host.querySelector<HTMLElement>(
              `[data-config-tab="judging"] [role="slider"][aria-label="${label}"]`,
            )!;
            await act(async () => {
              slider.focus();
              slider.dispatchEvent(
                new dom.window.KeyboardEvent("keydown", {
                  key: value,
                  bubbles: true,
                }),
              );
            });
          };
          await key("CPU配额", "End");
          assert.equal(field("patch-cpu").value, "2000");
          await key("内存配额", "End");
          assert.equal(field("patch-memory").value, "1024");
          await key("CPU配额", "Home");
          assert.equal(field("patch-cpu").value, "100");
          await key("内存配额", "Home");
          assert.equal(field("patch-memory").value, "64");
          await change(field("patch-cpu"), "2100");
          await tab("发布设置");
          await click(button("保存题目"));
          assert.equal(document.activeElement, field("patch-cpu"));
          await change(field("patch-cpu"), "775");
          await change(field("patch-memory"), "321");
          await change(field("patch-root"), "/srv/challenge");
          await change(field("patch-update_timeout"), "37");
          await change(field("patch-timeout"), "47");
          await submit();
          assert.deepEqual(saved.patch_config, {
            checker_image: "nebuctf/checker:1",
            patch_root: "/srv/challenge",
            update_timeout: 37,
            timeout: 47,
            cpu: 775,
            memory: 321,
          });
          await change(select("题目类型"), "awd");
          await change(field("awd-checker-image"), "nebuctf/patrol:1");
          await change(field("awd-timeout"), "23");
          await change(field("patch-cpu"), "825");
          await submit();
          assert.equal(saved.patch_config.cpu, 825);
          assert.equal(saved.patch_config.update_timeout, 37);
          assert.equal(saved.patch_config.timeout, 47);
          assert.equal(saved.patch_config.patch_root, "/srv/challenge");
          assert.deepEqual(saved.awd_config, {
            checker_image: "nebuctf/patrol:1",
            timeout: 23,
          });
        },
      );
      await t.test(
        "attachment actions stay in the editor, deletion requires confirmation, uploads keep the draft",
        async () => {
          await mount();
          await change(field("title"), "Unsaved title");
          assert.equal(
            host
              .querySelector('a[aria-label="下载 original.zip"]')!
              .getAttribute("href"),
            "/api/admin/attachments/file-1",
          );
          await click(button("删除 original.zip"));
          assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
          await click(button("取消"));
          assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
          await click(button("删除 original.zip"));
          await click(button("确认删除"));
          await settle(() => calls.some((c) => c.method === "DELETE"));
          assert.equal(
            calls.find((c) => c.method === "DELETE")!.path,
            "/admin/attachments/file-1",
          );
          const input =
            host.querySelector<HTMLInputElement>('input[type="file"]')!;
          Object.defineProperty(input, "files", {
            configurable: true,
            value: [new dom.window.File(["test"], "upload.txt")],
          });
          await act(async () =>
            input.dispatchEvent(
              new dom.window.Event("change", { bubbles: true }),
            ),
          );
          await settle(() =>
            calls.some(
              (c) => c.path.endsWith("/attachments") && c.method === "POST",
            ),
          );
          assert.ok(
            calls.find((c) => c.path.endsWith("/attachments"))!.body instanceof
              dom.window.FormData,
          );
          assert.equal(field("title").value, "Unsaved title");
        },
      );
      await t.test(
        "new single-flag challenges validate only active controls and serialize fixed points below the default minimum",
        async () => {
          await mount(null);
          assert.equal(button("上传附件").disabled, true);
          assert.match(host.textContent!, /保存题目后可上传附件/);
          await change(field("title"), "New");
          await change(field("flag"), "flag{new}");
          await click(button("固定积分"));
          await change(field("initial_points"), "25");
          await submit();
          assert.equal(saved.initial_points, 25);
          assert.equal(saved.minimum_points, 25);
          assert.equal(saved.decay, 20);
          assert.deepEqual(saved.parts, []);
        },
      );
    } finally {
      await cleanup();
      await new Promise((r) => setTimeout(r, 200));
      dom.window.close();
      for (const [key, value] of originals)
        if (value) Object.defineProperty(globalThis, key, value);
        else delete (globalThis as any)[key];
    }
  },
);
