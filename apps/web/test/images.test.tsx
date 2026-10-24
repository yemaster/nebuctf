import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act, useRef, useState } from "react";
import { JSDOM } from "jsdom";

test(
  "admin image controls, pull progress dialog and preview lifecycle",
  { timeout: 30000 },
  async (t) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    Object.assign(dom.window, {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      FormData: dom.window.FormData,
      MutationObserver: dom.window.MutationObserver,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    originals.set(
      "fetch",
      Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    );
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query");
    const { ImageTools } = await import("../src/components/admin/image-tools"),
      { ImagesAdmin } = await import("../src/pages/admin/Images");
    const cid = "10000000-0000-4000-8000-000000000001";
    let present = false,
      jobStatus = "queued",
      jobId: string | undefined,
      instance: any = null,
      next: string | null = null,
      previewError = false;
    const writes: { path: string; body: any }[] = [],
      reads: string[] = [];
    globalThis.fetch = async (input, init) => {
      const path = String(input).replace(/^\/api/, "");
      if (init?.method && init.method !== "GET") {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });
        if (path === "/admin/images/pull") {
          jobId = "pull-1";
          jobStatus = "pulling";
          return Response.json({ id: jobId, status: jobStatus });
        }
        if (path.endsWith("/test-instance")) {
          if (previewError)
            return Response.json(
              {
                error: "测试环境资源额度不足",
                action: { label: "管理资源", href: "/admin/resources" },
              },
              { status: 409 },
            );
          instance = {
            id: "preview",
            status: "queued",
            kind: "dynamic_container",
            expires_at: new Date(Date.now() + 600000).toISOString(),
          };
          return Response.json({ id: instance.id, status: instance.status });
        }
        if (path === "/instances/preview/stop") {
          instance = { ...instance, status: "stopping" };
          return Response.json({ ok: true });
        }
      }
      reads.push(path);
      if (path.startsWith("/admin/images/status?"))
        return Response.json({
          image: "nebuctf/demo:local",
          present,
          challenges: [],
          worker: { online: true },
          job_id: jobId,
          job_status: jobStatus,
        });
      if (path.startsWith("/admin/images/pulls/"))
        return Response.json({
          id: jobId,
          reference: "nebuctf/demo:local",
          status: jobStatus,
          layers: [
            { id: "layer1", status: "Downloading", current: 50, total: 100 },
          ],
          logs: [
            { time: "2026-10-23T00:00:00Z", message: "layer1: Downloading" },
          ],
          error: jobStatus === "failed" ? "manifest unknown" : null,
        });
      if (path.endsWith("/test-instance"))
        return Response.json({ instance, next_operation_at: next });
      if (path.startsWith("/admin/images?")) {
        const q = new URLSearchParams(path.split("?")[1]);
        return Response.json({
          items:
            q.get("page") === "2"
              ? []
              : [
                  {
                    image: "nebuctf/demo:local",
                    present,
                    size: 2048,
                    challenges: [{ id: cid, title: "示例题目" }],
                    job_id: jobId,
                    job_status: jobStatus,
                  },
                ],
          total: 25,
          worker: { online: true, checked_at: new Date().toISOString() },
        });
      }
      throw Error(`Unexpected request ${path}`);
    };
    const container = document.getElementById("root")!;
    let root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>;
    function Editor({ saved = true }: { saved?: boolean }) {
      const ref = useRef<HTMLFormElement>(null),
        [kind, setKind] = useState("dynamic_container");
      return (
        <form ref={ref}>
          <input name="access_mode" defaultValue="domain" />
          <input name="port" defaultValue="9090" />
          <input name="cpu" defaultValue="600" />
          <input name="memory" defaultValue="128" />
          <button type="button" onClick={() => setKind("dynamic_attachment")}>
            切换类型
          </button>
          <ImageTools
            image="nebuctf/demo:local"
            challengeId={saved ? cid : undefined}
            kind={kind}
            savedKind="dynamic_container"
            formRef={ref}
          />
        </form>
      );
    }
    async function cleanup() {
      if (root) await act(async () => root!.unmount());
      root = undefined;
      cache?.clear();
    }
    async function mount(node: React.ReactNode, path = "/") {
      await cleanup();
      cache = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { gcTime: Infinity },
        },
      });
      root = createRoot(container);
      await act(async () =>
        root!.render(
          <QueryClientProvider client={cache}>
            <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
          </QueryClientProvider>,
        ),
      );
    }
    async function settle(fn: () => boolean) {
      for (let i = 0; i < 100 && !fn(); i++)
        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
      assert.ok(fn(), "settled");
    }
    const button = (text: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text,
      );
    async function click(el: Element | undefined) {
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
    async function refresh() {
      await act(async () => {
        await cache.invalidateQueries();
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    try {
      await t.test(
        "missing images pull in a shadcn dialog with real layer progress and can reopen logs",
        async () => {
          jobStatus = "";
          await mount(<Editor />);
          await settle(() => !!button("拉取镜像"));
          assert.equal(button("启动测试靶机"), undefined);
          await click(button("拉取镜像"));
          await settle(
            () => !!document.querySelector('[aria-label="镜像拉取日志"]'),
          );
          assert.ok(document.querySelector('[role="dialog"]'));
          assert.equal(
            document
              .querySelector('[aria-label="layer1 拉取进度"]')
              ?.getAttribute("aria-valuenow"),
            "50",
          );
          assert.match(
            document.querySelector('[aria-label="镜像拉取日志"]')!.textContent!,
            /layer1: Downloading/,
          );
          assert.equal(document.querySelectorAll("form form").length, 0);
          await click(button("关闭"));
          await settle(() => !document.querySelector('[role="dialog"]'));
          await click(button("查看拉取进度"));
          await settle(
            () => !!document.querySelector('[aria-label="镜像拉取日志"]'),
          );
          jobStatus = "failed";
          await refresh();
          assert.match(
            document.querySelector('[role="dialog"]')!.textContent!,
            /manifest unknown/,
          );
          await click(button("关闭"));
          await settle(() => !!button("拉取镜像"));
          await click(button("拉取镜像"));
          await settle(() => !!document.querySelector('[role="dialog"]'));
          present = true;
          jobStatus = "succeeded";
          await refresh();
          await click(button("完成"));
          await settle(() => !!button("启动测试靶机"));
          assert.equal(button("拉取镜像"), undefined);
          assert.equal(
            writes.filter((w) => w.path === "/admin/images/pull").length,
            2,
          );
        },
      );
      await t.test(
        "preview uses current form values, guides quota errors, displays endpoint icons and honors cooldown",
        async () => {
          present = true;
          jobStatus = "succeeded";
          instance = null;
          await mount(<Editor />);
          await settle(() => !!button("启动测试靶机"));
          previewError = true;
          await click(button("启动测试靶机"));
          await settle(() =>
            container.textContent!.includes("测试环境资源额度不足"),
          );
          assert.ok(container.querySelector('a[href="/admin/resources"]'));
          previewError = false;
          await click(button("启动测试靶机"));
          await settle(() => !!button("停止测试环境"));
          assert.deepEqual(
            writes.find((w) => w.path.endsWith("/test-instance"))!.body,
            {
              image: "nebuctf/demo:local",
              port: 9090,
              cpu: 600,
              memory: 128,
              access_mode: "domain",
            },
          );
          instance = {
            ...instance,
            status: "running",
            endpoint: "http://preview.labs.localhost",
          };
          next = new Date(Date.now() + 59000).toISOString();
          await refresh();
          assert.equal(
            container
              .querySelector('a[aria-label="打开测试靶机"]')
              ?.getAttribute("target"),
            "_blank",
          );
          assert.ok(button("复制测试靶机地址"));
          assert.equal(button("停止测试环境"), undefined);
          assert.ok(
            Array.from(container.querySelectorAll("button")).some(
              (b) => b.disabled && b.textContent!.includes("秒后可操作"),
            ),
          );
          next = null;
          await refresh();
          await click(button("切换类型"));
          assert.equal(button("停止测试环境")!.disabled, false);
          await click(button("停止测试环境"));
          await settle(() =>
            writes.some((w) => w.path === "/instances/preview/stop"),
          );
          instance = {
            ...instance,
            status: "failed",
            error: "Docker API returned 500",
          };
          await refresh();
          assert.match(container.textContent!, /Docker API returned 500/);
          assert.equal(button("测试生成附件")!.disabled, true);
        },
      );
      await t.test(
        "new challenges require saving before preview and image list supports paging and association counts",
        async () => {
          instance = null;
          present = true;
          jobStatus = "succeeded";
          await mount(<Editor saved={false} />);
          await settle(() => !!button("启动测试靶机"));
          assert.equal(button("启动测试靶机")!.disabled, true);
          assert.match(container.textContent!, /保存题目后可测试/);
          await mount(<ImagesAdmin />, "/admin/images");
          await settle(() => !!container.querySelector("tbody tr"));
          assert.match(container.textContent!, /2.0 KiB/);
          assert.match(
            container.querySelector("thead")!.textContent!,
            /关联题目数/,
          );
          assert.equal(
            container.querySelectorAll("tbody tr td")[3]!.textContent,
            "1",
          );
          assert.doesNotMatch(
            container.querySelector("tbody")!.textContent!,
            /示例题目/,
          );
          await click(button("下一页"));
          await settle(() =>
            reads.some(
              (p) => p.startsWith("/admin/images?") && p.includes("page=2"),
            ),
          );
          await settle(
            () => container.querySelectorAll("tbody tr").length === 0,
          );
        },
      );
    } finally {
      await cleanup();
      await new Promise((resolve) => setTimeout(resolve, 100));
      dom.window.close();
      for (const [key, value] of originals)
        if (value) Object.defineProperty(globalThis, key, value);
        else delete (globalThis as any)[key];
    }
  },
);
