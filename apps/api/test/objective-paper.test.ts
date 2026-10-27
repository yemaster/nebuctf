import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { config } from "../src/config.js";
import { objectiveInput, objectiveReview } from "../src/challenge-model.js";

test("objective paper shares team drafts, submits atomically and respects sections, visibility and practice", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  await app.ready();
  t.after(async () => {
    await app.close();
    await db.close();
  });
  async function actor(role = "user", existing?: string) {
    const id = crypto.randomUUID(),
      team = existing ?? crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
      [id, "paper" + id.slice(0, 8), id + "@example.test", role],
    );
    if (!existing)
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, "Paper " + team, id, digest(token)],
      );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      id,
      team,
    ]);
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), id],
    );
    return { id, team, cookie: `${sessionCookie}=${token}` };
  }
  const alice = await actor(),
    mate = await actor("user", alice.team),
    admin = await actor("admin"),
    outsider = await actor();
  const scope = crypto.randomUUID(),
    group = crypto.randomUUID();
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID()),
    [single, multiple, blank, hidden, ctf] = ids;
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Paper',true,now()-interval '1 minute',now()+interval '1 hour')",
    [scope],
  );
  await db.query(
    "INSERT INTO contest_groups(id,contest_id,name,position,challenge_permissions) VALUES($1,$2,'Visible',0,$3)",
    [group, scope, JSON.stringify({ [hidden!]: { view: false } })],
  );
  await db.query(
    "INSERT INTO registrations(contest_id,team_id,group_id) VALUES($1,$2,$3)",
    [scope, alice.team, group],
  );
  for (const [i, id] of ids.entries()) {
    const definition =
      i === 2
        ? {
            type: "blank",
            blanks: [{ id: "a", label: "答案", answers: ["test-secret"] }],
            options: [],
            correct_options: [],
            trim: true,
            case_sensitive: true,
          }
        : {
            type: i === 1 ? "multiple" : "single",
            options: [
              { id: "A", text: "Option A" },
              { id: "B", text: "Option B" },
            ],
            correct_options: i === 1 ? ["A", "B"] : ["A"],
            blanks: [],
            trim: true,
            case_sensitive: true,
          };
    await db.query(
      "INSERT INTO challenges(id,title,description,category,difficulty,kind,published,challenge_type,objective) VALUES($1,$2,'Description','Misc','入门','static_attachment',true,$3,$4)",
      [
        id,
        i === 3 ? "Hidden title" : `Question ${i}`,
        i === 4 ? "ctf" : "objective",
        i === 4 ? null : JSON.stringify(definition),
      ],
    );
    await db.query(
      "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
      [scope, id],
    );
  }
  const path = `/api/contests/${scope}/objective-paper`;
  const req = (actor = alice, body?: unknown) =>
    app.inject({
      url: path,
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: actor.cookie,
        origin: config.APP_ORIGIN,
        "x-csrf-protection": "1",
      },
      payload: body as any,
    });
  const ok = async (actor = alice, body?: unknown) => {
    const r = await req(actor, body);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  let paper = await ok();
  assert.equal(paper.items.length, 3);
  assert(paper.can_submit);
  assert(paper.items.every((q: any) => q.saved.review === null));
  assert(!JSON.stringify(paper).includes("test-secret"));
  assert(!JSON.stringify(paper).includes("correct_options"));
  assert(!JSON.stringify(paper).includes("Hidden title"));
  assert(!JSON.stringify(paper).includes("bloods"));
  assert(!JSON.stringify(paper).includes("solves"));
  const preview = await ok(admin);
  assert(preview.preview);
  assert(!preview.can_submit);
  assert(
    preview.items.every(
      (q: any) => !q.saved.revision && q.saved.review === null,
    ),
  );
  assert.equal((await req(outsider)).statusCode, 403);
  await ok(alice, {
    finalize: false,
    answers: [
      { id: single, answer: { choices: ["A"] }, revision: null },
      { id: multiple, answer: { choices: ["A"] }, revision: null },
    ],
  });
  paper = await ok(mate);
  assert(paper.items.every((q: any) => q.saved.review === null));
  assert.deepEqual(paper.items.find((q: any) => q.id === single).saved.answer, {
    choices: ["A"],
  });
  const stale = paper.items.map((q: any) => ({
    id: q.id,
    answer: q.id === blank ? { blanks: { a: "test-secret" } } : q.saved.answer,
    revision: q.saved.revision,
  }));
  await ok(mate, {
    finalize: false,
    answers: [
      {
        ...stale.find((q: any) => q.id === multiple),
        answer: { choices: ["B"] },
      },
    ],
  });
  assert.equal(
    (await req(alice, { finalize: true, answers: stale })).statusCode,
    409,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM objective_answers WHERE scope=$1 AND finalized_at IS NOT NULL",
        [scope],
      )
    )[0]!.n,
    0,
    "conflicting answer rolls back the entire paper",
  );
  assert.equal(
    (await req(alice, { finalize: true, answers: stale.slice(0, 1) }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await req(alice, {
        finalize: false,
        answers: [{ id: ctf, answer: { choices: ["A"] }, revision: null }],
      })
    ).statusCode,
    400,
  );
  paper = await ok();
  const answers = paper.items.map((q: any) => ({
    id: q.id,
    answer: q.id === blank ? { blanks: { a: "test-secret" } } : q.saved.answer,
    revision: q.saved.revision,
  }));
  const replies = await Promise.all([
    ok(alice, { finalize: true, answers }),
    ok(mate, { finalize: true, answers }),
  ]);
  for (const reply of replies) {
    assert.deepEqual(reply.items.find((q: any) => q.id === multiple).review, {
      choices: ["A", "B"],
    });
  }
  const result = await ok();
  assert.deepEqual(
    result.items.find((q: any) => q.id === single).saved.review,
    { choices: ["A"] },
  );
  assert.deepEqual(
    result.items.find((q: any) => q.id === multiple).saved.review,
    { choices: ["A", "B"] },
  );
  assert.deepEqual(result.items.find((q: any) => q.id === blank).saved.review, {
    blanks: { a: true },
  });
  const legacyRead = await app.inject({
    url: `/api/challenges/${multiple}/answer?scope=${scope}`,
    headers: { cookie: mate.cookie },
  });
  assert.equal(legacyRead.statusCode, 200);
  assert.deepEqual(legacyRead.json().review, { choices: ["A", "B"] });
  await db.query(
    "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
    [scope, outsider.team],
  );
  assert(
    (await ok(outsider)).items.every((q: any) => q.saved.review === null),
    "another team's submission does not reveal answers",
  );
  assert.equal(result.items.filter((q: any) => q.saved.correct).length, 2);
  assert(result.items.every((q: any) => q.saved.finalized_at));
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM submissions WHERE scope=$1", [
        scope,
      ])
    )[0]!.n,
    3,
    "duplicate whole-paper submits do not duplicate scoring",
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM solves WHERE scope=$1", [
        scope,
      ])
    )[0]!.n,
    2,
  );
  await db.query("UPDATE contests SET timing=$2 WHERE id=$1", [
    scope,
    JSON.stringify({
      objective: {
        mode: "fixed",
        opens_at: new Date(Date.now() - 60000).toISOString(),
        closes_at: new Date(Date.now() - 1000).toISOString(),
      },
    }),
  ]);
  assert.equal((await ok()).can_submit, false);
  assert.equal((await req(alice, { finalize: true, answers })).statusCode, 403);
  await db.query(
    "UPDATE contests SET ends_at=now()-interval '1 second',practice_mode=true WHERE id=$1",
    [scope],
  );
  paper = await ok();
  assert(paper.practice && paper.can_submit);
  assert(
    paper.items.every(
      (q: any) => q.saved.revision === null && q.saved.review === null,
    ),
  );
  const practice = paper.items.map((q: any) => ({
    id: q.id,
    answer: {},
    revision: null,
  }));
  const firstPractice = await ok(alice, { finalize: true, answers: practice });
  paper = await ok();
  assert.equal(paper.can_submit, false);
  const repeatedPractice = await ok(alice, {
    finalize: true,
    answers: paper.items.map((q: any) => ({
      id: q.id,
      answer: q.id === single ? { choices: ["A"] } : {},
      revision: q.saved.revision,
    })),
  });
  assert.deepEqual(
    repeatedPractice.items,
    firstPractice.items,
    "post-contest retry cannot change a finalized answer",
  );
  const draftAfterFinal = await ok(mate, {
    finalize: false,
    answers: [{ id: single, answer: { choices: ["A"] }, revision: null }],
  });
  assert.deepEqual(
    draftAfterFinal.items[0],
    firstPractice.items.find((q: any) => q.id === single),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM submissions WHERE scope=$1 AND contest_practice",
        [scope],
      )
    )[0]!.n,
    3,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM solves WHERE scope=$1 AND contest_practice",
        [scope],
      )
    )[0]!.n,
    0,
  );
  await db.query("UPDATE challenges SET practice=true WHERE id=$1", [single]);
  const standalone = (answer: unknown, finalize: boolean) =>
    app.inject({
      url: `/api/challenges/${single}/answer`,
      method: "POST",
      headers: {
        cookie: alice.cookie,
        origin: config.APP_ORIGIN,
        "x-csrf-protection": "1",
      },
      payload: { scope: "practice", answer, finalize },
    });
  const concurrent = await Promise.all([
    standalone({ choices: ["A"] }, true),
    standalone({ choices: ["B"] }, true),
  ]);
  concurrent.forEach((r) => assert.equal(r.statusCode, 200, r.body));
  assert.deepEqual(
    concurrent[0]!.json(),
    concurrent[1]!.json(),
    "concurrent practice submissions share the first result",
  );
  assert.equal(concurrent[0]!.json().practice, true);
  const immutable = concurrent[0]!.json();
  for (const finalize of [false, true]) {
    const retry = await standalone({}, finalize);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), immutable);
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM submissions WHERE scope='practice' AND challenge_id=$1 AND user_id=$2",
        [single, alice.id],
      )
    )[0]!.n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM solves WHERE scope=$1 AND NOT contest_practice",
        [scope],
      )
    )[0]!.n,
    2,
  );
  await db.query(
    "UPDATE contests SET ends_at=now()+interval '1 hour',practice_mode=false,timing=$2 WHERE id=$1",
    [
      scope,
      JSON.stringify({
        objective: {
          mode: "flexible",
          opens_at: new Date(Date.now() - 60000).toISOString(),
          closes_at: new Date(Date.now() + 3600000).toISOString(),
          duration_seconds: 600,
        },
      }),
    ],
  );
  paper = await ok();
  assert.equal(paper.phase.status, "ready");
  assert.equal(
    paper.items.length,
    0,
    "a section must be started before the paper is exposed",
  );
});

test("objective item review respects normalization and never exposes accepted blank answers", () => {
  const definition = objectiveInput.parse({
    type: "blank",
    case_sensitive: false,
    trim: true,
    blanks: [
      { id: "a", label: "one", answers: ["Secret"] },
      { id: "b", label: "two", answers: ["Other"] },
    ],
  });
  const review = objectiveReview(definition, {
    blanks: { a: "  SECRET ", b: "wrong" },
  });
  assert.deepEqual(review, { blanks: { a: true, b: false } });
  assert.deepEqual(objectiveReview(definition, {}), {
    blanks: { a: false, b: false },
  });
  assert(!JSON.stringify(review).includes("Secret"));
  assert.deepEqual(
    objectiveReview(
      { ...definition, case_sensitive: true },
      { blanks: { a: "secret" } },
    ),
    { blanks: { a: false, b: false } },
  );
});
