import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";

test("practice paging and active contest ordering apply before pagination", async (t) => {
  const db = await openDB(true),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const ids = Array.from({ length: 23 }, () => crypto.randomUUID());
  for (const [i, id] of ids.entries())
    await db.query(
      "INSERT INTO challenges(id,title,description,category,difficulty,kind,flag_hash,published,practice,created_at) VALUES($1,$2,$3,$4,'入门','static_attachment','never-return',true,true,now()+$5*interval '1 second')",
      [id, `Practice ${i}`, "Full description", i < 12 ? "Web" : "Misc", i],
    );
  const get = async (url: string) => {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const one = await get("/api/challenges?page_size=10"),
    two = await get("/api/challenges?page_size=10&page=2"),
    three = await get("/api/challenges?page_size=10&page=3");
  assert.deepEqual(
    [one.items.length, two.items.length, three.items.length],
    [10, 10, 3],
  );
  assert.deepEqual(
    [...one.items, ...two.items, ...three.items].map((c) => c.id),
    ids,
  );
  assert.equal((await get("/api/challenges?page_size=10&page=4")).total, 23);
  const filtered = await get(
    "/api/challenges?page_size=10&category=Web&page=2",
  );
  assert.equal(filtered.total, 12);
  assert.equal(filtered.items.length, 2);
  assert.equal((await get("/api/challenges")).items.length, 23);
  assert(!JSON.stringify(one).includes("never-return"));
  assert(!JSON.stringify(one).includes("Full description"));
  assert.equal(
    (await get(`/api/challenges/${ids[0]}`)).description,
    "Full description",
  );
  for (const pageSize of ["0", "101", "1.5"])
    assert.equal(
      (await app.inject({ url: `/api/challenges?page_size=${pageSize}` }))
        .statusCode,
      400,
    );
  const pid = crypto.randomUUID();
  await db.query(
    "INSERT INTO problemsets(id,title,published) VALUES($1,'Practice set',true)",
    [pid],
  );
  for (const [i, id] of ids.entries())
    await db.query(
      "INSERT INTO problemset_items(problemset_id,challenge_id,position) VALUES($1,$2,$3)",
      [pid, id, i],
    );
  const set = await get(`/api/problemsets/${pid}?page_size=10&page=2`);
  assert.equal(set.filtered_total, 23);
  assert.deepEqual(
    set.items.map((c) => c.id),
    ids.slice(10, 20),
  );
  const ongoing = crypto.randomUUID(),
    ended = crypto.randomUUID();
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Running',true,now()-interval '1 day',now()+interval '1 hour'),($2,'Ended',true,now()-interval '2 days',now()-interval '1 day')",
    [ongoing, ended],
  );
  for (let i = 1; i <= 26; i++)
    await db.query(
      "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,$2,true,now()+$3*interval '1 day',now()+($3+1)*interval '1 day')",
      [crypto.randomUUID(), `Upcoming ${i}`, i],
    );
  const contests = await get("/api/contests"),
    next = await get("/api/contests?page=2");
  assert.equal(contests.total, 28);
  assert.equal(contests.items[0].id, ongoing);
  assert.equal(contests.items[1].title, "Upcoming 1");
  assert.equal(next.items.at(-1).id, ended);
  assert.equal(
    new Set([...contests.items, ...next.items].map((c) => c.id)).size,
    28,
  );
});
