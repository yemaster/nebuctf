import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { samplePdf } from "./fixtures/pdf";

test(
  "poster editing and WriteUp settings, upload feedback and collection workflow",
  { timeout: 20000 },
  async (t) => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "http://localhost",
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
      scrollTo() {},
    });
    dom.window.HTMLElement.prototype.scrollTo = function () {};
    const xhrs: any[] = [];
    class XHR {
      upload: { onprogress?: (e: any) => void } = {};
      status = 200;
      responseText = '{"ok":true}';
      onload?: () => void;
      onabort?: () => void;
      headers: Record<string, string> = {};
      url = "";
      body: any;
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      send(body: any) {
        this.body = body;
        xhrs.push(this);
      }
      abort() {
        this.onabort?.();
      }
    }
    const original = new Map<string, PropertyDescriptor | undefined>();
    const { createCanvas, DOMMatrix, Path2D, ImageData } =
      await import("@napi-rs/canvas");
    const canvases = new WeakMap<
      HTMLCanvasElement,
      ReturnType<typeof createCanvas>
    >();
    dom.window.HTMLCanvasElement.prototype.getContext = function () {
      let canvas = canvases.get(this);
      if (!canvas) {
        canvas = createCanvas(this.width, this.height);
        canvases.set(this, canvas);
      }
      canvas.width = this.width;
      canvas.height = this.height;
      return canvas.getContext("2d");
    } as any;
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      HTMLFormElement: dom.window.HTMLFormElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      NodeFilter: dom.window.NodeFilter,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      MutationObserver: dom.window.MutationObserver,
      FormData: dom.window.FormData,
      File: dom.window.File,
      localStorage: dom.window.localStorage,
      XMLHttpRequest: XHR,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
      DOMMatrix,
      Path2D,
      ImageData,
      fetch: globalThis.fetch,
    })) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const { createRoot } = await import("react-dom/client"),
      { MemoryRouter, Route, Routes } = await import("react-router-dom"),
      { QueryClient, QueryClientProvider } =
        await import("@tanstack/react-query");
    const { ContestForm } =
        await import("../src/components/admin/contest-form"),
      { WriteupPage } = await import("../src/pages/Writeup"),
      { WriteupsAdmin, WriteupAdminDetail } =
        await import("../src/pages/admin/Writeups");
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    await import("../src/components/pdf-document");
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      createRequire(import.meta.url).resolve(
        "pdfjs-dist/legacy/build/pdf.worker.mjs",
      ),
    ).href;
    const id = "10000000-0000-4000-8000-000000000001",
      team = "20000000-0000-4000-8000-000000000001",
      host = document.getElementById("root")!;
    const config = {
      enabled: true,
      required: true,
      opens_at: null,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      max_size_mb: 20,
      formats: ["pdf", "zip"],
      allow_resubmit: true,
      note: "提交完整过程",
    };
    const contest: any = {
      id,
      title: "WriteUp Cup",
      description: "初始说明",
      poster_id: "poster",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      team_limit: 4,
      challenge_ids: [],
      groups: [],
      published: true,
    };
    const submission: any = {
      team_id: team,
      team_name: "Paper Team",
      name: "solution.pdf",
      size: 64,
      version: 1,
      format: "pdf",
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: "captain",
      review_note: "",
      reviewed_at: null,
      reviewed_by: null,
    };
    let own: any = {
        config,
        can_submit: true,
        team: { team_id: team, team_name: "Paper Team" },
        submission: null,
        window: "open",
        opens_at: new Date(Date.now() - 1000).toISOString(),
      },
      root: ReturnType<typeof createRoot> | undefined,
      cache: InstanceType<typeof QueryClient>,
      saved: any;
    const writes: { path: string; body: any; method: string }[] = [];
    let previewError = false,
      fileRequests = 0,
      historyTotal = 1,
      lastHistoryPage = "";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), "http://localhost"),
        path = url.pathname.replace(/^\/api/, "");
      if (path.endsWith(`/writeups/${team}`))
        lastHistoryPage = url.searchParams.get("page") ?? "1";
      if (path.endsWith(`/writeups/${team}/file`)) {
        fileRequests++;
        if (previewError)
          return Response.json(
            { error: "WriteUp 已更新，请刷新后查看当前版本" },
            { status: 409 },
          );
        return new Response(samplePdf(), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (init?.method && init.method !== "GET") {
        writes.push({
          path,
          body:
            init.body instanceof dom.window.FormData
              ? init.body
              : JSON.parse(String(init.body ?? "{}")),
          method: init.method,
        });
        return new Response(
          JSON.stringify({ ok: true, poster_id: "new-poster" }),
        );
      }
      const body = path.endsWith("/writeup")
        ? own
        : path.endsWith(`/writeups/${team}`)
          ? {
              ...submission,
              history_total: historyTotal,
              history: [
                {
                  id: "h",
                  version: 1,
                  action: "submitted",
                  name: "solution.pdf",
                  note: "",
                  username: "captain",
                  created_at: submission.submitted_at,
                },
              ],
            }
          : path.endsWith("/writeups")
            ? {
                items: [
                  submission,
                  {
                    team_id: "missing",
                    team_name: "Missing Team",
                    name: null,
                    status: null,
                    group_name: null,
                  },
                ],
                total: 2,
                counts: [
                  { status: "submitted", count: 1 },
                  { status: "missing", count: 1 },
                ],
                groups: [],
                contest: { writeup: config },
              }
            : { items: [], total: 0 };
      return new Response(JSON.stringify(body));
    };
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
      root = createRoot(host);
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
    async function click(el: Element | undefined | null, event = "click") {
      assert.ok(el);
      await act(async () => {
        el.dispatchEvent(
          new dom.window.MouseEvent(event, {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });
    }
    const button = (name: string) =>
      [...document.querySelectorAll("button")].find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
      );
    const tab = (name: string) =>
      click(
        [...host.querySelectorAll('[role="tab"]')].find(
          (b) => b.textContent === name,
        ),
        "mousedown",
      );
    async function change(
      el: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) {
      assert.ok(el);
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          el instanceof dom.window.HTMLTextAreaElement
            ? dom.window.HTMLTextAreaElement.prototype
            : dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(el, value);
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
    }
    async function choose(input: HTMLInputElement, file: File) {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      await act(async () => {
        input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
    }
    try {
      await t.test(
        "basic information owns the poster controls and replacing a poster keeps the unsaved form",
        async () => {
          await mount(
            <ContestForm
              contest={contest}
              pending={false}
              save={(v) => (saved = v)}
            />,
          );
          assert.ok(
            host.querySelector(
              'section[aria-label="比赛海报"] img[src*="poster?v=poster"]',
            ),
          );
          await change(host.querySelector('input[name="title"]')!, "保留草稿");
          await choose(
            host.querySelector('[aria-label="选择比赛海报"]')!,
            new dom.window.File(["image"], "cover.png", { type: "image/png" }),
          );
          await settle(() => writes.some((w) => w.path.endsWith("/poster")));
          assert.equal(
            (host.querySelector('input[name="title"]') as HTMLInputElement)
              .value,
            "保留草稿",
          );
          await click(button("移除海报"));
          await settle(() => !!document.querySelector('[role="dialog"]'));
          await click(
            [...document.querySelectorAll('[role="dialog"] button')].find(
              (b) => b.textContent === "移除海报",
            ),
          );
          await settle(() =>
            writes.some(
              (w) => w.method === "DELETE" && w.path.endsWith("/poster"),
            ),
          );
        },
      );
      await t.test(
        "WriteUp settings remain across tabs and missing deadlines focus their own panel",
        async () => {
          await mount(
            <ContestForm
              contest={contest}
              pending={false}
              save={(v) => (saved = v)}
            />,
          );
          saved = undefined;
          assert.deepEqual(
            [...host.querySelectorAll('[role="tab"]')]
              .slice(0, 2)
              .map((t) => t.textContent),
            ["基本信息", "WriteUp 提交"],
          );
          await tab("WriteUp 提交");
          await click(
            [...host.querySelectorAll("label")]
              .find((l) => l.textContent === "开放 WriteUp 提交")!
              .querySelector("button"),
          );
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved, undefined);
          assert.equal(
            document.activeElement?.getAttribute("aria-label"),
            "WriteUp 截止时间",
          );
          await change(
            host.querySelector('[aria-label="WriteUp 截止时间"]')!,
            "2029-10-24T12:00",
          );
          await click(
            [...host.querySelectorAll("label")]
              .find((l) => l.textContent === "要求战队提交")!
              .querySelector("button"),
          );
          await click(
            [...host.querySelectorAll("label")]
              .find((l) => l.textContent === "ZIP")!
              .querySelector("button"),
          );
          await change(
            host.querySelector('[aria-label="WriteUp 提交要求"]')!,
            "附上关键步骤",
          );
          await click(host.querySelector('[role="radio"][value="captain"]'));
          await tab("基本信息");
          await click(button("保存比赛"));
          assert.equal(saved.writeup.enabled, true);
          assert.equal(saved.writeup.required, true);
          assert.equal(saved.writeup.submitter, "captain");
          assert.deepEqual(saved.writeup.formats, ["pdf", "zip"]);
          assert.equal(saved.writeup.note, "附上关键步骤");
        },
      );
      await t.test(
        "participant upload measures progress, uses the captured version and removes progress after success",
        async () => {
          await mount(
            <Routes>
              <Route path="/contests/:id/writeup" element={<WriteupPage />} />
            </Routes>,
            `/contests/${id}/writeup`,
          );
          await settle(
            () => !!host.querySelector('[aria-label="选择 WriteUp 文件"]'),
          );
          await choose(
            host.querySelector('[aria-label="选择 WriteUp 文件"]')!,
            new dom.window.File(["%PDF-1.7\n%%EOF"], "solution.pdf", {
              type: "application/pdf",
            }),
          );
          await click(button("提交 WriteUp"));
          await settle(() => xhrs.length > 0);
          const xhr = xhrs.at(-1);
          assert.ok(xhr.url.endsWith("?version=0"));
          assert.equal(xhr.headers["x-csrf-protection"], "1");
          await act(async () =>
            xhr.upload.onprogress({
              lengthComputable: true,
              loaded: 50,
              total: 100,
            }),
          );
          assert.equal(
            host
              .querySelector('[role="progressbar"]')
              ?.getAttribute("aria-valuenow"),
            "50",
          );
          own = { ...own, submission };
          await act(async () => xhr.onload());
          await settle(() => host.textContent!.includes("版本 1"));
          assert.equal(host.querySelector('[role="progressbar"]'), null);
          assert.ok(button("下载 WriteUp"));
          own = {
            ...own,
            config: {
              ...config,
              deadline: new Date(Date.now() - 1000).toISOString(),
            },
            window: "closed",
          };
          await act(async () => {
            await cache.invalidateQueries();
          });
          await settle(() => host.textContent!.includes("提交已截止"));
          assert.equal(
            host.querySelector('[aria-label="选择 WriteUp 文件"]'),
            null,
          );
          assert.ok(button("下载 WriteUp"));
        },
      );
      await t.test(
        "members can read the team report under a captain-only policy and permissions refresh in place",
        async () => {
          own = {
            ...own,
            config: { ...config, submitter: "captain" },
            submission,
            can_submit: false,
            window: "open",
          };
          await mount(
            <Routes>
              <Route path="/contests/:id/writeup" element={<WriteupPage />} />
            </Routes>,
            `/contests/${id}/writeup`,
          );
          await settle(() =>
            host.textContent!.includes("仅队长可提交，请联系队长"),
          );
          assert.ok(button("下载 WriteUp"));
          assert.equal(
            host.querySelector('[aria-label="选择 WriteUp 文件"]'),
            null,
          );
          own = { ...own, can_submit: true };
          await act(async () => {
            await cache.invalidateQueries();
          });
          await settle(
            () => !!host.querySelector('[aria-label="选择 WriteUp 文件"]'),
          );
          assert.match(host.textContent!, /每队一份/);
        },
      );
      await t.test(
        "collection keeps the list next to a real paged PDF, selected export and review controls",
        async () => {
          await mount(
            <Routes>
              <Route
                path="/contests/:id/manage/writeups"
                element={<WriteupsAdmin />}
              />
              <Route
                path="/contests/:id/manage/writeups/:team"
                element={<WriteupAdminDetail />}
              />
            </Routes>,
            `/contests/${id}/manage/writeups`,
          );
          await settle(() => host.textContent!.includes("Missing Team"));
          assert.equal(
            host.querySelectorAll('aside[aria-label="WriteUp 战队列表"] li')
              .length,
            2,
          );
          assert.ok(
            (
              host.querySelector(
                '[aria-label="选择 Missing Team 的 WriteUp"]',
              ) as HTMLButtonElement
            ).disabled,
          );
          await click(
            host.querySelector('[aria-label="选择 Paper Team 的 WriteUp"]'),
          );
          assert.ok(button("导出所选（1）"));
          await click(button("查看 Paper Team 的 WriteUp"));
          await settle(
            () => !!host.querySelector('[aria-label="WriteUp 处理意见"]'),
          );
          assert.equal(document.querySelector('[role="dialog"]'), null);
          await settle(
            () =>
              host.querySelector<HTMLCanvasElement>("canvas")?.style
                .visibility === "",
          );
          const firstCanvas = host.querySelector<HTMLCanvasElement>("canvas")!;
          assert.deepEqual(
            Array.from(
              canvases
                .get(firstCanvas)!
                .getContext("2d")
                .getImageData(30, firstCanvas.height - 30, 1, 1).data,
            ).slice(0, 3),
            [255, 0, 0],
          );
          await settle(() => !button("PDF 下一页")!.disabled);
          assert.ok(
            host
              .querySelector("[data-pdf-preview]")!
              .getAttribute("data-pdf-preview")!
              .endsWith("?version=1"),
          );
          await click(button("PDF 下一页"));
          await settle(
            () =>
              host
                .querySelector('[aria-label="PDF 页码"]')!
                .getAttribute("value") === "2",
          );
          await settle(() => {
            const canvas = host.querySelector<HTMLCanvasElement>("canvas");
            return (
              !!canvas &&
              canvas.style.visibility === "" &&
              canvases
                .get(canvas)
                ?.getContext("2d")
                .getImageData(30, canvas.height - 30, 1, 1).data[2] === 255
            );
          });
          historyTotal = 11;
          await act(async () => {
            await cache.invalidateQueries();
          });
          await settle(() => !!button("提交与处理记录（11）"));
          await click(button("提交与处理记录（11）"));
          const previousRequests = fileRequests;
          await click(button("下一页"));
          await settle(() => lastHistoryPage === "2");
          assert.equal(
            fileRequests,
            previousRequests,
            "paging review history does not reload the PDF",
          );
          historyTotal = 1;
          assert.ok(button("退回修改")?.disabled);
          await change(
            host.querySelector('[aria-label="WriteUp 处理意见"]')!,
            "请补充复现步骤",
          );
          await click(button("查看 Missing Team 的 WriteUp"));
          await settle(() =>
            host.textContent!.includes("Missing Team 尚未提交"),
          );
          assert.equal(host.querySelector("canvas"), null);
          await click(button("查看 Paper Team 的 WriteUp"));
          await settle(
            () =>
              (
                host.querySelector(
                  '[aria-label="WriteUp 处理意见"]',
                ) as HTMLTextAreaElement
              )?.value === "请补充复现步骤",
          );
          assert.ok(button("导出所选（1）"));
          await click(button("退回修改"));
          await settle(() =>
            writes.some((w) => w.body.status === "changes_requested"),
          );
          assert.equal(writes.at(-1)!.body.version, 1);
        },
      );
      await t.test(
        "preview errors can be retried without losing the team list",
        async () => {
          previewError = true;
          await mount(
            <Routes>
              <Route
                path="/contests/:id/manage/writeups"
                element={<WriteupsAdmin />}
              />
            </Routes>,
            `/contests/${id}/manage/writeups`,
          );
          await settle(() =>
            host.textContent!.includes("WriteUp 已更新，请刷新后查看当前版本"),
          );
          assert.ok(button("查看 Missing Team 的 WriteUp"));
          assert.ok(button("下载 WriteUp"));
          previewError = false;
          await click(button("重新加载"));
          await settle(
            () =>
              host.querySelector<HTMLCanvasElement>("canvas")?.style
                .visibility === "",
          );
        },
      );
      await t.test(
        "legacy review links retain filters and ZIP submissions never load the PDF renderer",
        async () => {
          await cleanup();
          const before = fileRequests;
          submission.format = "zip";
          submission.name = "solution.zip";
          submission.version = 2;
          try {
            await mount(
              <Routes>
                <Route
                  path="/contests/:id/manage/writeups"
                  element={<WriteupsAdmin />}
                />
                <Route
                  path="/contests/:id/manage/writeups/:team"
                  element={<WriteupAdminDetail />}
                />
              </Routes>,
              `/contests/${id}/manage/writeups/${team}?q=Paper&status=submitted`,
            );
            await settle(() =>
              host.textContent!.includes("ZIP 文件请下载查看"),
            );
            assert.equal(
              (
                host.querySelector(
                  '[aria-label="搜索 WriteUp 战队"]',
                ) as HTMLInputElement
              ).value,
              "Paper",
            );
            assert.equal(
              (
                host.querySelector(
                  '[aria-label="WriteUp 状态"]',
                ) as HTMLSelectElement
              ).value,
              "submitted",
            );
            assert.ok(button("查看 Missing Team 的 WriteUp"));
            assert.equal(fileRequests, before);
            assert.equal(host.querySelector("canvas"), null);
          } finally {
            await cleanup();
            submission.format = "pdf";
            submission.name = "solution.pdf";
            submission.version = 1;
          }
        },
      );
    } finally {
      await cleanup();
      await new Promise((r) => setTimeout(r, 100));
      dom.window.close();
      for (const [k, v] of original)
        if (v) Object.defineProperty(globalThis, k, v);
        else delete (globalThis as any)[k];
    }
  },
);
