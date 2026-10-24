import { test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../src/lib/api";

test("API errors retain HTTP status for permission and missing-content pages", async (t) => {
  for (const status of [401, 403, 404, 429, 503]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: "访问失败",
            ...(status === 429 ? { retry_after: 45 } : {}),
          }),
          { status },
        ),
    );
    await assert.rejects(
      api("/test"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        error.message === "访问失败" &&
        error.retryAfter === (status === 429 ? 45 : undefined),
    );
    t.mock.restoreAll();
  }
});

test("non-JSON proxy errors produce a recoverable API error instead of a JSON syntax error", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  await assert.rejects(
    api("/test"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      !error.message.includes("html"),
  );
});

test("malformed successful responses are classified as an upstream error", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("not JSON", { status: 200 }),
  );
  await assert.rejects(
    api("/test"),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

test("successful API calls preserve the payload and write-request CSRF header", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(url, "/api/test");
      assert.equal(options.credentials, "same-origin");
      assert.equal(new Headers(options.headers).get("x-csrf-protection"), "1");
      assert.equal(options.body, JSON.stringify({ flag: "flag{test}" }));
      return Response.json({ correct: true });
    },
  );
  assert.deepEqual(await api("/test", "POST", { flag: "flag{test}" }), {
    correct: true,
  });
});

test("actionable API errors retain safe local navigation and reject external actions", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "环境数量已达上限",
        action: { label: "管理靶机", href: "/instances?scope=practice" },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    api("/test"),
    (e: unknown) =>
      e instanceof ApiError && e.action?.href === "/instances?scope=practice",
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "失败", action: { label: "前往", href: "//outside.example" } },
      { status: 403 },
    ),
  );
  await assert.rejects(
    api("/test"),
    (e: unknown) => e instanceof ApiError && e.action === undefined,
  );
});

test("resource quota links keep the selected contest context", async (t) => {
  const scope = "20000000-0000-4000-8000-000000000001";
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "环境额度已满",
        action: { label: "管理靶机", href: `/instances?scope=${scope}` },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    api("/test"),
    (e: unknown) =>
      e instanceof ApiError &&
      e.action?.href === `/contests/${scope}/instances`,
  );
});
