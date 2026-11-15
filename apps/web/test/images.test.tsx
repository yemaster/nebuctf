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
      File: dom.window.File,
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
    const { ImageImportActions } =
      await import("../src/components/admin/image-import-actions");
    let jobKind = "pull";
    let releaseChunk: (() => void) | undefined;
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
        const body =
          init.body instanceof FormData
            ? init.body
            : JSON.parse(String(init.body));
        writes.push({ path, body });
        if (path === "/admin/images/uploads")
          return Response.json({ id: "upload-1", chunk_size: 2 });
        if (path.startsWith("/admin/images/uploads/upload-1?")) {
          if (path.endsWith("offset=0"))
            await new Promise<void>((resolve) => {
              releaseChunk = resolve;
            });
          return Response.json({ received: path.endsWith("offset=0") ? 2 : 3 });
        }
        if (path === "/admin/images/uploads/upload-1/complete") {
          jobKind = "load";
          jobStatus = "pulling";
          jobId = "load-1";
          return Response.json({ id: jobId });
        }
        if (path === "/admin/images/pull") {
          jobKind = "pull";
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
          image: "docker.io/nebuctf/demo:local",
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
          kind: jobKind,
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
        const item = {
          image: "nebuctf/demo:local",
          present,
          size: 2048,
          challenges: [{ id: cid, title: "示例题目" }],
          job_id: jobId,
          job_status: jobStatus,
        };
        return Response.json({
          items: [],
          groups:
            q.get("page") === "2" || q.get("usage") === "unused"
              ? []
              : [
                  {
                    id: cid,
                    title: "示例题目",
                    items: [item, { ...item, image: "nebuctf/checker:local" }],
                  },
                ],
          group_total: 13,
          total: q.get("usage") === "unused" ? 0 : 25,
          counts: { used: 25, unused: 0 },
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
          >
            {(status, actions) => (
              <div className="flex flex-wrap items-center gap-2">
                {status}
                {actions}
              </div>
            )}
          </ImageTools>
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
        "normalized image references retain pull actions, layer progress and logs",
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
        "standalone pull input and upload keep one progress dialog through closure and import",
        async () => {
          await mount(<ImageImportActions disabled={false} />);
          await click(button("拉取镜像"));
          const input =
            document.querySelector<HTMLInputElement>("#image-reference")!;
          assert.ok(input);
          await click(button("取消"));
          await click(button("上传镜像"));
          const picker =
            document.querySelector<HTMLInputElement>("#image-archive")!;
          Object.defineProperty(picker, "files", {
            configurable: true,
            value: [new File(["tar"], "image.tar")],
          });
          await act(async () => {
            picker.dispatchEvent(
              new dom.window.Event("change", { bubbles: true }),
            );
          });
          await act(async () => {
            document
              .querySelector("form")!
              .dispatchEvent(
                new dom.window.Event("submit", {
                  bubbles: true,
                  cancelable: true,
                }),
              );
          });
          await settle(() => !!releaseChunk);
          assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
          assert.ok(document.querySelector('[aria-label="镜像上传进度"]'));
          assert.match(
            document.querySelector('[role="dialog"]')!.textContent!,
            /正在上传/,
          );
          await click(button("关闭"));
          assert.equal(document.querySelector('[role="dialog"]'), null);
          await click(button("任务进度"));
          assert.ok(document.querySelector('[aria-label="镜像上传进度"]'));
          await act(async () => releaseChunk!());
          await settle(
            () =>
              !!document
                .querySelector('[role="dialog"]')
                ?.textContent?.includes("正在导入"),
          );
          assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
          assert.equal(
            writes.filter((w) =>
              w.path.startsWith("/admin/images/uploads/upload-1?"),
            ).length,
            2,
          );
          assert.ok(
            document
              .querySelector('[data-slot="scroll-area"]')
              ?.classList.contains("h-64"),
          );
          jobStatus = "succeeded";
          await refresh();
          await click(button("完成"));
          assert.equal(document.querySelector('[role="dialog"]'), null);
          jobKind = "pull";
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
          assert.doesNotMatch(
            container.querySelector("thead")!.textContent!,
            /关联题目/,
          );
          assert.equal(container.querySelectorAll("section h2").length, 1);
          assert.equal(
            container.querySelector("section h2")!.textContent,
            "示例题目",
          );
          assert.match(
            container.querySelector("tbody")!.textContent!,
            /nebuctf\/demo:local/,
          );
          assert.match(
            container.querySelector("tbody")!.textContent!,
            /nebuctf\/checker:local/,
          );
          assert.equal(
            container.querySelector('[role="tab"][aria-selected="true"]')!
              .textContent,
            "题目使用中25",
          );
          assert(reads.some((p) => p.includes("group_by=challenge")));
          await click(button("下一页"));
          await settle(() =>
            reads.some(
              (p) => p.startsWith("/admin/images?") && p.includes("page=2"),
            ),
          );
          await settle(
            () => container.querySelectorAll("tbody tr").length === 0,
          );
          const unusedTab = [
            ...container.querySelectorAll('[role="tab"]'),
          ].find((t) => t.textContent?.startsWith("未应用"))!;
          await act(async () => {
            unusedTab.dispatchEvent(
              new dom.window.MouseEvent("mousedown", {
                bubbles: true,
                button: 0,
              }),
            );
          });
          await settle(() =>
            reads.some(
              (p) => p.includes("usage=unused") && p.includes("page=1"),
            ),
          );
          assert.match(container.textContent!, /暂无未应用的镜像/);
          assert.doesNotMatch(
            container.querySelector("thead")!.textContent!,
            /关联题目/,
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
