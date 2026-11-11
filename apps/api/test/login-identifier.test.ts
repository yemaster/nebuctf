import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { credentials, register } from "../src/schemas.js";
import { digest, hashPassword } from "../src/security.js";
import { proofFor, verified } from "./helpers/captcha.js";

test("login identifiers remain separate from registration email validation", () => {
  assert.deepEqual(
    credentials.parse({ identifier: " Player_One ", password: " pass " }),
    {
      identifier: "Player_One",
      password: " pass ",
    },
  );
  for (const body of [
    { identifier: " " },
    { identifier: "x".repeat(255) },
    { identifier: { username: "player" } },
    { identifier: "player", email: "player@example.test" },
    { email: "player" },
    {},
  ])
    assert.equal(
      credentials.safeParse({ ...body, password: "eight888" }).success,
      false,
    );
  assert.equal(
    register.safeParse({
      username: "player",
      email: "player",
      password: "eight888",
    }).success,
    false,
  );
});

test("username and email logins share identity, proof checks and account limits", async (t) => {
  if (process.env.TEST_POSTGRES === "1" && !config.DATABASE_URL)
    throw Error("TEST_POSTGRES requires an isolated empty DATABASE_URL");
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const password = "  correct-password-88  ",
    hash = await hashPassword(password);
  const users = [
    {
      id: crypto.randomUUID(),
      username: "Player_One",
      email: "player.one@example.test",
      disabled: false,
    },
    {
      id: crypto.randomUUID(),
      username: "选手甲",
      email: "chinese@example.test",
      disabled: false,
    },
    {
      id: crypto.randomUUID(),
      username: "Disabled",
      email: "disabled@example.test",
      disabled: true,
    },
    {
      id: crypto.randomUUID(),
      username: "Limited",
      email: "limited@example.test",
      disabled: false,
    },
  ];
  for (const user of users)
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,disabled) VALUES($1,$2,$3,$4,$5)",
      [user.id, user.username, user.email, hash, user.disabled],
    );
  const headers = { origin: config.APP_ORIGIN, "x-csrf-protection": "1" };
  let request = 0;
  const login = (body: Record<string, unknown>) =>
    verified(app, {
      method: "POST",
      url: "/api/auth/login",
      headers,
      remoteAddress: `192.0.2.${++request}`,
      payload: { password, ...body },
    });
  const sessionCount = async () =>
    (await db.query("SELECT count(*)::int n FROM sessions"))[0]!.n;

  await t.test(
    "both identifiers support casing and whitespace without changing password bytes",
    async () => {
      for (const body of [
        { identifier: "Player_One" },
        { identifier: " PLAYER_ONE " },
        { identifier: " PLAYER.ONE@EXAMPLE.TEST " },
        { email: " Player.One@Example.Test " },
      ]) {
        const response = await login(body);
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().user.id, users[0]!.id);
        assert.equal(response.json().user.password_hash, undefined);
        assert.equal(response.cookies[0]!.httpOnly, true);
        const me = await app.inject({
          url: "/api/me",
          headers: {
            cookie: `${response.cookies[0]!.name}=${response.cookies[0]!.value}`,
          },
        });
        assert.equal(me.json().user.id, users[0]!.id);
      }
      const chinese = await login({ identifier: "选手甲" });
      assert.equal(chinese.statusCode, 200, chinese.body);
      assert.equal(chinese.json().user.id, users[1]!.id);
      assert.equal(
        (await login({ identifier: "Player_One", password: password.trim() }))
          .statusCode,
        401,
      );
    },
  );

  await t.test(
    "absent, disabled and incorrect identities return the same error without a session",
    async () => {
      const before = await sessionCount();
      for (const body of [
        { identifier: "missing-user" },
        { identifier: "missing@example.test" },
        { identifier: "Player_One", password: "incorrect-password" },
        { identifier: "Disabled" },
        { identifier: "disabled@example.test" },
        { identifier: "' OR 1=1 --" },
      ]) {
        const response = await login(body);
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.json().error, "账号或密码错误");
        assert.equal(response.cookies.length, 0);
      }
      assert.equal(await sessionCount(), before);
    },
  );

  await t.test(
    "switching identifiers or IPs cannot reset the account attempt limit",
    async () => {
      const before = await sessionCount();
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await login({
          identifier: attempt % 2 ? " LIMITED@EXAMPLE.TEST " : " limited ",
          password: "incorrect-password",
        });
        assert.equal(response.statusCode, 401, response.body);
      }
      assert.equal((await login({ identifier: "Limited" })).statusCode, 429);
      assert.equal(
        (await login({ email: "limited@example.test" })).statusCode,
        429,
      );
      const [limit] = await db.query(
        "SELECT hits FROM rate_limits WHERE key=$1",
        [`login-account:${digest("limited@example.test")}`],
      );
      assert.equal(limit!.hits, 12);
      assert.equal(await sessionCount(), before);
    },
  );

  await t.test(
    "username login requires a fresh proof and preserves CSRF protection",
    async () => {
      const options = {
        method: "POST" as const,
        url: "/api/auth/login",
        headers,
        remoteAddress: "192.0.2.200",
      };
      assert.equal(
        (
          await app.inject({
            ...options,
            payload: { identifier: "Player_One", password },
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            ...options,
            headers: { ...headers, origin: "https://other.example" },
            payload: { identifier: "Player_One", password },
          })
        ).statusCode,
        403,
      );
      const captcha = await proofFor(app, "login", "", options.remoteAddress);
      const accepted = await app.inject({
        ...options,
        payload: { identifier: "Player_One", password, captcha },
      });
      assert.equal(accepted.statusCode, 200, accepted.body);
      const replay = await app.inject({
        ...options,
        payload: { email: "player.one@example.test", password, captcha },
      });
      assert.equal(replay.statusCode, 400);
    },
  );
});
