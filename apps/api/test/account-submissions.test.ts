import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";

test("personal submission history paginates and filters without exposing another user or answer", async (t) => {
  const db = await openDB(true),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const uid = crypto.randomUUID(),
    other = crypto.randomUUID(),
    cid = crypto.randomUUID(),
    token = crypto.randomUUID();
  for (const id of [uid, other])
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'private-password')",
      [id, id.slice(0, 12), id + "@test.invalid"],
    );
  await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')", [
    digest(token),
    uid,
  ]);
  await db.query(
    "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash) VALUES($1,'Cookie Shop','Web','入门','static_attachment','private-flag-hash')",
    [cid],
  );
  for (let i = 0; i < 27; i++)
    await db.query(
      "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct,created_at) VALUES($1,$2,$3,'practice',$4,$5,'2026-10-01T00:00:00Z')",
      [
        crypto.randomUUID(),
        i < 25 ? uid : other,
        cid,
        "u:" + (i < 25 ? uid : other),
        i % 2 === 0,
      ],
    );
  const req = (query = "") =>
    app.inject({
      url: "/api/submissions" + query,
      headers: { cookie: `${sessionCookie}=${token}` },
    });
  assert.equal((await app.inject({ url: "/api/submissions" })).statusCode, 401);
  const legacy = (await req()).json();
  assert.equal(legacy.items.length, 25);
  assert.equal(legacy.total, 25);
  assert.equal(legacy.page_size, 30);
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const response = await req(`?page=${page}&page_size=10`);
    assert.equal(response.statusCode, 200);
    const data = response.json();
    assert.equal(data.total, 25);
    assert.equal(data.items.length, page === 3 ? 5 : 10);
    pages.push(...data.items);
    for (const field of ["password_hash", "flag_hash", "owner_key", "user_id"])
      assert(!response.body.includes(field));
  }
  assert.deepEqual(
    pages.map((s) => s.id),
    legacy.items.map((s: any) => s.id),
  );
  assert.equal(new Set(pages.map((s) => s.id)).size, 25);
  assert.equal((await req("?page=4&page_size=10")).json().total, 25);
  assert.equal((await req("?page=4&page_size=10")).json().items.length, 0);
  const correct = (await req("?q=cookie&result=correct&page_size=10")).json();
  assert.equal(correct.total, 13);
  assert.equal(correct.items.length, 10);
  assert(correct.items.every((s: any) => s.correct));
  const incorrect = (await req("?result=incorrect")).json();
  assert.equal(incorrect.total, 12);
  assert(incorrect.items.every((s: any) => !s.correct));
  assert.equal((await req("?q=missing")).json().total, 0);
  for (const query of [
    "?page_size=0",
    "?page_size=101",
    "?page_size=1.5",
    "?page=0",
    "?result=invalid",
  ])
    assert.equal((await req(query)).statusCode, 400);
});
