import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { avatarDirectory, avatarLimit } from "../src/avatars.js";

test(
  "local avatars and announcement attribution",
  { timeout: 60000 },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "nebu-avatar-")),
      previous = config.DATA_DIR;
    config.DATA_DIR = folder;
    const db = await openDB(true),
      app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
      config.DATA_DIR = previous;
      await rm(folder, { recursive: true, force: true });
    });
    const people = [];
    for (const role of ["admin", "admin", "user"]) {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        username = `avatar_${id.slice(0, 8)}`;
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, username, `${id}@test.invalid`, role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      people.push({
        id,
        username,
        headers: {
          cookie: `${sessionCookie}=${token}`,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
      });
    }
    const admin = people[0]!,
      other = people[1]!,
      user = people[2]!;
    const image = await sharp({
      create: { width: 640, height: 320, channels: 3, background: "#638a9c" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    function upload(data: Buffer, headers = user.headers, name = "avatar.jpg") {
      const boundary = "nebu-avatar-test";
      return app.inject({
        method: "POST",
        url: "/api/account/avatar",
        headers: {
          ...headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`,
          ),
          data,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    }
    let avatar = "";
    await t.test(
      "self-only upload is re-encoded locally, stripped and publicly cacheable",
      async () => {
        assert.equal(
          (await upload(image, {} as typeof user.headers)).statusCode,
          403,
        );
        assert.equal(
          (await upload(image, { ...user.headers, cookie: "" })).statusCode,
          401,
        );
        assert.equal(
          (await upload(image, { ...user.headers, "x-csrf-protection": "" }))
            .statusCode,
          403,
        );
        const response = await upload(image);
        assert.equal(response.statusCode, 200, response.body);
        avatar = response.json().avatar_id;
        const data = await readFile(join(avatarDirectory(), `${avatar}.webp`));
        const meta = await sharp(data).metadata();
        assert.equal(meta.width, 256);
        assert.equal(meta.height, 256);
        assert.equal(meta.format, "webp");
        assert.equal(meta.exif, undefined);
        assert.equal(meta.icc, undefined);
        assert.equal(meta.orientation, undefined);
        assert(data.length < 100_000);
        assert.notDeepEqual(data, image);
        const me = (
          await app.inject({ url: "/api/me", headers: user.headers })
        ).json();
        assert.equal(me.user.avatar_id, avatar);
        assert.equal(
          (
            await db.query("SELECT avatar_id FROM users WHERE id=$1", [
              other.id,
            ])
          )[0]!.avatar_id,
          null,
        );
        const publicImage = await app.inject({ url: `/api/avatars/${avatar}` });
        assert.equal(publicImage.statusCode, 200);
        assert.match(
          publicImage.headers["cache-control"] as string,
          /public.*immutable/,
        );
        assert.equal(publicImage.headers["content-type"], "image/webp");
        assert.deepEqual(publicImage.rawPayload, data);
        assert.equal(
          (
            await app.inject({
              url: `/api/avatars/${avatar}`,
              headers: { "if-none-match": publicImage.headers.etag as string },
            })
          ).statusCode,
          304,
        );
        assert.equal(
          (await app.inject({ url: "/api/avatars/not-a-uuid" })).statusCode,
          400,
        );
      },
    );
    await t.test(
      "invalid, oversized and excessive-pixel images preserve the existing avatar",
      async () => {
        for (const input of [
          Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
          Buffer.from([255, 216, 255, 0]),
        ])
          assert.equal((await upload(input)).statusCode, 400);
        assert.equal(
          (await upload(Buffer.alloc(avatarLimit + 1))).statusCode,
          413,
        );
        const huge = await sharp({
          create: {
            width: 4100,
            height: 4100,
            channels: 3,
            background: "white",
          },
        })
          .png()
          .toBuffer();
        assert.equal((await upload(huge)).statusCode, 400);
        assert.equal(
          (
            await db.query("SELECT avatar_id FROM users WHERE id=$1", [user.id])
          )[0]!.avatar_id,
          avatar,
        );
        assert.deepEqual(await readdir(avatarDirectory()), [`${avatar}.webp`]);
      },
    );
    await t.test(
      "replacement and reset remove old files and update only the owner",
      async () => {
        await db.query("DELETE FROM rate_limits");
        const replaced = await upload(image, user.headers, "../../outside.jpg");
        assert.equal(replaced.statusCode, 200, replaced.body);
        const next = replaced.json().avatar_id;
        assert.notEqual(next, avatar);
        assert.equal(
          (await app.inject({ url: `/api/avatars/${avatar}` })).statusCode,
          404,
        );
        assert.deepEqual(await readdir(avatarDirectory()), [`${next}.webp`]);
        const removed = await app.inject({
          method: "DELETE",
          url: "/api/account/avatar",
          headers: user.headers,
        });
        assert.equal(removed.statusCode, 200);
        assert.equal(removed.json().avatar_id, null);
        assert.equal(
          (await app.inject({ url: `/api/avatars/${next}` })).statusCode,
          404,
        );
        assert.deepEqual(await readdir(avatarDirectory()), []);
      },
    );
    await t.test(
      "creators are assigned by the server and edits preserve them",
      async () => {
        const result = await upload(image, admin.headers);
        assert.equal(result.statusCode, 200);
        avatar = result.json().avatar_id;
        const posted = await app.inject({
          method: "POST",
          url: "/api/admin/announcements",
          headers: admin.headers,
          payload: {
            title: "公告标题",
            body: "## 安排\n\n比赛说明",
            created_by: other.id,
          },
        });
        assert.equal(posted.statusCode, 200, posted.body);
        const notice = posted.json().id;
        const edited = await app.inject({
          method: "PUT",
          url: `/api/admin/announcements/${notice}`,
          headers: other.headers,
          payload: { title: "新标题", body: "修改正文" },
        });
        assert.equal(edited.statusCode, 200);
        for (const [url, headers] of [
          ["/api/announcements", {}],
          ["/api/admin/announcements", admin.headers],
        ] as const) {
          const list = await app.inject({ url, headers });
          assert.equal(list.statusCode, 200, list.body);
          const entry = list
            .json()
            .items.find((a: { id: string }) => a.id === notice);
          assert.deepEqual(entry.author, {
            id: admin.id,
            username: admin.username,
            avatar_id: avatar,
          });
          assert(!JSON.stringify(entry.author).includes("@test.invalid"));
        }
        const detail = await app.inject({
          url: `/api/admin/announcements/${notice}`,
          headers: admin.headers,
        });
        assert.equal(detail.json().author.id, admin.id);
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/admin/announcements",
              headers: user.headers,
              payload: { title: "test", body: "test" },
            })
          ).statusCode,
          403,
        );
        // Replay the migration against a legacy row; editing audits must not become authors.
        await db.query("UPDATE announcements SET created_by=NULL WHERE id=$1", [
          notice,
        ]);
        const unknown = crypto.randomUUID();
        await db.query(
          "INSERT INTO announcements(id,title,body) VALUES($1,'旧公告','未知创建人')",
          [unknown],
        );
        await db.query("DELETE FROM schema_migrations WHERE version=28");
        const schema = await readFile(
          new URL("../src/schema.sql", import.meta.url),
          "utf8",
        );
        for (let pass = 0; pass < 2; pass++)
          for (const sql of schema.split(";").filter((s) => s.trim()))
            await db.query(sql);
        assert.equal(
          (
            await db.query("SELECT created_by FROM announcements WHERE id=$1", [
              notice,
            ])
          )[0]!.created_by,
          admin.id,
        );
        assert.equal(
          (
            await db.query("SELECT created_by FROM announcements WHERE id=$1", [
              unknown,
            ])
          )[0]!.created_by,
          null,
        );
      },
    );
  },
);
