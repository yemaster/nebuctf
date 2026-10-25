import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { solveProof } from "../src/lib/captcha-proof";

test("browser HashPow matches server SHA-256 without Web Crypto and bounds its work", () => {
  const salt = "42".repeat(32),
    nonce = solveProof(salt, 12);
  const result = createHash("sha256")
    .update(Buffer.from(salt, "hex"))
    .update(Buffer.from(nonce, "hex"))
    .digest();
  assert.equal(result[0], 0);
  assert.equal(result[1] >> 4, 0);
  assert.throws(() => solveProof(salt, 23), /参数/);
  assert.throws(() => solveProof(salt, 12, 0), /超时/);
});

test("auth preserves its shared panel and all four forms enforce recoverable verification", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  let reduced = false;
  dom.window.matchMedia = (() => ({
    matches: reduced,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: { nonce?: string; error?: string } }) => void;
    onerror?: () => void;
    terminated = false;
    payload?: { salt: string; difficulty: number; budget: number };
    constructor(
      readonly url: URL,
      readonly options: unknown,
    ) {
      workers.push(this);
    }
    postMessage(payload: typeof this.payload) {
      this.payload = payload;
    }
    terminate() {
      this.terminated = true;
    }
    complete() {
      this.onmessage?.({
        data: {
          nonce: solveProof(this.payload!.salt, this.payload!.difficulty),
        },
      });
    }
  }
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    HTMLInputElement: dom.window.HTMLInputElement,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    FormData: dom.window.FormData,
    Worker: FakeWorker,
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
      configurable: true,
      writable: true,
      value,
    });
  }
  originals.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { App } = await import("../src/App");
  const container = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot> | undefined;
  let cache: InstanceType<typeof QueryClient>;
  let user = false,
    lifetime = 300,
    failChallenge = false,
    issued = 0;
  const writes: { path: string; body: any }[] = [];
  async function mount(path: string) {
    writes.length = 0;
    workers.length = 0;
    failChallenge = false;
    lifetime = 300;
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { gcTime: Infinity },
      },
    });
    globalThis.fetch = async (input, options) => {
      const path = String(input).replace(/^\/api/, "");
      if (path === "/me")
        return Response.json({
          user: user ? { id: "player", username: "选手", role: "user" } : null,
        });
      if (path === "/teams/mine") return Response.json({ items: [] });
      if (path.startsWith("/contests"))
        return Response.json({ items: [], total: 0 });
      if (options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        writes.push({ path, body });
        if (path === "/captcha/challenge") {
          if (failChallenge) throw TypeError("Failed to fetch");
          return Response.json({
            token: `${body.purpose}-${++issued}`,
            salt: issued.toString(16).padStart(64, "0"),
            difficulty: 12,
            expires_in: lifetime,
            expires_at: new Date(Date.now() + lifetime * 1000).toISOString(),
          });
        }
        return Response.json(
          {
            error:
              path === "/auth/login"
                ? "邮箱或密码错误"
                : path === "/teams"
                  ? "战队名称已存在"
                  : "邀请码无效",
          },
          { status: 400 },
        );
      }
      throw Error(`Unexpected request: ${path}`);
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
    await settle(() => !!container.querySelector("form"));
  }
  async function settle(condition: () => boolean) {
    for (let i = 0; i < 150 && !condition(); i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    assert.ok(condition(), "interaction settled");
  }
  async function click(element: Element | null) {
    assert.ok(element);
    await act(async () =>
      element.dispatchEvent(
        new dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      ),
    );
  }
  async function submit(form: HTMLFormElement) {
    await act(async () =>
      form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  }
  const verification = (parent: Element = container) =>
    parent.querySelector(
      'button[aria-label="点击完成安全验证"],button[aria-label="重新验证"],button[aria-label="验证已过期，点击重试"]',
    );
  const submitButton = (form: Element) =>
    form.querySelector('button:not([type="button"])') as HTMLButtonElement;
  async function solve(parent: Element = container) {
    const count = workers.length;
    await click(verification(parent));
    await settle(() => workers.length > count);
    const worker = workers.at(-1)!;
    await act(async () => worker.complete());
    await settle(() => !!parent.querySelector('[aria-label="验证通过"]'));
    assert.equal(worker.terminated, true);
    return worker;
  }
  async function cleanup() {
    await act(async () => root?.unmount());
    root = undefined;
    cache.clear();
  }
  try {
    await t.test(
      "login cannot submit before proof and keeps fields when a failed attempt resets verification",
      async () => {
        await mount("/login?next=%2Fteam");
        const form = container.querySelector("form")!;
        const email = form.querySelector<HTMLInputElement>('[name="email"]')!;
        const password =
          form.querySelector<HTMLInputElement>('[name="password"]')!;
        email.value = "someone@example.test";
        password.value = "eight888";
        assert.equal(submitButton(form).disabled, true);
        await submit(form);
        assert.equal(writes.length, 0);
        await solve();
        assert.equal(submitButton(form).disabled, false);
        await submit(form);
        await settle(() => !!container.textContent?.includes("邮箱或密码错误"));
        assert.equal(submitButton(form).disabled, true);
        assert.equal(email.value, "someone@example.test");
        assert.equal(password.value, "eight888");
        const request = writes.find((w) => w.path === "/auth/login")!;
        assert.match(request.body.captcha.token, /^login-/);
        assert.match(request.body.captcha.nonce, /^[a-f0-9]{16}$/);
        await cleanup();
      },
    );
    await t.test(
      "login/register reuse the exact left panel and shell while cancelling the previous form's worker",
      async () => {
        await mount("/login?next=%2Fteam");
        const brand = container.querySelector("[data-auth-brand]")!;
        const shell = container.querySelector("main")!.firstElementChild;
        await click(verification());
        await settle(() => workers.length === 1);
        const old = workers[0];
        await click(
          container.querySelector(
            '[data-auth-panel] a[href="/register?next=%2Fteam"]',
          ),
        );
        await settle(
          () =>
            !!container.querySelector(
              '[data-auth-panel="register"] [name="username"]',
            ),
        );
        assert.equal(container.querySelector("[data-auth-brand]"), brand);
        assert.equal(container.querySelector("main")!.firstElementChild, shell);
        assert.equal(old.terminated, true);
        await act(async () => old.complete());
        assert.equal(container.querySelector('[aria-label="验证通过"]'), null);
        assert.equal(
          container.querySelector<HTMLInputElement>('[name="password"]')!
            .minLength,
          8,
        );
        await solve();
        await submit(container.querySelector("form")!);
        assert.ok(
          writes.some(
            (w) =>
              w.path === "/auth/register" &&
              w.body.captcha.token.startsWith("register-"),
          ),
        );
        await click(
          container.querySelector(
            '[data-auth-panel] a[href="/login?next=%2Fteam"]',
          ),
        );
        await settle(
          () => !!container.querySelector('[data-auth-panel="login"]'),
        );
        assert.equal(container.querySelector("[data-auth-brand]"), brand);
        await cleanup();
      },
    );
    await t.test(
      "create and join have separate proofs and reset only the attempted form",
      async () => {
        user = true;
        await mount("/team/new");
        const [create, join] = [...container.querySelectorAll("form")];
        create.querySelector<HTMLInputElement>('[name="name"]')!.value =
          "新战队";
        join.querySelector<HTMLInputElement>('[name="invite"]')!.value =
          "x".repeat(32);
        assert.equal(submitButton(create).disabled, true);
        assert.equal(submitButton(join).disabled, true);
        await solve(create);
        await solve(join);
        await submit(create);
        await settle(() => !!create.textContent?.includes("战队名称已存在"));
        assert.equal(submitButton(create).disabled, true);
        assert.equal(submitButton(join).disabled, false);
        await submit(join);
        await settle(() => !!join.textContent?.includes("邀请码无效"));
        assert.equal(submitButton(join).disabled, true);
        assert.equal(
          join.querySelector<HTMLInputElement>("input")!.value,
          "x".repeat(32),
        );
        assert.match(
          writes.find((w) => w.path === "/teams")!.body.captcha.token,
          /^team-create-/,
        );
        assert.match(
          writes.find((w) => w.path === "/team/join")!.body.captcha.token,
          /^team-join-/,
        );
        await cleanup();
        user = false;
      },
    );
    await t.test(
      "network failure, worker failure and expiration allow an in-place retry",
      async () => {
        await mount("/login");
        failChallenge = true;
        await click(verification());
        await settle(() => !!container.textContent?.includes("验证加载失败"));
        assert.equal(workers.length, 0);
        failChallenge = false;
        await click(verification());
        await settle(() => workers.length === 1);
        await act(async () => workers[0].onerror?.());
        assert.equal(workers[0].terminated, true);
        lifetime = 0.2;
        await solve();
        await settle(
          () =>
            !!container.querySelector('[aria-label="验证已过期，点击重试"]'),
        );
        assert.equal(
          submitButton(container.querySelector("form")!).disabled,
          true,
        );
        lifetime = 300;
        await solve();
        await cleanup();
      },
    );
    await t.test(
      "reduced-motion auth navigation also keeps the shared panel mounted",
      async () => {
        reduced = true;
        await mount("/register");
        const brand = container.querySelector("[data-auth-brand]");
        await click(
          container.querySelector('[data-auth-panel] a[href="/login"]'),
        );
        await settle(
          () => !!container.querySelector('[data-auth-panel="login"]'),
        );
        assert.equal(container.querySelector("[data-auth-brand]"), brand);
        await cleanup();
      },
    );
  } finally {
    if (root) await cleanup();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
