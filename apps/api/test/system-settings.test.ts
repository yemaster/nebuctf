import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, flagHash } from "../src/security.js";
import { defaults, getSetting, seal, unseal } from "../src/settings.js";
import { emailAllowed } from "../src/mail.js";
import { proofFor } from "./helpers/captcha.js";
import { Worker } from "../src/worker.js";

test(
  "system settings, SMTP registration and confirmed container replacement",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      previousLimit = config.MAX_OWNER_INSTANCES;
    const admin = crypto.randomUUID(),
      user = crypto.randomUUID(),
      cookie = "settings-admin",
      userCookie = "settings-user";
    for (const [id, role, session] of [
      [admin, "admin", cookie],
      [user, "user", userCookie],
    ]) {
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "u" + id!.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(session!), id],
      );
    }
    const request = (
      path: string,
      payload?: unknown,
      method: any = payload ? "PUT" : "GET",
      who = cookie,
    ) =>
      app.inject({
        method,
        url: "/api" + path,
        headers: {
          cookie: `${sessionCookie}=${who}`,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: payload as any,
      });
    const ok = async (
      path: string,
      payload?: unknown,
      method?: any,
      who?: string,
    ) => {
      const r = await request(path, payload, method, who);
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    t.after(async () => {
      config.MAX_OWNER_INSTANCES = previousLimit;
      await app.close();
      await db.close();
    });
    await t.test(
      "settings are admin-only, validate limits and expose only public branding",
      async () => {
        assert.equal(
          (await request("/admin/settings/site", undefined, "GET", userCookie))
            .statusCode,
          403,
        );
        assert.equal(
          (await request("/admin/settings/site", undefined, "GET", ""))
            .statusCode,
          401,
        );
        await ok("/admin/settings/site", {
          name: "Test Arena",
          footer_text: "Test footer",
          footer_link_label: "联系",
          footer_link_url: "https://example.com",
        });
        assert.equal((await ok("/site")).name, "Test Arena");
        assert.equal(
          (
            await request("/admin/settings/site", {
              ...defaults.site,
              footer_link_url: "javascript:alert(1)",
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request("/admin/settings/containers", {
              ...defaults.containers,
              renew_limit: -1,
            })
          ).statusCode,
          400,
        );
        const encrypted = seal("smtp-secret");
        assert(!encrypted.includes("smtp-secret"));
        assert.equal(unseal(encrypted), "smtp-secret");
        assert.throws(() => unseal(encrypted.slice(0, -2) + "00"));
        const overview = await ok("/admin/overview?days=7");
        assert.equal(overview.users, 2);
        assert.equal(overview.activity.length, 7);
        assert.equal(overview.worker_at, null);
        assert.equal(overview.resources.n, 0);
      },
    );
    await t.test(
      "SMTP sends a one-time code; whitelist, wrong attempts, expiry and replay are enforced",
      async () => {
        const messages: string[] = [];
        const codeFrom = (message: string) =>
          Buffer.from(message.split("\n\n")[1]!.replaceAll("\n", ""), "base64")
            .toString("utf8")
            .match(/\b(\d{6})\b/)![1]!;
        const smtp = createServer((socket) => {
          socket.write("220 test SMTP\r\n");
          let buffer = "",
            inData = false,
            data = "";
          socket.on("data", (chunk) => {
            buffer += chunk.toString();
            for (;;) {
              const end = buffer.indexOf("\r\n");
              if (end < 0) break;
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (inData) {
                if (line === ".") {
                  messages.push(data);
                  data = "";
                  inData = false;
                  socket.write("250 accepted\r\n");
                } else data += line + "\n";
              } else if (/^EHLO/.test(line))
                socket.write("250-test\r\n250 AUTH PLAIN\r\n");
              else if (/^AUTH/.test(line))
                socket.write("235 authenticated\r\n");
              else if (/^DATA/.test(line)) {
                inData = true;
                socket.write("354 send\r\n");
              } else if (/^QUIT/.test(line)) socket.end("221 bye\r\n");
              else socket.write("250 OK\r\n");
            }
          });
        });
        await new Promise<void>((resolve) =>
          smtp.listen(0, "127.0.0.1", resolve),
        );
        t.after(
          () => new Promise<void>((resolve) => smtp.close(() => resolve())),
        );
        const settings = {
          require_verification: true,
          allowed_emails: ["example.test"],
          host: "127.0.0.1",
          port: (smtp.address() as any).port,
          security: "none",
          username: "test",
          password: "smtp-secret",
          from_address: "noreply@example.test",
          from_name: "Test Arena",
        };
        await ok("/admin/settings/mail", settings);
        const publicValue = await ok("/admin/settings/mail");
        assert.equal(publicValue.password_set, true);
        assert(!JSON.stringify(publicValue).includes("smtp-secret"));
        assert(!("password_cipher" in publicValue));
        const { password, ...withoutPassword } = settings;
        await ok("/admin/settings/mail", withoutPassword);
        assert.equal(
          unseal((await getSetting(db, "mail")).password_cipher),
          password,
        );
        assert(!JSON.stringify(await ok("/site")).includes("smtp"));
        await ok("/admin/settings/mail/test", {}, "POST");
        assert(emailAllowed("me@sub.example.com", ["*.example.com"]));
        assert(!emailAllowed("me@example.com", ["*.example.com"]));
        assert(!emailAllowed("me@badexample.com", ["example.com"]));
        const code = async (email: string) =>
          ok(
            "/auth/email-code",
            { email, captcha: await proofFor(app, "register") },
            "POST",
            "",
          );
        const email = "new@example.test",
          challenge = await code(email),
          message = messages.at(-1)!;
        const secret = codeFrom(message);
        const payload = {
          username: "new-user",
          email,
          password: "password888",
          email_verification: { id: challenge.id, code: secret },
        };
        assert.equal(
          (
            await request(
              "/auth/register",
              { ...payload, email: "new@other.test" },
              "POST",
              "",
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request(
              "/auth/register",
              {
                ...payload,
                email_verification: {
                  id: challenge.id,
                  code: secret === "000000" ? "000001" : "000000",
                },
              },
              "POST",
              "",
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await db.query(
              "SELECT attempts FROM email_verifications WHERE id=$1",
              [challenge.id],
            )
          )[0]!.attempts,
          1,
        );
        const registered = await request("/auth/register", payload, "POST", "");
        assert.equal(registered.statusCode, 200, registered.body);
        assert(registered.cookies.length);
        assert.equal(
          (await request("/auth/register", payload, "POST", "")).statusCode,
          400,
        );
        assert(
          (
            await db.query(
              "SELECT email_verified_at FROM users WHERE email=$1",
              [email],
            )
          )[0]!.email_verified_at,
        );
        const exhausted = await code("tries@example.test");
        for (let n = 0; n < 5; n++)
          await request(
            "/auth/register",
            {
              ...payload,
              email: "tries@example.test",
              email_verification: { id: exhausted.id, code: "invalid" },
            },
            "POST",
            "",
          );
        // Schema-invalid values never test a code; valid wrong guesses consume exactly five attempts.
        const correct = codeFrom(messages.at(-1)!);
        for (let n = 0; n < 5; n++)
          await request(
            "/auth/register",
            {
              ...payload,
              email: "tries@example.test",
              email_verification: {
                id: exhausted.id,
                code: correct === "111111" ? "222222" : "111111",
              },
            },
            "POST",
            "",
          );
        assert.equal(
          (
            await request(
              "/auth/register",
              {
                ...payload,
                email: "tries@example.test",
                email_verification: { id: exhausted.id, code: correct },
              },
              "POST",
              "",
            )
          ).statusCode,
          400,
        );
        const expired = await code("expired@example.test");
        await db.query(
          "UPDATE email_verifications SET expires_at=now()-interval '1 second' WHERE id=$1",
          [expired.id],
        );
        assert.equal(
          (
            await request(
              "/auth/register",
              {
                ...payload,
                email: "expired@example.test",
                email_verification: {
                  id: expired.id,
                  code: codeFrom(messages.at(-1)!),
                },
              },
              "POST",
              "",
            )
          ).statusCode,
          400,
        );
        await ok("/admin/settings/mail", {
          ...withoutPassword,
          require_verification: false,
        });
      },
    );
    await t.test(
      "default lifetime and renewal budgets are snapshotted and respect deadlines",
      async () => {
        await ok("/admin/settings/containers", {
          default_ttl: 1200,
          renew_limit: 2,
          renew_seconds: 600,
          auto_destroy: false,
        });
        const cid = crypto.randomUUID();
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,image,flag_hash,published,practice) VALUES($1,'Timed','Web','入门','dynamic_container','nebuctf/test:latest',$2,true,true)",
          [cid, flagHash("flag{test}")],
        );
        const instance = await ok(
          `/challenges/${cid}/instances`,
          { scope: "practice" },
          "POST",
          userCookie,
        );
        const row = (
          await db.query("SELECT * FROM instances WHERE id=$1", [instance.id])
        )[0]!;
        assert.equal(row.spec.ttl, 1200);
        assert.equal(row.spec.renew_limit, 2);
        await db.query(
          "UPDATE instances SET status='running',expires_at=now()+interval '10 minutes',max_expires_at=now()+interval '25 minutes' WHERE id=$1",
          [instance.id],
        );
        const before = (
          await db.query("SELECT expires_at FROM instances WHERE id=$1", [
            instance.id,
          ])
        )[0]!.expires_at;
        await ok("/admin/settings/containers", {
          default_ttl: 60,
          renew_limit: 0,
          renew_seconds: 60,
          auto_destroy: false,
        });
        const renewed = await ok(
          `/instances/${instance.id}/renew`,
          {},
          "POST",
          userCookie,
        );
        assert.equal(
          Date.parse(renewed.expires_at) - new Date(before).getTime(),
          600000,
        );
        assert.equal(renewed.renew_count, 1);
        const last = await ok(
          `/instances/${instance.id}/renew`,
          {},
          "POST",
          userCookie,
        );
        assert.equal(last.renew_count, 2);
        assert.equal(
          (
            await request(
              `/instances/${instance.id}/renew`,
              {},
              "POST",
              userCookie,
            )
          ).statusCode,
          409,
        );
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          instance.id,
        ]);
      },
    );
    await t.test(
      "replacement is a fresh confirmed plan and provisioning waits for physical cleanup",
      async () => {
        config.MAX_OWNER_INSTANCES = 1;
        await ok("/admin/settings/containers", {
          ...defaults.containers,
          auto_destroy: true,
        });
        const question = async (title: string) => {
          const id = crypto.randomUUID();
          await db.query(
            "INSERT INTO challenges(id,title,category,difficulty,kind,image,flag_hash,published,practice) VALUES($1,$2,'Web','入门','dynamic_container','nebuctf/test:latest',$3,true,true)",
            [id, title, flagHash("flag{test}")],
          );
          return id;
        };
        const first = await question("Old"),
          second = await question("New");
        const old = await ok(
          `/challenges/${first}/instances`,
          { scope: "practice" },
          "POST",
          userCookie,
        );
        await db.query("UPDATE instances SET status='running' WHERE id=$1", [
          old.id,
        ]);
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'resource:%'");
        const plan = await ok(
          `/challenges/${second}/instances`,
          { scope: "practice" },
          "POST",
          userCookie,
        );
        assert.equal(plan.requires_confirmation, true);
        assert.deepEqual(plan.replacements, [{ id: old.id, title: "Old" }]);
        assert.equal(
          (
            await db.query("SELECT status FROM instances WHERE id=$1", [old.id])
          )[0]!.status,
          "running",
        );
        const forged = await ok(
          `/challenges/${second}/instances`,
          { scope: "practice", replace_ids: [crypto.randomUUID()] },
          "POST",
          userCookie,
        );
        assert(forged.requires_confirmation);
        const next = await ok(
          `/challenges/${second}/instances`,
          { scope: "practice", replace_ids: [old.id] },
          "POST",
          userCookie,
        );
        assert.equal(next.status, "queued");
        const worker = new Worker(db),
          started: string[] = [];
        let canClean = false;
        worker.cleanup = async () => {
          if (!canClean) throw Error("simulated cleanup delay");
        };
        worker.start = async (row) => {
          started.push(row.id);
        };
        const output = console.error;
        console.error = () => {};
        try {
          await worker.tick();
          await worker.drain();
        } finally {
          console.error = output;
        }
        assert.deepEqual(started, []);
        canClean = true;
        await worker.tick();
        await worker.drain();
        assert.deepEqual(started, [next.id]);
        const auditRows = await db.query(
          "SELECT action FROM audit_logs WHERE target=$1",
          [old.id],
        );
        assert(auditRows.some((r) => r.action === "instance.replace"));
      },
    );
  },
);
