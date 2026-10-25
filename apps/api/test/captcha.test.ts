import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { proofFor } from "./helpers/captcha.js";
import { solveProof } from "../../web/src/lib/captcha-proof.ts";

test("HashPow gates authentication and team writes with expiring, bound, single-use proofs", async (t) => {
  const difficulty = config.CAPTCHA_DIFFICULTY;
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
    config.CAPTCHA_DIFFICULTY = difficulty;
  });
  const credentials = { email: "proof@example.test", password: "eight888" };
  let alice = "",
    bob = "",
    invite = "";
  const send = (
    path: string,
    body: unknown,
    cookie = "",
    remoteAddress = "127.0.0.1",
  ) =>
    app.inject({
      method: "POST",
      url: `/api${path}`,
      remoteAddress,
      headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
      payload: body as any,
    });
  const login = (
    captcha?: unknown,
    password = credentials.password,
    remoteAddress?: string,
  ) =>
    send(
      "/auth/login",
      { ...credentials, password, captcha },
      "",
      remoteAddress,
    );
  const cookieOf = (r: Awaited<ReturnType<typeof send>>) =>
    `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;

  await t.test(
    "missing proofs block registration and login before account writes",
    async () => {
      assert.equal(
        (
          await send("/auth/register", {
            ...credentials,
            username: "proofuser",
          })
        ).statusCode,
        400,
      );
      assert.equal((await login()).statusCode, 400);
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM users"))[0]!.n,
        0,
      );
      const result = await send("/auth/register", {
        ...credentials,
        username: "proofuser",
        captcha: await proofFor(app, "register"),
      });
      assert.equal(result.statusCode, 200, result.body);
      alice = cookieOf(result);
    },
  );
  await t.test(
    "failed credentials consume a proof; a fresh browser-computed proof succeeds",
    async () => {
      const captcha = await proofFor(app, "login");
      assert.equal((await login(captcha, "wrong-password")).statusCode, 401);
      assert.equal((await login(captcha)).statusCode, 400);
      const issued = await send("/captcha/challenge", { purpose: "login" });
      assert.equal(issued.headers["cache-control"], "no-store");
      const challenge = issued.json();
      const nonce = solveProof(challenge.salt, challenge.difficulty);
      const accepted = await login({ token: challenge.token, nonce });
      assert.equal(accepted.statusCode, 200, accepted.body);
    },
  );
  await t.test(
    "purpose, IP, signature and computation are all verified",
    async () => {
      const proof = await proofFor(app, "login");
      assert.equal(
        (
          await send("/auth/register", {
            username: "another",
            email: "other@example.test",
            password: "eight888",
            captcha: proof,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (await login(proof, credentials.password, "192.0.2.12")).statusCode,
        400,
      );
      const [encoded, signature] = proof.token.split(".");
      const data = JSON.parse(Buffer.from(encoded, "base64url").toString());
      const forged = Buffer.from(
        JSON.stringify({ ...data, difficulty: 0 }),
      ).toString("base64url");
      assert.equal(
        (await login({ ...proof, token: `${forged}.${signature}` })).statusCode,
        400,
      );
      let invalid = Buffer.alloc(8);
      for (let n = 0; ; n++) {
        invalid.writeUInt32BE(n, 4);
        if (
          createHash("sha256")
            .update(Buffer.from(data.salt, "hex"))
            .update(invalid)
            .digest()[0]! & 0x80
        )
          break;
      }
      assert.equal(
        (await login({ ...proof, nonce: invalid.toString("hex") })).statusCode,
        400,
      );
      assert.equal((await login({ ...proof, nonce: "zz" })).statusCode, 400);
      assert.equal(
        (await login(proof)).statusCode,
        200,
        "invalid attempts cannot consume the owner's valid proof",
      );
    },
  );
  await t.test(
    "expired signed proofs and concurrent replays cannot create a session",
    async () => {
      const proof = await proofFor(app, "login");
      const data = JSON.parse(
        Buffer.from(proof.token.split(".")[0], "base64url").toString(),
      );
      data.expires = Date.now() - 1000;
      const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
      const signature = createHmac("sha256", config.APP_SECRET)
        .update(`captcha:challenge:${encoded}`)
        .digest("hex");
      assert.equal(
        (await login({ ...proof, token: `${encoded}.${signature}` }))
          .statusCode,
        400,
      );
      const results = await Promise.all([login(proof), login(proof)]);
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    },
  );
  await t.test(
    "both team operations require their own authenticated user's proof",
    async () => {
      assert.equal(
        (await send("/captcha/challenge", { purpose: "team-create" }))
          .statusCode,
        401,
      );
      assert.equal(
        (await send("/teams", { name: "Proof team" }, alice)).statusCode,
        400,
      );
      const proof = await proofFor(app, "team-create", alice);
      const created = await send(
        "/teams",
        { name: "Proof team", captcha: proof },
        alice,
      );
      assert.equal(created.statusCode, 200, created.body);
      invite = created.json().invite;
      assert.equal(
        (await send("/teams", { name: "Replayed", captcha: proof }, alice))
          .statusCode,
        400,
      );
      const second = await send("/auth/register", {
        username: "proofsecond",
        email: "second@example.test",
        password: "eight888",
        captcha: await proofFor(app, "register"),
      });
      assert.equal(second.statusCode, 200, second.body);
      bob = cookieOf(second);
      assert.equal((await send("/team/join", { invite }, bob)).statusCode, 400);
      const wrongOwner = await proofFor(app, "team-join", alice);
      assert.equal(
        (await send("/team/join", { invite, captcha: wrongOwner }, bob))
          .statusCode,
        400,
      );
      const wrongPurpose = await proofFor(app, "team-create", bob);
      assert.equal(
        (await send("/team/join", { invite, captcha: wrongPurpose }, bob))
          .statusCode,
        400,
      );
      const joined = await send(
        "/team/join",
        { invite, captcha: await proofFor(app, "team-join", bob) },
        bob,
      );
      assert.equal(joined.statusCode, 200, joined.body);
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM memberships"))[0]!.n,
        2,
      );
    },
  );
  await t.test(
    "challenge issuance is rate limited and rejects unknown purposes",
    async () => {
      assert.equal(
        (await send("/captcha/challenge", { purpose: "administrator" }))
          .statusCode,
        400,
      );
      for (let i = 0; i < 30; i++)
        assert.equal(
          (
            await send(
              "/captcha/challenge",
              { purpose: "login" },
              "",
              "198.51.100.9",
            )
          ).statusCode,
          200,
        );
      assert.equal(
        (
          await send(
            "/captcha/challenge",
            { purpose: "login" },
            "",
            "198.51.100.9",
          )
        ).statusCode,
        429,
      );
      const rows = await db.query("SELECT count(*)::int n FROM captcha_uses");
      assert.ok(
        rows[0]!.n < 15,
        "unused challenges don't create persistent proof rows",
      );
    },
  );
});
