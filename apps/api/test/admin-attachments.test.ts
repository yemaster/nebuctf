import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.js";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";

test("admin attachment downloads and confirmed deletion are scoped and audited", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db),
    oldDir = config.DATA_DIR;
  config.DATA_DIR = await mkdtemp(join(tmpdir(), "nct-attachment-admin-"));
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(config.DATA_DIR, { recursive: true, force: true });
    config.DATA_DIR = oldDir;
  });
  const write = (
    path: string,
    cookie: string,
    payload: unknown = {},
    method: "POST" | "DELETE" = "POST",
  ) =>
    app.inject({
      url: "/api" + path,
      method,
      headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
      payload: payload as any,
    });
  const get = (path: string, cookie = "") =>
    app.inject({ url: "/api" + path, headers: { cookie } });
  async function user(name: string) {
    const r = await write("/auth/register", "", {
      username: name,
      email: name + "@example.test",
      password: "eight888",
    });
    assert.equal(r.statusCode, 200);
    return {
      id: r.json().user.id,
      cookie: r.cookies[0]!.name + "=" + r.cookies[0]!.value,
    };
  }
  const admin = await user("fileadmin"),
    player = await user("fileplayer");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  const c = await write("/admin/challenges", admin.cookie, {
    title: "Private draft",
    kind: "static_attachment",
    category: "Misc",
    difficulty: "入门",
    flag: "flag{private}",
    practice: false,
    published: false,
  });
  assert.equal(c.statusCode, 200, c.body);
  const boundary = "NebuctfAttachmentBoundary";
  const bytes = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="draft.txt"\r\nContent-Type: text/plain\r\n\r\nprivate content\r\n--${boundary}--\r\n`,
  );
  const uploaded = await app.inject({
    url: `/api/admin/challenges/${c.json().id}/attachments`,
    method: "POST",
    headers: {
      cookie: admin.cookie,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: bytes,
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const aid = uploaded.json().id,
    path = "/admin/attachments/" + aid;
  await t.test(
    "administrators can download unpublished non-practice files while ordinary access remains denied",
    async () => {
      const r = await get(path, admin.cookie);
      assert.equal(r.statusCode, 200);
      assert.equal(r.body, "private content");
      assert.match(r.headers["content-disposition"] as string, /draft.txt/);
      assert.equal((await get(path)).statusCode, 401);
      assert.equal((await get(path, player.cookie)).statusCode, 403);
      assert.equal(
        (await get("/attachments/" + aid, player.cookie)).statusCode,
        404,
      );
      assert.equal(
        (await get("/admin/attachments/not-a-uuid", admin.cookie)).statusCode,
        400,
      );
      assert.equal(
        (await get("/admin/attachments/" + crypto.randomUUID(), admin.cookie))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    "deletion enforces administrator and CSRF checks without removing data",
    async () => {
      assert.equal(
        (await write(path, player.cookie, {}, "DELETE")).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            url: "/api" + path,
            method: "DELETE",
            headers: { cookie: admin.cookie },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await readFile(join(config.DATA_DIR, "files", aid))).toString(),
        "private content",
      );
      assert.equal((await get(path, admin.cookie)).statusCode, 200);
    },
  );
  await t.test(
    "deletion removes the file and reference and records its actor exactly once",
    async () => {
      assert.equal(
        (await write(path, admin.cookie, {}, "DELETE")).statusCode,
        200,
      );
      await assert.rejects(access(join(config.DATA_DIR, "files", aid)));
      assert.equal((await get(path, admin.cookie)).statusCode, 404);
      assert.equal(
        (await write(path, admin.cookie, {}, "DELETE")).statusCode,
        404,
      );
      assert.equal(
        (await get("/admin/challenges/" + c.json().id, admin.cookie)).json()
          .attachments.length,
        0,
      );
      const events = await db.query(
        "SELECT actor_id FROM audit_logs WHERE action='attachment.delete' AND target=$1",
        [aid],
      );
      assert.deepEqual(
        events.map((e) => e.actor_id),
        [admin.id],
      );
    },
  );
});
