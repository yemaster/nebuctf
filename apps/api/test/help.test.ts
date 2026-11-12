import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HTTPMethods } from "fastify";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { seedHelp } from "../src/seed-help.js";
import { sessionCookie } from "../src/auth.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";

test(
  "help publication, management permissions, CRUD and one-time initialization",
  { timeout: 90000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1");
    const app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    await app.ready();
    const identities = new Map<
      string,
      { id: string; username: string; avatar_id: string | null }
    >();
    async function account(role = "user", permissions: string[] = []) {
      const userId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const username = `help${userId.slice(0, 8)}`;
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role,access_profile) VALUES($1,$2,$3,'test',$4,$5)",
        [
          userId,
          username,
          `${userId}@example.test`,
          role,
          JSON.stringify({ permissions, roles: [], grants: [] }),
        ],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), userId],
      );
      const cookie = `${sessionCookie}=${token}`;
      identities.set(cookie, { id: userId, username, avatar_id: null });
      return cookie;
    }
    const admin = await account("admin");
    const ordinary = await account();
    const reader = await account("user", ["content.read"]);
    const writer = await account("user", ["content.write"]);
    const request = (
      url: string,
      cookie?: string,
      payload?: object,
      method: HTTPMethods = payload ? "POST" : "GET",
    ) =>
      app.inject({
        url,
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload,
      });
    const input = {
      slug: `regression-help-${crypto.randomUUID()}`,
      title: "Regression Help document",
      category: "Regression Help",
      position: 1,
      body: "## Original\n\nPrivate instructions; preserved punctuation.",
      published: false,
    };
    const created = await request("/api/admin/help", writer, input);
    assert.equal(created.statusCode, 200, created.body);
    const documentId: string = created.json().id;
    const path = `/api/admin/help/${documentId}`;

    await t.test(
      "drafts never appear publicly, even for administrators",
      async () => {
        for (const cookie of [undefined, ordinary, reader, writer, admin]) {
          const index = await request("/api/help", cookie);
          assert.equal(index.statusCode, 200);
          assert.equal(
            index
              .json()
              .items.some((item: { id: string }) => item.id === documentId),
            false,
          );
          assert.equal(
            (await request(`/api/help/${input.slug}`, cookie)).statusCode,
            404,
          );
        }
        const management = await request(path, reader);
        assert.equal(management.statusCode, 200);
        assert.equal(management.json().body, input.body);
        const listing = await request(
          "/api/admin/help?q=Regression%20Help",
          reader,
        );
        assert.equal(listing.statusCode, 200);
        assert.equal(listing.json().total, 1);
        assert.equal(listing.json().page, 1);
        assert.equal(listing.json().items[0].published, false);
        assert.equal("body" in listing.json().items[0], false);
      },
    );

    await t.test(
      "ordinary users cannot manage and read-only content staff cannot mutate",
      async () => {
        assert.equal((await request("/api/admin/help")).statusCode, 401);
        assert.equal(
          (await request("/api/admin/help", ordinary)).statusCode,
          403,
        );
        assert.equal((await request(path, ordinary)).statusCode, 403);
        for (const cookie of [ordinary, reader]) {
          assert.equal(
            (
              await request("/api/admin/help", cookie, {
                ...input,
                slug: `${input.slug}-denied`,
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (await request(path, cookie, input, "PUT")).statusCode,
            403,
          );
          assert.equal(
            (await request(path, cookie, undefined, "DELETE")).statusCode,
            403,
          );
        }
        const csrf = await app.inject({
          url: path,
          method: "PUT",
          headers: { cookie: writer },
          payload: input,
        });
        assert.equal(csrf.statusCode, 403);
      },
    );

    await t.test(
      "publishing, updating, uniqueness and missing IDs retain correct semantics",
      async () => {
        const published = {
          ...input,
          title: "Regression Help published",
          body: "## Updated\n\nPublished content",
          published: true,
        };
        const saved = await request(path, writer, published, "PUT");
        assert.equal(saved.statusCode, 200, saved.body);
        assert.deepEqual(saved.json(), { id: documentId });
        const detail = await request(`/api/help/${input.slug}`);
        assert.equal(detail.statusCode, 200);
        assert.equal(detail.json().body, published.body);
        const listing = (await request("/api/help")).json().items;
        assert.equal(
          listing.find((item: { id: string }) => item.id === documentId).title,
          published.title,
        );
        assert.equal(
          "body" in
            listing.find((item: { id: string }) => item.id === documentId),
          false,
        );
        assert.equal(
          (await request("/api/admin/help", writer, input)).statusCode,
          409,
        );
        const other = await request("/api/admin/help", writer, {
          ...input,
          slug: `${input.slug}-other`,
        });
        assert.equal(other.statusCode, 200, other.body);
        const otherPath = `/api/admin/help/${other.json().id}`;
        assert.equal(
          (await request(otherPath, writer, input, "PUT")).statusCode,
          409,
        );
        assert.equal(
          (await request(otherPath, reader)).json().slug,
          `${input.slug}-other`,
        );
        const missing = `/api/admin/help/${crypto.randomUUID()}`;
        assert.equal((await request(missing, reader)).statusCode, 404);
        // A nonexistent update must be 404 even when its proposed slug already exists.
        assert.equal(
          (await request(missing, writer, input, "PUT")).statusCode,
          404,
        );
        assert.equal(
          (await request(missing, writer, undefined, "DELETE")).statusCode,
          404,
        );
        assert.equal(
          (await request(path, writer, { ...input, position: -1 }, "PUT"))
            .statusCode,
          400,
        );
        assert.equal(
          (await request(path, writer, { ...input, slug: "not a slug" }, "PUT"))
            .statusCode,
          400,
        );
        assert.equal(
          (await request(path, writer, { ...input, position: 1.5 }, "PUT"))
            .statusCode,
          400,
        );
        assert.deepEqual(
          (await request(otherPath, writer, undefined, "DELETE")).json(),
          { ok: true },
        );
        assert.equal((await request(otherPath, reader)).statusCode, 404);
      },
    );

    await t.test(
      "attribution is server-owned, retains the creator and survives deleted users",
      async () => {
        const creator = await account("user", ["content.write"]);
        const editor = await account("admin");
        const author = identities.get(creator)!;
        const maintainer = identities.get(editor)!;
        const value = {
          ...input,
          slug: `help-attribution-${crypto.randomUUID()}`,
          title: "Maintainer history",
          category: "Attribution",
          body: "## Maintained notes",
          published: true,
        };
        const response = await request("/api/admin/help", creator, {
          ...value,
          created_by: maintainer.id,
          updated_by: maintainer.id,
        });
        assert.equal(response.statusCode, 200, response.body);
        const documentPath = `/api/admin/help/${response.json().id}`;
        const original = (await request(documentPath, reader)).json();
        assert.deepEqual(original.author, author);
        assert.deepEqual(original.editor, author);
        const updated = await request(
          documentPath,
          editor,
          {
            ...value,
            body: "## Edited by another maintainer",
            created_by: maintainer.id,
            updated_by: author.id,
          },
          "PUT",
        );
        assert.equal(updated.statusCode, 200, updated.body);
        assert.equal(
          (await request(documentPath, reader, value, "PUT")).statusCode,
          403,
        );
        const publicDocument = (
          await request(`/api/help/${value.slug}`)
        ).json();
        assert.deepEqual(publicDocument.author, author);
        assert.deepEqual(publicDocument.editor, maintainer);
        assert.equal(publicDocument.created_at, original.created_at);
        assert.equal(publicDocument.body, "## Edited by another maintainer");
        const listing = (
          await request(`/api/admin/help?q=${value.slug}`, reader)
        ).json();
        assert.deepEqual(listing.items[0].author, author);
        assert.deepEqual(listing.items[0].editor, maintainer);
        const renamed = {
          ...maintainer,
          username: `renamed${maintainer.id.slice(0, 8)}`,
          avatar_id: crypto.randomUUID(),
        };
        await db.query(
          "UPDATE users SET username=$1,avatar_id=$2 WHERE id=$3",
          [renamed.username, renamed.avatar_id, renamed.id],
        );
        assert.deepEqual(
          (await request(`/api/help/${value.slug}`)).json().editor,
          renamed,
        );
        await db.query("DELETE FROM audit_logs WHERE actor_id=$1", [author.id]);
        await db.query("DELETE FROM users WHERE id=$1", [author.id]);
        const withoutCreator = (
          await request(`/api/help/${value.slug}`)
        ).json();
        assert.equal(withoutCreator.author, null);
        assert.deepEqual(withoutCreator.editor, renamed);
        await db.query("DELETE FROM audit_logs WHERE actor_id=$1", [
          maintainer.id,
        ]);
        await db.query("DELETE FROM users WHERE id=$1", [maintainer.id]);
        const withoutPeople = (await request(`/api/help/${value.slug}`)).json();
        assert.equal(withoutPeople.editor, null);
        assert.equal(withoutPeople.body, "## Edited by another maintainer");
      },
    );

    await t.test(
      "search pagination and public ordering are deterministic",
      async () => {
        const prefix = `help-page-${crypto.randomUUID()}`;
        const expected: { id: string; slug: string }[] = [];
        for (let n = 0; n < 25; n++) {
          const slug = `${prefix}-${n}`;
          const result = await request("/api/admin/help", writer, {
            ...input,
            slug,
            title: `${prefix} ${String(Math.floor(n / 2)).padStart(2, "0")}`,
            category: "Pagination",
            position: 0,
            published: true,
          });
          assert.equal(result.statusCode, 200, result.body);
          expected.push({ id: result.json().id, slug });
        }
        const sorted = await db.query(
          "SELECT id,slug FROM help_documents WHERE category='Pagination' ORDER BY position,title,id",
        );
        const first = (
          await request(`/api/admin/help?q=${prefix}&page=1`, reader)
        ).json();
        const second = (
          await request(`/api/admin/help?q=${prefix}&page=2`, reader)
        ).json();
        assert.equal(first.total, 25);
        assert.equal(first.page, 1);
        assert.equal(first.items.length, 24);
        assert.equal(second.total, 25);
        assert.equal(second.page, 2);
        assert.equal(second.items.length, 1);
        assert.deepEqual(
          [...first.items, ...second.items].map(
            (item: { id: string }) => item.id,
          ),
          sorted.map((item) => item.id),
        );
        const beyond = (
          await request(`/api/admin/help?q=${prefix}&page=3`, reader)
        ).json();
        assert.equal(beyond.total, 25);
        assert.deepEqual(beyond.items, []);
        const publicItems = (await request("/api/help")).json().items;
        assert.deepEqual(
          publicItems
            .filter((item: { slug: string }) => item.slug.startsWith(prefix))
            .map((item: { id: string }) => item.id),
          sorted.map((item) => item.id),
        );
        for (const item of expected)
          await request(
            `/api/admin/help/${item.id}`,
            writer,
            undefined,
            "DELETE",
          );
      },
    );

    await t.test(
      "reinitialization and application restart preserve edited and deleted defaults",
      async () => {
        const [start] = await db.query(
          "SELECT * FROM help_documents WHERE slug='quick-start'",
        );
        const [deleted] = await db.query(
          "SELECT id FROM help_documents WHERE slug='account'",
        );
        const edited = {
          slug: start!.slug,
          title: "Locally edited welcome",
          category: "Custom",
          position: 999,
          body: "## Local edit\n\nDo not overwrite; administrators own this text.",
          published: false,
        };
        assert.equal(
          (await request(`/api/admin/help/${start!.id}`, writer, edited, "PUT"))
            .statusCode,
          200,
        );
        assert.equal(
          (
            await request(
              `/api/admin/help/${deleted!.id}`,
              writer,
              undefined,
              "DELETE",
            )
          ).statusCode,
          200,
        );
        await seedHelp(db);
        await seedHelp(db);
        const restarted = await buildApp(db);
        try {
          await restarted.ready();
          const saved = await restarted.inject({
            url: `/api/admin/help/${start!.id}`,
            headers: { cookie: reader },
          });
          assert.equal(saved.statusCode, 200);
          for (const [key, value] of Object.entries(edited))
            assert.deepEqual(saved.json()[key], value);
          assert.equal(
            (await restarted.inject({ url: "/api/help/quick-start" }))
              .statusCode,
            404,
          );
          assert.equal(
            (await restarted.inject({ url: "/api/help/account" })).statusCode,
            404,
          );
          assert.equal(
            (
              await db.query(
                "SELECT id FROM help_documents WHERE slug='account'",
              )
            ).length,
            0,
          );
          const removed = await request(path, writer, undefined, "DELETE");
          assert.deepEqual(removed.json(), { ok: true });
          assert.equal(
            (await request(`/api/help/${input.slug}`)).statusCode,
            404,
          );
          const logs = await db.query(
            "SELECT action FROM audit_logs WHERE target=$1 ORDER BY created_at,id",
            [documentId],
          );
          assert.equal(
            logs.some((log) => log.action === "help.save"),
            true,
          );
          assert.equal(
            logs.some((log) => log.action === "help.delete"),
            true,
          );
        } finally {
          await restarted.close();
        }
      },
    );
  },
);

test(
  "help attribution migration only trusts saves at the recorded creation and update times",
  { timeout: 90000 },
  async (t) => {
    const db = await openDB(true);
    t.after(() => db.close());
    const creator = crypto.randomUUID(),
      editor = crypto.randomUUID();
    for (const user of [creator, editor])
      await db.query(
        "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
        [user, `history${user.slice(0, 8)}`, `${user}@example.test`],
      );
    await db.query("ALTER TABLE help_documents DROP COLUMN created_by");
    await db.query("ALTER TABLE help_documents DROP COLUMN updated_by");
    await db.query("DELETE FROM schema_migrations WHERE version=35");
    const tracked = crypto.randomUUID(),
      seeded = crypto.randomUUID();
    for (const [document, updated] of [
      [tracked, "2026-01-02T00:00:00Z"],
      [seeded, "2026-01-03T00:00:00Z"],
    ])
      await db.query(
        "INSERT INTO help_documents(id,slug,title,category,position,body,created_at,updated_at) VALUES($1,$2,'Historic document','History',1,'Preserve this content','2026-01-01T00:00:00Z',$3)",
        [document, `history-${document}`, updated],
      );
    for (const [actor, document, time] of [
      [creator, tracked, "2026-01-01T00:00:00Z"],
      [editor, tracked, "2026-01-02T00:00:00Z"],
      [editor, seeded, "2026-01-03T00:00:00Z"],
    ])
      await db.query(
        "INSERT INTO audit_logs(id,actor_id,action,target,created_at) VALUES($1,$2,'help.save',$3,$4)",
        [crypto.randomUUID(), actor, document, time],
      );
    const schema = await readFile(
      new URL("../src/schema.sql", import.meta.url),
      "utf8",
    );
    const migrate = () =>
      db.transaction(async (tx) => {
        for (const statement of schema.split(";").filter((sql) => sql.trim()))
          await tx.query(statement);
      });
    await migrate();
    const [attributed] = await db.query(
      "SELECT created_by,updated_by,body FROM help_documents WHERE id=$1",
      [tracked],
    );
    assert.deepEqual(attributed, {
      created_by: creator,
      updated_by: editor,
      body: "Preserve this content",
    });
    const [editedSeed] = await db.query(
      "SELECT created_by,updated_by FROM help_documents WHERE id=$1",
      [seeded],
    );
    assert.deepEqual(editedSeed, { created_by: null, updated_by: editor });
    const [untouched] = await db.query(
      "SELECT created_by,updated_by FROM help_documents WHERE slug='quick-start'",
    );
    assert.deepEqual(untouched, { created_by: null, updated_by: null });
    await migrate();
    assert.deepEqual(
      (
        await db.query(
          "SELECT created_by,updated_by,body FROM help_documents WHERE id=$1",
          [tracked],
        )
      )[0],
      attributed,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT created_by,updated_by FROM help_documents WHERE id=$1",
          [seeded],
        )
      )[0],
      editedSeed,
    );
  },
);
