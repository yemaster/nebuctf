import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, flagHash } from "../src/security.js";
import { hintDefinitions } from "../src/hint-rules.js";
import { challengeInput, contestInput } from "../src/schemas.js";

test(
  "team hint unlocks, disclosure and score accounting",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    const scope = crypto.randomUUID(),
      cid = crypto.randomUUID(),
      other = crypto.randomUUID();
    const h = [0, 1, 2].map((i) => ({
      id: crypto.randomUUID(),
      content: `PRIVATE hint ${i}`,
    }));
    const parts = [crypto.randomUUID(), crypto.randomUUID()];
    async function actor(role = "user", existingTeam?: string) {
      const id = crypto.randomUUID(),
        team = existingTeam ?? crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "hint" + id.slice(0, 12), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      if (!existingTeam)
        await db.query(
          "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
          [team, team, id, team],
        );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const a = await actor(),
      b = await actor("user", a.team),
      c = await actor(),
      admin = await actor("admin"),
      outsider = await actor();
    const request = (
      path: string,
      user?: typeof a,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: body === undefined ? "GET" : method,
        headers: {
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
          ...(user ? { cookie: user.cookie } : {}),
        },
        payload: body as any,
      });
    async function ok(
      path: string,
      user?: typeof a,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) {
      const r = await request(path, user, body, method);
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    }
    await db.query(
      "INSERT INTO contests(id,title,starts_at,ends_at,published,hint_policy,hint_overrides) VALUES($1,'Hints',now()-interval '1 hour',now()+interval '1 hour',true,$2,$3)",
      [
        scope,
        JSON.stringify({ mode: "fixed", points: 25 }),
        JSON.stringify([
          {
            challenge_id: cid,
            hint_id: h[1]!.id,
            policy: { mode: "factor", factor: 0.8 },
          },
          {
            challenge_id: cid,
            hint_id: h[2]!.id,
            policy: { mode: "factor", factor: 0.5 },
          },
        ]),
      ],
    );
    for (const user of [a, c])
      await db.query(
        "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
        [scope, user.team],
      );
    for (const id of [cid, other]) {
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice,dynamic_score,initial_points,minimum_points,hints) VALUES($1,$2,'Web','入门','static_attachment',$3,true,true,false,100,10,$4)",
        [id, id, flagHash("flag{other}"), JSON.stringify(h)],
      );
      await db.query(
        "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
        [scope, id],
      );
    }
    for (const [i, id] of parts.entries())
      await db.query(
        "INSERT INTO challenge_parts(id,challenge_id,title,position,flag_hash,initial_points,minimum_points) VALUES($1,$2,$3,$4,$5,$6,10)",
        [id, cid, "Part " + i, i, flagHash("flag{" + i + "}"), (i + 1) * 100],
      );
    const detail = (user = a, challenge = cid, context = scope) =>
      ok(`/challenges/${challenge}?scope=${context}`, user);
    const unlock = async (
      index: number,
      user = a,
      confirmed = true,
      quote?: string,
    ) =>
      request(`/challenges/${cid}/hints/${h[index]!.id}/unlock`, user, {
        scope,
        quote: quote ?? (await detail(user)).hints[index].quote,
        confirmed,
      });
    const board = () => ok(`/scoreboard?scope=${scope}`, a);
    const team = async (user = a) =>
      (await board()).items.find((r: any) => r.id === user.team);
    const solve = (flag: string, challenge = cid, user = a) =>
      ok(`/challenges/${challenge}/submit`, user, { scope, flag });
    await t.test(
      "locked bodies never appear in catalog or detail and require confirmation",
      async () => {
        const d = await detail();
        assert.equal(d.hints.length, 3);
        assert.equal(d.hints[0].content, undefined);
        assert.equal(d.hints[1].policy.factor, 0.8);
        assert.ok(
          !(await request(`/challenges?scope=${scope}`, a)).body.includes(
            "PRIVATE",
          ),
        );
        assert.ok(
          !(
            await request(`/challenges/${cid}?scope=${scope}`, a)
          ).body.includes("PRIVATE"),
        );
        assert.equal((await unlock(0, a, false)).statusCode, 400);
        assert.equal(
          (await request(`/challenges/${cid}?scope=${scope}`, outsider))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await request(
              `/challenges/${cid}/hints/${h[0]!.id}/unlock`,
              undefined,
              { scope, quote: d.hints[0].quote, confirmed: true },
            )
          ).statusCode,
          401,
        );
        assert.equal((await detail(admin)).hints[0].content, h[0]!.content);
        assert.equal(
          (await detail(a, cid, "practice")).hints[0].policy.mode,
          "free",
        );
      },
    );
    await solve("flag{0}");
    await solve("flag{other}", other);
    const beforeUnlock = new Date();
    await t.test(
      "concurrent team members buy once and an administrator who competes pays normally",
      async () => {
        const quote = (await detail()).hints[0].quote;
        const results = await Promise.all([
          unlock(0, a, true, quote),
          unlock(0, b, true, quote),
        ]);
        results.forEach((r) => assert.equal(r.statusCode, 200, r.body));
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM hint_unlocks WHERE contest_id=$1",
              [scope],
            )
          )[0]!.n,
          1,
        );
        assert.equal((await team()).score, 175);
        assert.equal((await detail(b)).hints[0].content, h[0]!.content);
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [c.id]);
        assert.equal((await detail(c)).hints[0].unlocked, false);
        assert.equal((await unlock(0, c)).statusCode, 200);
        assert.equal((await team(c)).score, -25);
      },
    );
    await t.test(
      "multipliers affect existing and future parts with consistent cells and timeline deductions",
      async () => {
        assert.equal((await unlock(1)).statusCode, 200);
        assert.equal((await team()).score, 155);
        assert.equal((await unlock(2)).statusCode, 200);
        assert.equal((await team()).score, 115);
        await solve("flag{1}");
        assert.equal((await team()).score, 195);
        const r = await ok(`/scoreboard/${a.team}?scope=${scope}`, a);
        assert.equal(r.hint_cost, 25);
        assert.equal(r.hint_deductions.length, 3);
        assert.equal(
          r.cells.reduce((n: number, c: any) => n + c.score, 0) - r.hint_cost,
          r.score,
        );
        assert.equal(
          r.members.reduce((n: number, m: any) => n + m.score, 0) +
            r.team_points -
            r.hint_cost,
          r.score,
        );
        assert.equal(
          r.categories.reduce((n: number, c: any) => n + c.score, 0) -
            r.hint_cost,
          r.score,
        );
        const line = (await board()).timeline.find((r: any) => r.id === a.team);
        assert.equal(line.points.at(-1).score, r.score);
        const scores = line.points.map((p: any) => p.score);
        assert.ok(
          scores.includes(175) && scores.includes(155) && scores.includes(115),
          JSON.stringify(scores),
        );
      },
    );
    await t.test(
      "freeze excludes later charges and factor changes while private unlocked hints stay accessible",
      async () => {
        await db.query("UPDATE contests SET freeze_at=$2 WHERE id=$1", [
          scope,
          beforeUnlock.toISOString(),
        ]);
        assert.equal((await team()).score, 200);
        const r = await ok(`/scoreboard/${a.team}?scope=${scope}`, a);
        assert.equal(r.hint_deductions.length, 0);
        assert.equal(r.hint_cost, 0);
        assert.equal((await detail()).hints[0].content, h[0]!.content);
        await db.query("UPDATE contests SET freeze_at=NULL WHERE id=$1", [
          scope,
        ]);
      },
    );
    await t.test(
      "changed quotes require reconfirmation and bought policies are immutable",
      async () => {
        const quote = (await detail(c)).hints[1].quote;
        await db.query(
          'UPDATE contests SET hint_policy=\'{"mode":"fixed","points":100}\',hint_overrides=\'[]\' WHERE id=$1',
          [scope],
        );
        assert.equal((await unlock(1, c, true, quote)).statusCode, 409);
        assert.equal((await detail()).hints[0].policy.points, 25);
        assert.equal((await detail()).hints[1].policy.factor, 0.8);
        assert.equal((await unlock(0)).statusCode, 200);
        assert.equal((await team()).score, 195);
      },
    );
    await t.test(
      "round credits, losses and dynamic recalculation reconcile with hint factors",
      async () => {
        const roundChallenge = crypto.randomUUID(),
          dynamic = crypto.randomUUID();
        for (const [id, isDynamic] of [
          [roundChallenge, false],
          [dynamic, true],
        ] as const) {
          await db.query(
            "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,dynamic_score,initial_points,minimum_points,decay,hints) VALUES($1,$2,'Web','入门','static_attachment',$3,true,$4,200,20,2,$5)",
            [id, id, flagHash("flag{extra}"), isDynamic, JSON.stringify(h)],
          );
          await db.query(
            "INSERT INTO contest_challenges(contest_id,challenge_id,scoring) VALUES($1,$2,$3)",
            [
              scope,
              id,
              JSON.stringify(
                isDynamic ? { mode: "inherit" } : { mode: "round" },
              ),
            ],
          );
        }
        await db.query("UPDATE contests SET hint_overrides=$2 WHERE id=$1", [
          scope,
          JSON.stringify(
            [roundChallenge, dynamic].map((challenge_id) => ({
              challenge_id,
              hint_id: h[0]!.id,
              policy: { mode: "factor", factor: 0.8 },
            })),
          ),
        ]);
        for (const [i, points] of [101, -20].entries()) {
          const rid = crypto.randomUUID();
          await db.query(
            "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,status,settings) VALUES($1,$2,$3,$4,now()-interval '10 minutes',now()-interval '5 minutes','settled','{}')",
            [rid, scope, roundChallenge, i + 1],
          );
          await db.query(
            "INSERT INTO round_results(id,round_id,owner_key,unit_id,points,details) VALUES($1,$2,$3,$4,$5,$6)",
            [
              crypto.randomUUID(),
              rid,
              "t:" + a.team,
              roundChallenge,
              points,
              JSON.stringify(
                i === 0
                  ? {
                      members: [{ user_id: a.id, points: 61 }],
                      team_points: 40,
                    }
                  : { members: [], team_points: -20 },
              ),
            ],
          );
        }
        const purchase = async (challenge: string) => {
          const hint = (await detail(a, challenge)).hints[0];
          await ok(`/challenges/${challenge}/hints/${hint.id}/unlock`, a, {
            scope,
            quote: hint.quote,
            confirmed: true,
          });
        };
        await purchase(roundChallenge);
        assert.equal((await team()).score, 255);
        assert.equal(
          (await ok(`/challenges/${roundChallenge}/rounds?scope=${scope}`, a))
            .total,
          60,
        );
        const detailRound = await ok(`/scoreboard/${a.team}?scope=${scope}`, a);
        assert.deepEqual(
          detailRound.cells
            .filter((v: any) => v.unit_id === roundChallenge)
            .map((v: any) => v.score),
          [80, -20],
        );
        assert.equal(
          detailRound.members.reduce((n: number, m: any) => n + m.score, 0) +
            detailRound.team_points -
            detailRound.hint_cost,
          detailRound.score,
        );
        await purchase(dynamic);
        await solve("flag{extra}", dynamic);
        assert.equal((await team()).score, 379);
        await solve("flag{extra}", dynamic, c);
        assert.equal((await team()).score, 271);
        const r = await board();
        assert.equal(
          r.timeline.find((v: any) => v.id === a.team).points.at(-1).score,
          271,
        );
      },
    );
    await t.test(
      "admin editing preserves hint identities while changing content and order",
      async () => {
        const draft = await ok("/admin/challenges", admin, {
          title: "Hint edit",
          category: "Web",
          difficulty: "入门",
          flag: "flag{draft}",
          hints: ["first", "second"],
        });
        const original = await ok(`/admin/challenges/${draft.id}`, admin);
        assert.equal(original.hints.length, 2);
        assert.ok(original.hints[0].id);
        await ok(
          `/admin/challenges/${draft.id}`,
          admin,
          {
            ...original,
            hints: [
              original.hints[1],
              { ...original.hints[0], content: "edited" },
            ],
          },
          "PUT",
        );
        const edited = await ok(`/admin/challenges/${draft.id}`, admin);
        assert.deepEqual(
          edited.hints.map((v: any) => v.id),
          [original.hints[1].id, original.hints[0].id],
        );
        assert.equal(edited.hints[1].content, "edited");
      },
    );
    await t.test(
      "contest hint settings persist and objective papers do not disclose locked hints",
      async () => {
        const input = {
          title: "Hint configuration",
          starts_at: new Date(Date.now() + 3600000).toISOString(),
          ends_at: new Date(Date.now() + 7200000).toISOString(),
          challenge_ids: [cid],
          hint_policy: { mode: "factor", factor: 0.75 },
          hint_overrides: [
            {
              challenge_id: cid,
              hint_id: h[0]!.id,
              policy: { mode: "fixed", points: 30 },
            },
          ],
        };
        const draft = await ok("/admin/contests", admin, input);
        const saved = await ok(`/admin/contests/${draft.id}`, admin);
        assert.deepEqual(saved.hint_policy, input.hint_policy);
        assert.deepEqual(saved.hint_overrides, input.hint_overrides);
        const { hint_policy: _, hint_overrides: __, ...withoutHints } = input;
        await ok(`/admin/contests/${draft.id}`, admin, withoutHints, "PUT");
        assert.deepEqual(
          (await ok(`/admin/contests/${draft.id}`, admin)).hint_overrides,
          input.hint_overrides,
        );
        const objective = crypto.randomUUID();
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,challenge_type,flag_hash,published,objective,hints) VALUES($1,'Objective hint','Misc','入门','static_attachment','objective','',true,$2,$3)",
          [
            objective,
            JSON.stringify({
              type: "single",
              options: [
                { id: "a", text: "A" },
                { id: "b", text: "B" },
              ],
              correct_options: ["a"],
              blanks: [],
              case_sensitive: false,
              trim: true,
            }),
            JSON.stringify(h),
          ],
        );
        await db.query(
          "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
          [scope, objective],
        );
        const paper = await ok(`/contests/${scope}/objective-paper`, a);
        const hint = paper.items.find((q: any) => q.id === objective).hints[0];
        assert.equal(hint.content, undefined);
        assert.equal(hint.policy.points, 100);
        await ok(`/challenges/${objective}/hints/${hint.id}/unlock`, a, {
          scope,
          quote: hint.quote,
          confirmed: true,
        });
        assert.equal(
          (await ok(`/contests/${scope}/objective-paper`, b)).items.find(
            (q: any) => q.id === objective,
          ).hints[0].content,
          h[0]!.content,
        );
      },
    );
    await t.test(
      "practice, hidden questions and finished phases cannot create paid purchases",
      async () => {
        await db.query(
          "UPDATE contest_challenges SET published=false WHERE contest_id=$1 AND challenge_id=$2",
          [scope, cid],
        );
        assert.equal(
          (await unlock(1, a, true, "x".repeat(64))).statusCode,
          404,
        );
        await db.query(
          "UPDATE contest_challenges SET published=true WHERE contest_id=$1 AND challenge_id=$2",
          [scope, cid],
        );
        await db.query(
          "UPDATE contests SET ends_at=now()-interval '1 second',practice_mode=true WHERE id=$1",
          [scope],
        );
        assert.equal((await detail(c)).hints[1].content, h[1]!.content);
        assert.equal(
          (await unlock(1, c, true, "x".repeat(64))).statusCode,
          200,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM hint_unlocks WHERE contest_id=$1 AND owner_key=$2",
              [scope, "t:" + c.team],
            )
          )[0]!.n,
          1,
        );
      },
    );
  },
);

test("hint identities and validated policies survive edits and reordering", () => {
  const id = crypto.randomUUID(),
    legacy = { id, hints: ["one", "two"] };
  const defs = hintDefinitions(legacy);
  assert.deepEqual(defs, hintDefinitions(legacy));
  assert.deepEqual(
    hintDefinitions({
      id,
      hints: [defs[1]!, { ...defs[0]!, content: "edited" }],
    }).map((h) => h.id),
    [defs[1]!.id, defs[0]!.id],
  );
  assert.equal(
    challengeInput.safeParse({
      title: "x",
      category: "Web",
      hints: [defs[0], defs[0]],
    }).success,
    false,
  );
  const base = {
    title: "x",
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 10000).toISOString(),
  };
  for (const policy of [
    { mode: "factor", factor: 0 },
    { mode: "factor", factor: 1 },
    { mode: "factor", factor: 0.123 },
    { mode: "fixed", points: -1 },
    { mode: "fixed", points: 1.5 },
  ])
    assert.equal(
      contestInput.safeParse({ ...base, hint_policy: policy }).success,
      false,
    );
});
