import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import type { DB } from "../src/db.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "player",
  email: "player@example.test",
  role: "user",
};
const db: DB = {
  query: async (sql, params) => {
    if (sql.includes("FROM sessions") && params?.[0] === digest("test-session"))
      return [user] as any;
    if (sql.includes("INSERT INTO rate_limits")) return [{ hits: 1 }] as any;
    return [];
  },
  transaction: async (fn) => fn(db),
  close: async () => {},
};
test("HTTP security boundaries and input validation", async (t) => {
  const app = await buildApp(db);
  t.after(() => app.close());
  const headers = { origin: config.APP_ORIGIN, "x-csrf-protection": "1" };
  await t.test("cross-origin and missing-CSRF writes are denied", async () => {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { origin: "https://evil.example", "x-csrf-protection": "1" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { origin: config.APP_ORIGIN },
        })
      ).statusCode,
      403,
    );
  });
  await t.test(
    "anonymous resource access and administration require authentication",
    async () => {
      for (const url of [
        "/api/team",
        "/api/instances",
        "/api/admin/challenges",
        "/api/admin/articles",
      ])
        assert.equal((await app.inject({ url })).statusCode, 401);
    },
  );
  await t.test(
    "regular users cannot read administrator resources",
    async () => {
      for (const url of [
        "/api/admin/challenges",
        "/api/admin/resources",
        "/api/admin/audit",
        "/api/admin/learning/trees",
      ])
        assert.equal(
          (
            await app.inject({
              url,
              headers: { cookie: "nebu_session=test-session" },
            })
          ).statusCode,
          403,
        );
    },
  );
  await t.test(
    "invalid identifiers, excessive bodies and weak credentials fail before persistence",
    async () => {
      assert.equal(
        (await app.inject({ url: "/api/challenges/not-a-uuid" })).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/register",
            headers,
            payload: { username: "x", email: "invalid", password: "weak" },
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers,
            payload: { email: "a@example.test", password: "x".repeat(70000) },
          })
        ).statusCode,
        413,
      );
    },
  );
  await t.test(
    "session and response headers do not expose secrets",
    async () => {
      const res = await app.inject({
        url: "/api/me",
        headers: { cookie: "nebu_session=test-session" },
      });
      assert.deepEqual(res.json(), { user });
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.ok(!res.body.includes("password"));
    },
  );
  await t.test("invalid login gives a generic credential error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "absent@example.test", password: "invalid-password" },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "邮箱或密码错误");
  });
});
