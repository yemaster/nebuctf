import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile, mkdtemp, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, dynamicFlag, flagHash } from "../src/security.js";
import { objectiveInput, gradeObjective } from "../src/challenge-model.js";
import { contestScoringInput } from "../src/competition-rules.js";
import { ensureRound, tickRounds } from "../src/rounds.js";
import { AwdWorker } from "../src/awd-worker.js";
import { makeTar, readPatch, patchContext } from "../src/patch-archive.js";

test("objective grading and bounded patch archives", () => {
  const single = objectiveInput.parse({
    type: "single",
    options: [
      { id: "A", text: "Alpha" },
      { id: "B", text: "Beta" },
    ],
    correct_options: ["B"],
  });
  assert(gradeObjective(single, { choices: ["B"] }));
  assert(!gradeObjective(single, { choices: ["B", "B"] }));
  const multiple = objectiveInput.parse({
    ...single,
    type: "multiple",
    correct_options: ["A", "B"],
  });
  assert(gradeObjective(multiple, { choices: ["B", "A"] }));
  assert(!gradeObjective(multiple, { choices: ["A"] }));
  const blank = objectiveInput.parse({
    type: "blank",
    blanks: [{ id: "x", label: "X", answers: ["hello", "您好"] }],
    case_sensitive: false,
  });
  assert(gradeObjective(blank, { blanks: { x: " Hello " } }));
  assert(!gradeObjective(blank, { blanks: { x: "hello", extra: "x" } }));
  assert(
    !objectiveInput.safeParse({ ...single, correct_options: ["C"] }).success,
  );
  const files = [
    {
      name: "src/app.py",
      data: Buffer.from('print("hello")'),
      executable: true,
    },
  ];
  assert.deepEqual(readPatch(makeTar(files)), files);
  assert.deepEqual(readPatch(gzipSync(makeTar(files))), files);
  assert.throws(() =>
    readPatch(makeTar([{ ...files[0]!, name: "../escape" }])),
  );
  assert.throws(() => readPatch(makeTar([files[0]!, files[0]!])));
  assert.throws(() => readPatch(Buffer.alloc(2048)));
  const context = readPatch(patchContext("sha256:abc", "/app", files));
  assert.equal(context[0]!.name, "Dockerfile");
  assert(!context[0]!.data.toString().includes("RUN"));
  assert(
    !contestScoringInput.safeParse({
      mode: "round",
      points: { initial_points: 50, minimum_points: 100, decay: 5 },
    }).success,
  );
});

test("mixed contest questions, scoped scores, clocks, objectives, rounds and AWD", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const stamp = crypto.randomUUID().slice(0, 8);
  async function user(role = "user") {
    const id = crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
      [id, role + id.slice(0, 8), id + "@example.test", role],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), id],
    );
    return { id, cookie: `${sessionCookie}=${token}` };
  }
  const admin = await user("admin"),
    alice = await user(),
    bob = await user();
  const req = (
    path: string,
    actor = alice,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) =>
    app.inject({
      url: "/api" + path,
      method: body === undefined ? "GET" : method,
      headers: {
        cookie: actor.cookie,
        origin: config.APP_ORIGIN,
        "x-csrf-protection": "1",
      },
      payload: body as any,
    });
  const ok = async (
    path: string,
    actor = alice,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) => {
    const r = await req(path, actor, body, method);
    assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
    return r.json();
  };
  async function team(actor: typeof alice) {
    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
      [id, "Mode " + id, actor.id, id],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      actor.id,
      id,
    ]);
    return id;
  }
  const ta = await team(alice),
    tb = await team(bob);
  const profile = {
    image: "nebuctf/modes:1",
    cpu: 100,
    memory: 64,
    ttl: 600,
    mode: "private",
    access_mode: "port",
    port: 8080,
  };
  const base = {
    title: "Modes " + stamp,
    category: "Web",
    difficulty: "入门",
    published: true,
    practice: false,
    flag: "flag{example}",
    initial_points: 100,
    minimum_points: 10,
    decay: 10,
    dynamic_score: false,
  };
  const ctf = await ok("/admin/challenges", admin, base),
    roundCtf = await ok("/admin/challenges", admin, {
      ...base,
      title: "Round " + stamp,
    });
  const objective = await ok("/admin/challenges", admin, {
    ...base,
    challenge_type: "objective",
    flag: undefined,
    objective: {
      type: "single",
      options: [
        { id: "A", text: "first" },
        { id: "B", text: "second" },
      ],
      correct_options: ["B"],
    },
  });
  const awdp = await ok("/admin/challenges", admin, {
    ...base,
    flag: undefined,
    challenge_type: "awdp",
    flag_mode: "dynamic",
    resources: { container: profile, attachment: null },
    patch_config: { checker_image: "nebuctf/checker:1" },
    dynamic_score: true,
    parts: [
      {
        title: "攻击",
        role: "attack",
        initial_points: 300,
        minimum_points: 30,
      },
      {
        title: "防守",
        role: "defense",
        initial_points: 200,
        minimum_points: 20,
      },
    ],
  });
  const awd = await ok("/admin/challenges", admin, {
    ...base,
    flag: undefined,
    challenge_type: "awd",
    flag_mode: "dynamic",
    resources: { container: profile, attachment: null },
    patch_config: { checker_image: "nebuctf/checker:1" },
    awd_config: { checker_image: "nebuctf/checker:1" },
  });
  const points = { initial_points: 250, minimum_points: 25, decay: 5 };
  const roundSettings = contestScoringInput.parse({
    mode: "round",
    points: { ...points, initial_points: 50 },
    round: { interval: 60, carry: true, dynamic: false },
  });
  const starts = new Date(Date.now() + 600000).toISOString(),
    ends = new Date(Date.now() + 3600000).toISOString();
  const contest = await ok("/admin/contests", admin, {
    title: "Mixed " + stamp,
    round_duration: 60,
    published: true,
    starts_at: starts,
    ends_at: ends,
    challenge_ids: [ctf.id, roundCtf.id, objective.id, awdp.id, awd.id],
    challenge_settings: [
      { challenge_id: ctf.id, scoring: { mode: "fixed", points } },
      { challenge_id: roundCtf.id, scoring: roundSettings },
      {
        challenge_id: objective.id,
        scoring: { mode: "fixed", points: { ...points, initial_points: 80 } },
      },
      {
        challenge_id: awd.id,
        scoring: {
          ...roundSettings,
          points: { initial_points: 100, minimum_points: 10, decay: 10 },
        },
      },
    ],
  });
  const other = await ok("/admin/contests", admin, {
    title: "Independent " + stamp,
    published: true,
    starts_at: starts,
    ends_at: ends,
    challenge_ids: [ctf.id],
    challenge_settings: [
      {
        challenge_id: ctf.id,
        scoring: { mode: "fixed", points: { ...points, initial_points: 777 } },
      },
    ],
  });
  for (const cid of [contest.id, other.id]) {
    await ok(`/contests/${cid}/register`, alice, { team_id: ta });
    await ok(`/contests/${cid}/register`, bob, { team_id: tb });
    await db.query(
      "UPDATE contests SET starts_at=now()-interval '5 minutes' WHERE id=$1",
      [cid],
    );
    await db.query(
      "UPDATE registrations SET created_at=now()-interval '10 minutes' WHERE contest_id=$1",
      [cid],
    );
  }
  await t.test(
    "one contest freely mixes question types and score overrides never mutate the bank",
    async () => {
      const detail = await ok(`/admin/contests/${contest.id}`, admin);
      assert.equal(detail.challenge_ids.length, 5);
      assert.equal(
        (await ok(`/challenges/${ctf.id}?scope=${contest.id}`)).points,
        250,
      );
      assert.equal(
        (await ok(`/challenges/${ctf.id}?scope=${other.id}`)).points,
        777,
      );
      assert.equal(
        (await ok(`/admin/challenges/${ctf.id}`, admin)).initial_points,
        100,
      );
      await ok(`/challenges/${ctf.id}/submit`, alice, {
        scope: contest.id,
        flag: "flag{example}",
      });
      await ok(`/challenges/${ctf.id}/submit`, alice, {
        scope: other.id,
        flag: "flag{example}",
      });
      assert.equal(
        (await ok(`/scoreboard?scope=${contest.id}`)).items.find(
          (r: any) => r.id === ta,
        ).score,
        250,
      );
      assert.equal(
        (await ok(`/scoreboard?scope=${other.id}`)).items.find(
          (r: any) => r.id === ta,
        ).score,
        777,
      );
    },
  );
  await t.test(
    "release is scoped to one contest and all question endpoints honor it",
    async () => {
      await db.query(
        "UPDATE contest_challenges SET release_at=now()+interval '10 minutes' WHERE contest_id=$1 AND challenge_id=$2",
        [contest.id, ctf.id],
      );
      assert.equal(
        (await req(`/challenges/${ctf.id}?scope=${contest.id}`)).statusCode,
        404,
      );
      assert(
        !(await ok(`/challenges?scope=${contest.id}`)).items.some(
          (c: any) => c.id === ctf.id,
        ),
      );
      assert(
        !(await ok(`/scoreboard?scope=${contest.id}`)).columns.some(
          (c: any) => c.challenge_id === ctf.id,
        ),
      );
      assert.equal(
        (await ok(`/challenges/${ctf.id}?scope=${other.id}`)).points,
        777,
      );
      await db.query(
        "UPDATE contest_challenges SET release_at=NULL WHERE contest_id=$1 AND challenge_id=$2",
        [contest.id, ctf.id],
      );
    },
  );
  await t.test(
    "team-shared flexible clocks are idempotent and gate question access and submissions",
    async () => {
      const timing = {
        objective: {
          mode: "flexible",
          opens_at: new Date(Date.now() - 60000).toISOString(),
          closes_at: ends,
          duration_seconds: 120,
        },
      };
      await db.query("UPDATE contests SET timing=$2 WHERE id=$1", [
        contest.id,
        JSON.stringify(timing),
      ]);
      assert.equal(
        (await req(`/challenges/${objective.id}?scope=${contest.id}`))
          .statusCode,
        403,
      );
      const [a, b] = await Promise.all([
        ok(`/contests/${contest.id}/start/objective`, alice, {}),
        ok(`/contests/${contest.id}/start/objective`, alice, {}),
      ]);
      assert.equal(a.deadline_at, b.deadline_at);
      const exposed = await ok(
        `/challenges/${objective.id}?scope=${contest.id}`,
      );
      assert(!JSON.stringify(exposed).includes("correct_options"));
      assert.equal(exposed.points, 80);
      const draft = await ok(`/challenges/${objective.id}/answer`, alice, {
        scope: contest.id,
        answer: { choices: ["B"] },
      });
      assert.equal(draft.correct, null);
      const final = await ok(`/challenges/${objective.id}/answer`, alice, {
        scope: contest.id,
        answer: { choices: ["B"] },
        finalize: true,
      });
      assert.equal(final.correct, true);
      const duplicate = await ok(`/challenges/${objective.id}/answer`, alice, {
        scope: contest.id,
        answer: { choices: ["A"] },
        finalize: true,
      });
      assert.equal(duplicate.correct, true);
      assert.deepEqual(duplicate.answer.choices, ["B"]);
      await db.query(
        "UPDATE contest_attempts SET started_at=now()-interval '3 minutes',deadline_at=now()-interval '1 minute' WHERE contest_id=$1",
        [contest.id],
      );
      assert.equal(
        (
          await req(`/challenges/${objective.id}/answer`, alice, {
            scope: contest.id,
            answer: { choices: ["B"] },
            finalize: true,
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "AWDP attack cannot credit its defense and part overrides affect both detail and ranks",
    async () => {
      const c = await ok(`/admin/challenges/${awdp.id}`, admin),
        attack = c.parts.find((p: any) => p.role === "attack"),
        defense = c.parts.find((p: any) => p.role === "defense");
      await db.query(
        "UPDATE contest_challenges SET scoring=$3 WHERE contest_id=$1 AND challenge_id=$2",
        [
          contest.id,
          awdp.id,
          JSON.stringify({
            mode: "fixed",
            points,
            parts: [
              { id: attack.id, points: { ...points, initial_points: 333 } },
              { id: defense.id, points: { ...points, initial_points: 222 } },
            ],
          }),
        ],
      );
      const submitted = await ok(`/challenges/${awdp.id}/submit`, alice, {
        scope: contest.id,
        flag: dynamicFlag(awdp.id, contest.id, "t:" + ta, attack.id),
      });
      assert.equal(submitted.completed, false);
      const rejected = await ok(`/challenges/${awdp.id}/submit`, alice, {
        scope: contest.id,
        flag: dynamicFlag(awdp.id, contest.id, "t:" + ta, defense.id),
      });
      assert.equal(rejected.correct, false);
      const publicC = await ok(`/challenges/${awdp.id}?scope=${contest.id}`);
      assert.equal(publicC.points, 555);
      assert.equal(publicC.earned_points, 333);
    },
  );
  await t.test(
    "patch upload validates archives, stores privately and enforces team cooldown",
    async () => {
      const previous = config.DATA_DIR,
        dir = await mkdtemp(join(tmpdir(), "nebuctf-patch-api-"));
      config.DATA_DIR = dir;
      const upload = (
        data: Buffer,
        actor = alice,
        origin = config.APP_ORIGIN,
      ) => {
        const boundary = "patch-upload-boundary";
        return app.inject({
          method: "POST",
          url: `/api/challenges/${awdp.id}/patches?scope=${contest.id}`,
          headers: {
            cookie: actor.cookie,
            origin,
            "x-csrf-protection": "1",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload: Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="patch.tar"\r\nContent-Type: application/x-tar\r\n\r\n`,
            ),
            data,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]),
        });
      };
      const archive = makeTar([
        {
          name: "settings.py",
          data: Buffer.from("safe = True"),
          executable: false,
        },
      ]);
      try {
        assert.equal(
          (await upload(archive, alice, "https://untrusted.example"))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await upload(
              makeTar([
                {
                  name: "../escape",
                  data: Buffer.from("x"),
                  executable: false,
                },
              ]),
            )
          ).statusCode,
          400,
        );
        const accepted = await upload(archive);
        assert.equal(accepted.statusCode, 200, accepted.body);
        const job = accepted.json();
        const path = join(dir, "patches", job.id);
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        assert.deepEqual(await readFile(path), archive);
        const own = await ok(
          `/challenges/${awdp.id}/patches?scope=${contest.id}`,
        );
        assert.equal(own.items[0].status, "queued");
        assert(!("patch_id" in own.items[0]));
        assert(!("spec" in own.items[0]));
        assert.equal(
          (await ok(`/challenges/${awdp.id}/patches?scope=${contest.id}`, bob))
            .items.length,
          0,
        );
        assert.equal((await upload(archive)).statusCode, 429);
        assert.equal((await readdir(join(dir, "patches"))).length, 1);
      } finally {
        await db.query("DELETE FROM judge_jobs WHERE challenge_id=$1", [
          awdp.id,
        ]);
        await rm(dir, { recursive: true, force: true });
        config.DATA_DIR = previous;
      }
    },
  );
  await t.test(
    "round ledger settles once and excludes ordinary solve points from ranks",
    async () => {
      await ok(`/challenges/${roundCtf.id}/submit`, alice, {
        scope: contest.id,
        flag: "flag{example}",
      });
      await db.query(
        "UPDATE solves SET created_at=now()-interval '4 minutes' WHERE challenge_id=$1 AND scope=$2",
        [roundCtf.id, contest.id],
      );
      await tickRounds(db);
      const rows = await db.query(
        "SELECT s.* FROM round_results s JOIN contest_rounds r ON r.id=s.round_id WHERE r.contest_id=$1 AND r.challenge_id=$2",
        [contest.id, roundCtf.id],
      );
      assert(rows.length >= 3);
      assert(rows.every((r) => r.points === 50));
      await tickRounds(db);
      assert.equal(
        (
          await db.query(
            "SELECT s.* FROM round_results s JOIN contest_rounds r ON r.id=s.round_id WHERE r.contest_id=$1 AND r.challenge_id=$2",
            [contest.id, roundCtf.id],
          )
        ).length,
        rows.length,
      );
      const board = await ok(`/scoreboard?scope=${contest.id}`),
        aliceRow = board.items.find((r: any) => r.id === ta);
      assert.equal(aliceRow.score, 250 + 80 + 333 + rows.length * 50);
      assert.equal(
        aliceRow.cells.filter((c: any) => c.unit_id === roundCtf.id).length,
        1,
      );
      assert.equal(
        aliceRow.cells.find((c: any) => c.unit_id === roundCtf.id).score,
        rows.length * 50,
      );
      const detail = await ok(`/scoreboard/${ta}?scope=${contest.id}`);
      assert.equal(
        detail.cells.filter((c: any) => c.round_number).length,
        rows.length,
      );
    },
  );
  await t.test(
    "AWD rejects own, expired and duplicate flags; settlement records attack, defense and availability",
    async () => {
      const [ct] = await db.query("SELECT * FROM contests WHERE id=$1", [
          contest.id,
        ]),
        [link] = await db.query(
          "SELECT * FROM contest_challenges WHERE contest_id=$1 AND challenge_id=$2",
          [contest.id, awd.id],
        );
      const round = (await ensureRound(db, ct!, link!))!;
      const emptyArena = await ok(
        `/challenges/${awd.id}/arena?scope=${contest.id}`,
      );
      assert.equal(emptyArena.round.number, round.number);
      assert.equal(emptyArena.items.length, 2);
      assert(emptyArena.items.every((item: any) => item.instance_id === null));
      const ia = crypto.randomUUID(),
        ib = crypto.randomUUID();
      for (const [iid, owner, actor] of [
        [ia, ta, alice.id],
        [ib, tb, bob.id],
      ])
        await db.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','running',$6,now()+interval '1 hour',now()+interval '1 hour')",
          [
            iid,
            awd.id,
            contest.id,
            "t:" + owner,
            actor,
            JSON.stringify({ ...profile, awd: true }),
          ],
        );
      for (const [iid, owner, flag] of [
        [ia, ta, "flag{team_a}"],
        [ib, tb, "flag{team_b}"],
      ]) {
        await db.query(
          "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 minute')",
          [flagHash(flag!), round.id, iid, "t:" + owner],
        );
        await db.query(
          "INSERT INTO awd_checks(id,round_id,instance_id,owner_key,status) VALUES($1,$2,$3,$4,'up')",
          [crypto.randomUUID(), round.id, iid, "t:" + owner],
        );
      }
      const arena = await ok(`/challenges/${awd.id}/arena?scope=${contest.id}`);
      assert.equal(
        arena.items.find((item: any) => item.team_id === ta).instance_id,
        ia,
      );
      assert.equal(
        arena.items.find((item: any) => item.team_id === ta).own,
        true,
      );
      assert.equal(
        arena.items.find((item: any) => item.team_id === tb).own,
        false,
      );
      assert(
        arena.items.every(
          (item: any) => item.status === "running" && item.health === "up",
        ),
      );
      assert.equal(
        (
          await ok(`/challenges/${awd.id}/attack`, alice, {
            scope: contest.id,
            flag: "flag{team_a}",
          })
        ).correct,
        false,
      );
      assert.equal(
        (
          await ok(`/challenges/${awd.id}/attack`, alice, {
            scope: contest.id,
            flag: "flag{team_b}",
          })
        ).correct,
        true,
      );
      assert.equal(
        (
          await ok(`/challenges/${awd.id}/attack`, alice, {
            scope: contest.id,
            flag: "flag{team_b}",
          })
        ).already_solved,
        true,
      );
      await db.query(
        "UPDATE awd_flags SET expires_at=now()-interval '1 second' WHERE round_id=$1",
        [round.id],
      );
      assert.equal(
        (
          await ok(`/challenges/${awd.id}/attack`, bob, {
            scope: contest.id,
            flag: "flag{team_a}",
          })
        ).correct,
        false,
      );
      await new AwdWorker(db).settle({ ...link, challenge_id: awd.id }, round);
      const scored = await db.query(
        "SELECT * FROM round_results WHERE round_id=$1 ORDER BY owner_key",
        [round.id],
      );
      assert.equal(scored.find((r) => r.owner_key === "t:" + ta)!.points, 300);
      assert.equal(scored.find((r) => r.owner_key === "t:" + tb)!.points, 100);
      const history = (
        await ok(`/challenges/${awd.id}/arena?scope=${contest.id}`)
      ).history;
      assert.equal(history.length, 1);
      assert.equal(history[0].points, 300);
    },
  );
  await t.test(
    "independent attachment and container profiles coexist, schema replay preserves active rows",
    async () => {
      const c = await ok("/admin/challenges", admin, {
        ...base,
        title: "Dual " + stamp,
        practice: true,
        flag_mode: "dynamic",
        resources: { container: profile, attachment: profile },
      });
      const a = await ok(`/challenges/${c.id}/instances`, alice, {
          scope: "practice",
          resource_type: "container",
        }),
        b = await ok(`/challenges/${c.id}/instances`, alice, {
          scope: "practice",
          resource_type: "attachment",
        });
      assert.notEqual(a.id, b.id);
      assert.equal(
        (
          await req(`/challenges/${c.id}/instances`, alice, {
            scope: "practice",
            resource_type: "missing",
          })
        ).statusCode,
        400,
      );
      const schema = await readFile(
        new URL("../src/schema.sql", import.meta.url),
        "utf8",
      );
      for (const sql of schema.split(";").filter((x) => x.trim()))
        await db.query(sql);
      const rows = await db.query(
        "SELECT resource_type FROM instances WHERE challenge_id=$1",
        [c.id],
      );
      assert.deepEqual(
        new Set(rows.map((r) => r.resource_type)),
        new Set(["container", "attachment"]),
      );
    },
  );
});
