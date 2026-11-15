import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { config } from "../src/config.js";
import { digest, flagHash } from "../src/security.js";
import { makeTar } from "../src/patch-archive.js";
import { storage } from "../src/resources.js";
import type {
  QuestionLogic,
  PublicQuestionLogic,
} from "../src/contest-logic.js";

type Actor = { id: string; team: string; cookie: string };
type Setting = { challenge_id: string; logic: unknown };
type Item = { id: string; contest_logic?: PublicQuestionLogic };
type PaperItem = Item & {
  saved: { revision: string | null; finalized_at: string | null };
};
type ChallengeResources = {
  hint: string;
  attachment: string;
  target: string;
  artifact: string;
};
const emptyLogic = (): QuestionLogic => ({
  exclusive_group: null,
  dependency: null,
});
const exclusive = (group: string): QuestionLogic => ({
  ...emptyLogic(),
  exclusive_group: group,
});
const dependency = (
  scope: "team" | "global",
  mode: "all" | "any",
  ids: string[],
): QuestionLogic => ({
  ...emptyLogic(),
  dependency: { scope, mode, challenge_ids: ids },
});

// PGlite serializes transactions. TEST_POSTGRES=1 exercises the same concurrent
// requests on independent PostgreSQL connections and real advisory locks.
test(
  "contest logic protects every entry point and binds only accepted formal submissions",
  { timeout: 120000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      directory = await mkdtemp(join(tmpdir(), "nebuctf-logic-")),
      previous = config.DATA_DIR;
    config.DATA_DIR = directory;
    t.after(async () => {
      await app.close();
      await db.close();
      config.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    });
    await app.ready();
    await mkdir(storage(), { recursive: true });

    async function actor(role = "user", existingTeam?: string): Promise<Actor> {
      const id = crypto.randomUUID(),
        team = existingTeam ?? crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, `logic-${id.slice(0, 8)}`, `${id}@example.test`, role],
      );
      if (!existingTeam)
        await db.query(
          "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
          [team, `Logic ${team}`, id, digest(token)],
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
      bob = await actor(),
      admin = await actor("admin");
    const headers = (who: Actor) => ({
      cookie: who.cookie,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
    });
    const request = (
      path: string,
      who = alice,
      body?: unknown,
      method: "GET" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: `/api${path}`,
        method,
        headers: {
          ...headers(who),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        payload: body === undefined ? undefined : JSON.stringify(body),
      });
    async function ok(
      path: string,
      who = alice,
      body?: unknown,
      method?: "GET" | "POST" | "PUT",
    ) {
      const response = await request(path, who, body, method);
      assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
      return response;
    }
    const profile = {
      image: "nebuctf/logic-test:local",
      mode: "private",
      protocol: "nc",
      port: 1337,
      access_mode: "port",
      cpu: 100,
      memory: 32,
      ttl: 600,
    };
    async function challenge(
      type: "ctf" | "objective" | "awd" | "awdp" = "ctf",
    ) {
      const id = crypto.randomUUID();
      const objective =
        type === "objective"
          ? {
              type: "single",
              options: [
                { id: "A", text: "First" },
                { id: "B", text: "Second" },
              ],
              correct_options: ["A"],
              blanks: [],
              trim: true,
              case_sensitive: true,
            }
          : null;
      await db.query(
        "INSERT INTO challenges(id,title,description,category,difficulty,kind,flag_hash,published,practice,challenge_type,objective,resources,patch_config) VALUES($1,$2,$3,'Misc','入门','static_attachment',$4,true,$5,$6,$7,$8,$9)",
        [
          id,
          `Logic ${id}`,
          `secret-body-${id}`,
          flagHash(`flag{${id}}`),
          type !== "awd",
          type,
          objective && JSON.stringify(objective),
          JSON.stringify({
            container: profile,
            attachment: { ...profile, image: "nebuctf/logic-generator:local" },
          }),
          ["awd", "awdp"].includes(type)
            ? JSON.stringify({
                checker_image: "nebuctf/logic-check:local",
                patch_root: "/app",
                timeout: 10,
                cpu: 100,
                memory: 64,
              })
            : null,
        ],
      );
      return id;
    }
    async function contest(
      ids: string[],
      settings: Setting[] = [],
      participants = [alice, bob],
    ) {
      const scope = crypto.randomUUID();
      await db.query(
        "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Logic',true,now()-interval '1 hour',now()+interval '1 hour')",
        [scope],
      );
      for (const [position, id] of ids.entries())
        await db.query(
          "INSERT INTO contest_challenges(contest_id,challenge_id,position,logic) VALUES($1,$2,$3,$4)",
          [
            scope,
            id,
            position,
            JSON.stringify(
              settings.find((s) => s.challenge_id === id)?.logic ??
                emptyLogic(),
            ),
          ],
        );
      for (const team of new Set(participants.map((who) => who.team)))
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [scope, team],
        );
      return scope;
    }
    const list = async (scope: string, who = alice) =>
      (await ok(`/challenges?scope=${scope}`, who)).json<{
        items: Item[];
        total: number;
      }>();
    const paper = async (scope: string, who = alice) =>
      (await ok(`/contests/${scope}/objective-paper`, who)).json<{
        items: PaperItem[];
        preview: boolean;
      }>();
    const submit = (
      scope: string,
      id: string,
      who = alice,
      flag = `flag{${id}}`,
    ) => request(`/challenges/${id}/submit`, who, { scope, flag });
    async function choices(scope: string, who = alice) {
      return db.query(
        "SELECT group_name,challenge_id FROM contest_exclusive_choices WHERE contest_id=$1 AND owner_key=$2 ORDER BY group_name",
        [scope, `t:${who.team}`],
      );
    }
    async function count(
      table: "submissions" | "solves" | "objective_answers" | "judge_jobs",
      scope: string,
    ) {
      const [row] = await db.query(
        `SELECT count(*)::int n FROM ${table} WHERE scope=$1`,
        [scope],
      );
      return row!.n as number;
    }
    async function expectVisible(
      scope: string,
      who: Actor,
      expected: string[],
    ) {
      const result = await list(scope, who);
      assert.deepEqual(
        result.items.map((item) => item.id).sort(),
        [...expected].sort(),
      );
      assert.equal(result.total, expected.length);
    }
    const multipart = (data: Buffer, who: Actor, filename: string) => ({
      headers: {
        ...headers(who),
        "content-type": "multipart/form-data; boundary=logic-upload",
      },
      payload: Buffer.concat([
        Buffer.from(
          `--logic-upload\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        data,
        Buffer.from("\r\n--logic-upload--\r\n"),
      ]),
    });

    async function resources(
      scope: string,
      id: string,
      who = alice,
    ): Promise<ChallengeResources> {
      const hint = crypto.randomUUID(),
        attachment = crypto.randomUUID(),
        target = crypto.randomUUID(),
        artifact = crypto.randomUUID();
      await db.query("UPDATE challenges SET hints=$2 WHERE id=$1", [
        id,
        JSON.stringify([{ id: hint, content: `secret-hint-${id}` }]),
      ]);
      await db.query(
        "INSERT INTO attachments(id,challenge_id,name,size) VALUES($1,$2,'secret.txt',6)",
        [attachment, id],
      );
      await writeFile(join(storage(), attachment), "secret");
      await writeFile(join(storage(), artifact), "secret");
      for (const [iid, kind, status, resourceType] of [
        [target, "dynamic_container", "running", "container"],
        [artifact, "dynamic_attachment", "ready", "attachment"],
      ])
        await db.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,resource_type,spec,endpoint,artifact_size,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'127.0.0.1:31337',6,now()+interval '1 hour',now()+interval '2 hours')",
          [
            iid,
            id,
            scope,
            `t:${who.team}`,
            who.id,
            kind,
            status,
            resourceType,
            JSON.stringify({ ...profile, renew_limit: 2, renew_seconds: 600 }),
          ],
        );
      return { hint, attachment, target, artifact };
    }
    async function assertLockedEntries(
      scope: string,
      id: string,
      seeded: ChallengeResources,
      who = alice,
    ) {
      const base = `/challenges/${id}`;
      const entries: [string, unknown?][] = [
        [`${base}?scope=${scope}`],
        [`${base}/answer?scope=${scope}`],
        [
          `${base}/answer`,
          { scope, answer: { choices: ["A"] }, finalize: true },
        ],
        [`${base}/submit`, { scope, flag: "wrong" }],
        [`${base}/attack`, { scope, flag: "wrong" }],
        [`${base}/rounds?scope=${scope}`],
        [`${base}/arena?scope=${scope}`],
        [`${base}/restart`, { scope }],
        [`${base}/patches?scope=${scope}`],
        [`${base}/patches?scope=${scope}`, {}],
        [`${base}/patches/example?scope=${scope}`],
        [`${base}/instance-policy?scope=${scope}`],
        [`${base}/instances`, { scope, resource_type: "container" }],
        [`${base}/instances`, { scope, resource_type: "attachment" }],
        [
          `${base}/hints/${seeded.hint}/unlock`,
          { scope, quote: "0".repeat(64), confirmed: true },
        ],
        [`/attachments/${seeded.attachment}?scope=${scope}`],
        [`/instances/${seeded.artifact}/artifact`],
        [`/instances/${seeded.target}/renew`, {}],
        [`/terminal/targets/${seeded.target}`],
        ["/terminal", { target: seeded.target }],
      ];
      for (const [path, body] of entries) {
        const response = await request(path, who, body);
        assert.equal(response.statusCode, 403, `${path}: ${response.body}`);
        assert(!response.body.includes(`secret-body-${id}`));
        assert(!response.body.includes(`secret-hint-${id}`));
        assert(!response.body.includes("127.0.0.1:31337"));
      }
      const instances = (await ok(`/instances?scope=${scope}`, who)).json<{
        items: Item[];
      }>();
      assert(
        !instances.items.some(
          (item) => item.id === seeded.target || item.id === seeded.artifact,
        ),
      );
    }

    await t.test(
      "legacy rules normalize without hiding questions; unregistered admin preview remains separate",
      async () => {
        const plain = await challenge(),
          locked = await challenge("objective");
        const scope = await contest(
          [plain, locked],
          [{ challenge_id: locked, logic: dependency("team", "all", [plain]) }],
        );
        const result = await list(scope);
        assert.equal(result.items.length, 1);
        assert.deepEqual(result.items[0]!.contest_logic, {
          ...emptyLogic(),
          exclusive_selected: false,
        });
        assert.deepEqual(
          (await ok(`/challenges/${plain}?scope=${scope}`)).json<{
            contest_logic: PublicQuestionLogic;
          }>().contest_logic,
          { ...emptyLogic(), exclusive_selected: false },
        );
        assert.equal((await paper(scope)).items.length, 0);
        assert.equal((await list(scope, admin)).items.length, 2);
        const preview = await paper(scope, admin);
        assert(preview.preview);
        assert.equal(preview.items.length, 1);
        assert.equal(preview.items[0]!.contest_logic, undefined);
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [scope, admin.team],
        );
        await expectVisible(scope, admin, [plain]);
        assert.equal(
          (await request(`/challenges/${locked}?scope=${scope}`, admin))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await request(`/challenges/${locked}/answer`, admin, {
              scope,
              answer: { choices: ["A"] },
              finalize: true,
            })
          ).statusCode,
          403,
        );
        assert.equal((await paper(scope, admin)).items.length, 0);
      },
    );

    await t.test(
      "team/global all/any dependencies unlock only from qualifying formal team completions",
      async () => {
        const first = await challenge(),
          second = await challenge();
        const teamAll = await challenge(),
          teamAny = await challenge(),
          globalAll = await challenge(),
          globalAny = await challenge("objective");
        const scope = await contest(
          [first, second, teamAll, teamAny, globalAll, globalAny],
          [
            {
              challenge_id: teamAll,
              logic: dependency("team", "all", [first, second]),
            },
            {
              challenge_id: teamAny,
              logic: dependency("team", "any", [first, second]),
            },
            {
              challenge_id: globalAll,
              logic: dependency("global", "all", [first, second]),
            },
            {
              challenge_id: globalAny,
              logic: dependency("global", "any", [first, second]),
            },
          ],
        );
        // Neither standalone practice nor a practice solve using this contest scope counts.
        assert.equal((await submit("practice", first)).statusCode, 200);
        await db.query(
          "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,true)",
          [crypto.randomUUID(), second, scope, `t:${bob.team}`, bob.id],
        );
        const outsider = await actor();
        await db.query(
          "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id) VALUES($1,$2,$3,$4,$5)",
          [
            crypto.randomUUID(),
            first,
            scope,
            `t:${outsider.team}`,
            outsider.id,
          ],
        );
        await expectVisible(scope, alice, [first, second]);
        await expectVisible(scope, bob, [first, second]);
        assert.equal((await paper(scope)).items.length, 0);
        assert.equal((await submit(scope, first)).statusCode, 200);
        await expectVisible(scope, alice, [first, second, teamAny, globalAny]);
        await expectVisible(scope, bob, [first, second, globalAny]);
        assert.equal((await paper(scope, bob)).items[0]!.id, globalAny);
        assert.deepEqual((await paper(scope, bob)).items[0]!.contest_logic, {
          ...dependency("global", "any", [first, second]),
          exclusive_selected: false,
        });
        assert.equal((await submit(scope, second, bob)).statusCode, 200);
        await expectVisible(scope, alice, [
          first,
          second,
          teamAny,
          globalAll,
          globalAny,
        ]);
        await expectVisible(scope, bob, [
          first,
          second,
          teamAny,
          globalAll,
          globalAny,
        ]);
        assert.equal((await submit(scope, second)).statusCode, 200);
        await expectVisible(scope, alice, [
          first,
          second,
          teamAll,
          teamAny,
          globalAll,
          globalAny,
        ]);
      },
    );

    await t.test(
      "multi-part dependencies require the whole formal challenge, not individual or practice parts",
      async () => {
        const multi = await challenge(),
          teamTarget = await challenge(),
          globalTarget = await challenge();
        const parts = [crypto.randomUUID(), crypto.randomUUID()];
        for (const [position, part] of parts.entries())
          await db.query(
            "INSERT INTO challenge_parts(id,challenge_id,title,position,flag_hash,initial_points,minimum_points) VALUES($1,$2,$3,$4,$5,100,100)",
            [
              part,
              multi,
              `Part ${position}`,
              position,
              flagHash(`flag{${part}}`),
            ],
          );
        const scope = await contest(
          [multi, teamTarget, globalTarget],
          [
            {
              challenge_id: teamTarget,
              logic: dependency("team", "all", [multi]),
            },
            {
              challenge_id: globalTarget,
              logic: dependency("global", "all", [multi]),
            },
          ],
        );
        assert.equal(
          (await submit(scope, multi, alice, `flag{${parts[0]}}`)).statusCode,
          200,
        );
        assert.equal(
          (await submit("practice", multi, alice, `flag{${parts[1]}}`))
            .statusCode,
          200,
        );
        await expectVisible(scope, alice, [multi]);
        await expectVisible(scope, bob, [multi]);
        // A top-level record alone must not override missing formal part solves.
        await db.query(
          "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [crypto.randomUUID(), multi, scope, `t:${alice.team}`, alice.id],
        );
        await db.query(
          "INSERT INTO part_solves(id,part_id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,$6,true)",
          [
            crypto.randomUUID(),
            parts[1],
            multi,
            scope,
            `t:${alice.team}`,
            alice.id,
          ],
        );
        await expectVisible(scope, alice, [multi]);
        await expectVisible(scope, bob, [multi]);
        assert.equal(
          (await submit(scope, multi, alice, `flag{${parts[1]}}`)).statusCode,
          200,
        );
        await expectVisible(scope, alice, [multi, teamTarget, globalTarget]);
        await expectVisible(scope, bob, [multi, globalTarget]);
      },
    );

    await t.test(
      "dependency locks reject direct detail, resources, hints, attachments, terminal and submission bypasses",
      async () => {
        const prerequisite = await challenge(),
          locked = await challenge();
        const scope = await contest(
          [prerequisite, locked],
          [
            {
              challenge_id: locked,
              logic: dependency("team", "all", [prerequisite]),
            },
          ],
        );
        const seeded = await resources(scope, locked);
        await expectVisible(scope, alice, [prerequisite]);
        await assertLockedEntries(scope, locked, seeded);
        assert.equal(await count("submissions", scope), 0);
        assert.deepEqual(await choices(scope), []);
        assert.equal((await submit(scope, prerequisite)).statusCode, 200);
        await expectVisible(scope, alice, [prerequisite, locked]);
        await ok(`/challenges/${locked}?scope=${scope}`);
        assert.equal(
          (await ok(`/attachments/${seeded.attachment}?scope=${scope}`)).body,
          "secret",
        );
        assert.equal(
          (await ok(`/instances/${seeded.artifact}/artifact`)).body,
          "secret",
        );
        await ok(`/terminal/targets/${seeded.target}`);
        const instances = (await ok(`/instances?scope=${scope}`)).json<{
          items: Item[];
        }>();
        assert(instances.items.some((item) => item.id === seeded.target));
      },
    );

    await t.test(
      "the first wrong Flag selects a persistent team branch and excludes all sibling entry points",
      async () => {
        const selected = await challenge(),
          sibling = await challenge();
        const scope = await contest(
          [selected, sibling],
          [selected, sibling].map((id) => ({
            challenge_id: id,
            logic: exclusive("route"),
          })),
        );
        const seeded = await resources(scope, sibling);
        assert(
          (await list(scope)).items.every(
            (item) => item.contest_logic?.exclusive_selected === false,
          ),
        );
        const wrong = await submit(scope, selected, alice, "wrong");
        assert.equal(wrong.statusCode, 200, wrong.body);
        assert.equal(wrong.json<{ correct: boolean }>().correct, false);
        assert.equal(await count("solves", scope), 0);
        assert.deepEqual(await choices(scope), [
          { group_name: "route", challenge_id: selected },
        ]);
        await expectVisible(scope, alice, [selected]);
        await expectVisible(scope, bob, [selected, sibling]);
        assert.deepEqual((await list(scope)).items[0]!.contest_logic, {
          ...exclusive("route"),
          exclusive_selected: true,
        });
        await assertLockedEntries(scope, sibling, seeded);
        const mate = await actor("user", alice.team);
        assert.equal((await submit(scope, sibling, mate)).statusCode, 403);
        assert.equal((await submit(scope, selected, mate)).statusCode, 200);
        assert.equal(
          (await submit(scope, sibling, bob, "wrong")).statusCode,
          200,
        );
        await expectVisible(scope, bob, [sibling]);
        assert.equal(await count("submissions", scope), 3);
      },
    );

    await t.test(
      "concurrent sibling submissions by different teammates accept exactly one branch",
      async () => {
        const who = await actor(),
          mate = await actor("user", who.team);
        const ids = [await challenge(), await challenge()];
        const scope = await contest(
          ids,
          ids.map((id) => ({
            challenge_id: id,
            logic: exclusive("concurrent"),
          })),
          [who],
        );
        const responses = await Promise.all(
          ids.map((id, index) =>
            submit(scope, id, index ? mate : who, "wrong"),
          ),
        );
        assert.deepEqual(
          responses.map((response) => response.statusCode).sort(),
          [200, 403],
        );
        const winner =
          ids[responses.findIndex((response) => response.statusCode === 200)]!;
        assert.deepEqual(await choices(scope, who), [
          { group_name: "concurrent", challenge_id: winner },
        ]);
        assert.equal(await count("submissions", scope), 1);
        await expectVisible(scope, mate, [winner]);
      },
    );

    await t.test(
      "invalid parameters, wrong submission endpoints and exhausted quotas never bind a route",
      async () => {
        const selected = await challenge(),
          sibling = await challenge(),
          objective = await challenge("objective");
        const scope = await contest(
          [selected, sibling, objective],
          [selected, sibling, objective].map((id) => ({
            challenge_id: id,
            logic: exclusive("validation"),
          })),
        );
        assert.equal(
          (await submit(scope, selected, alice, "")).statusCode,
          400,
        );
        assert.equal(
          (
            await request(`/challenges/${selected}/answer`, alice, {
              scope,
              answer: {},
              finalize: true,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request(`/challenges/${selected}/attack`, alice, {
              scope,
              flag: "wrong",
            })
          ).statusCode,
          400,
        );
        assert.equal((await submit(scope, objective)).statusCode, 400);
        assert.deepEqual(await choices(scope), []);
        await db.query(
          'UPDATE contests SET submission_limits=\'{"flag":1,"defense":null}\' WHERE id=$1',
          [scope],
        );
        await db.query(
          "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct) VALUES($1,$2,$3,$4,$5,false)",
          [crypto.randomUUID(), alice.id, selected, scope, `t:${alice.team}`],
        );
        const capped = await submit(scope, selected);
        assert.equal(capped.statusCode, 409, capped.body);
        assert.deepEqual(await choices(scope), []);
        assert.equal(await count("submissions", scope), 1);
        assert.equal(
          (await submit(scope, sibling, alice, "wrong")).statusCode,
          200,
        );
        assert.deepEqual(await choices(scope), [
          { group_name: "validation", challenge_id: sibling },
        ]);
      },
    );

    await t.test(
      "objective drafts, empty exclusive answers and invalid options do not select a route",
      async () => {
        const first = await challenge("objective"),
          second = await challenge("objective");
        const scope = await contest(
          [first, second],
          [first, second].map((id) => ({
            challenge_id: id,
            logic: exclusive("objective"),
          })),
        );
        const draft = await ok(`/challenges/${first}/answer`, alice, {
          scope,
          answer: { choices: ["A"] },
          finalize: false,
        });
        assert.equal(
          draft.json<{ finalized_at: string | null }>().finalized_at,
          null,
        );
        await ok(`/contests/${scope}/objective-paper`, alice, {
          finalize: false,
          answers: [{ id: second, answer: { choices: ["B"] }, revision: null }],
        });
        assert.deepEqual(await choices(scope), []);
        const stale = await request(
          `/contests/${scope}/objective-paper`,
          alice,
          {
            finalize: true,
            answers: [
              { id: first, answer: { choices: ["A"] }, revision: null },
            ],
          },
        );
        assert.equal(stale.statusCode, 409, stale.body);
        assert.deepEqual(await choices(scope), []);
        assert.equal(await count("submissions", scope), 0);
        for (const answer of [
          {},
          { choices: [] },
          { choices: ["unknown"] },
          { choices: ["A", "A"] },
          { choices: ["A", "B"] },
          { blanks: { unknown: "answer" } },
        ]) {
          const response = await request(`/challenges/${first}/answer`, alice, {
            scope,
            answer,
            finalize: true,
          });
          assert.equal(response.statusCode, 400, response.body);
          assert.deepEqual(await choices(scope), []);
        }
        // A wrong but meaningful final answer is still an accepted route choice.
        await ok(`/challenges/${second}/answer`, alice, {
          scope,
          answer: { choices: ["B"] },
          finalize: true,
        });
        assert.deepEqual(await choices(scope), [
          { group_name: "objective", challenge_id: second },
        ]);
        assert.equal(await count("submissions", scope), 1);
        assert.deepEqual(
          (await paper(scope)).items.map((item) => item.id),
          [second],
        );
        assert.equal(
          (await request(`/challenges/${first}/answer?scope=${scope}`))
            .statusCode,
          403,
        );
        await db.query(
          "UPDATE contests SET ends_at=now()-interval '1 minute',practice_mode=true WHERE id=$1",
          [scope],
        );
        const practicePaper = await paper(scope);
        assert.equal(practicePaper.items.length, 2);
        assert(
          practicePaper.items.every(
            (item) =>
              item.contest_logic === undefined && item.saved.revision === null,
          ),
        );
        await ok(`/contests/${scope}/objective-paper`, alice, {
          finalize: true,
          answers: practicePaper.items.map((item) => ({
            id: item.id,
            answer: { choices: ["A"] },
            revision: null,
          })),
        });
        assert.deepEqual(await choices(scope), [
          { group_name: "objective", challenge_id: second },
        ]);
        assert.equal(await count("submissions", scope), 3);
      },
    );

    await t.test(
      "blank exclusive questions reject whitespace without consuming the branch",
      async () => {
        const blank = await challenge("objective"),
          sibling = await challenge("objective");
        await db.query("UPDATE challenges SET objective=$2 WHERE id=$1", [
          blank,
          JSON.stringify({
            type: "blank",
            blanks: [{ id: "value", label: "Answer", answers: ["right"] }],
            options: [],
            correct_options: [],
            trim: true,
            case_sensitive: true,
          }),
        ]);
        const scope = await contest(
          [blank, sibling],
          [blank, sibling].map((id) => ({
            challenge_id: id,
            logic: exclusive("blank"),
          })),
        );
        await ok(`/challenges/${blank}/answer`, alice, {
          scope,
          answer: { blanks: { value: "   " } },
          finalize: false,
        });
        for (const answer of [
          {},
          { blanks: {} },
          { blanks: { value: "" } },
          { blanks: { value: " \t " } },
        ]) {
          const response = await request(`/challenges/${blank}/answer`, alice, {
            scope,
            answer,
            finalize: true,
          });
          assert.equal(response.statusCode, 400, response.body);
          assert.deepEqual(await choices(scope), []);
          assert.equal(await count("submissions", scope), 0);
        }
        const accepted = await ok(`/challenges/${blank}/answer`, alice, {
          scope,
          answer: { blanks: { value: "wrong" } },
          finalize: true,
        });
        assert.equal(accepted.json<{ correct: boolean }>().correct, false);
        assert.deepEqual(await choices(scope), [
          { group_name: "blank", challenge_id: blank },
        ]);
      },
    );

    await t.test(
      "a whole paper containing siblings rejects atomically; explicitly choosing one sibling succeeds",
      async () => {
        const ids = [
          await challenge("objective"),
          await challenge("objective"),
          await challenge("objective"),
        ].sort();
        const first = ids[0]!,
          second = ids[1]!,
          required = ids[2]!,
          unlocked = await challenge("objective");
        const scope = await contest(
          [first, second, required, unlocked],
          [
            ...[first, second].map((id) => ({
              challenge_id: id,
              logic: exclusive("paper"),
            })),
            {
              challenge_id: unlocked,
              logic: dependency("team", "all", [first]),
            },
          ],
        );
        const answers = [first, second, required].map((id) => ({
          id,
          answer: { choices: ["A"] },
          revision: null,
        }));
        for (const submitted of [answers, [...answers].reverse()]) {
          const response = await request(
            `/contests/${scope}/objective-paper`,
            alice,
            { finalize: true, answers: submitted },
          );
          assert.equal(response.statusCode, 409, response.body);
          assert.equal(await count("objective_answers", scope), 0);
          assert.equal(await count("submissions", scope), 0);
          assert.equal(await count("solves", scope), 0);
          assert.deepEqual(await choices(scope), []);
        }
        const incomplete = await request(
          `/contests/${scope}/objective-paper`,
          alice,
          { finalize: true, answers: [answers[0]] },
        );
        assert.equal(incomplete.statusCode, 409, incomplete.body);
        assert.deepEqual(await choices(scope), []);
        // The selected branch is saved first in lock order. Failure in a later,
        // non-exclusive question must roll back both that answer and its choice.
        const invalidLater = await request(
          `/contests/${scope}/objective-paper`,
          alice,
          {
            finalize: true,
            answers: [
              answers[0],
              {
                id: required,
                answer: { choices: ["unknown"] },
                revision: null,
              },
            ],
          },
        );
        assert.equal(invalidLater.statusCode, 400, invalidLater.body);
        assert.deepEqual(await choices(scope), []);
        assert.equal(await count("objective_answers", scope), 0);
        assert.equal(await count("submissions", scope), 0);
        assert.equal(await count("solves", scope), 0);
        await ok(`/contests/${scope}/objective-paper`, alice, {
          finalize: true,
          answers: [answers[0], answers[2]],
        });
        assert.deepEqual(await choices(scope), [
          { group_name: "paper", challenge_id: first },
        ]);
        assert.equal(await count("objective_answers", scope), 2);
        assert.equal(await count("submissions", scope), 2);
        assert.equal(await count("solves", scope), 2);
        assert.deepEqual(
          (await paper(scope)).items.map((item) => item.id).sort(),
          [first, required, unlocked].sort(),
        );
        await ok(`/challenges/${unlocked}?scope=${scope}`);
        const hidden = await request(
          `/contests/${scope}/objective-paper`,
          alice,
          {
            finalize: false,
            answers: [{ id: second, answer: {}, revision: null }],
          },
        );
        assert.equal(hidden.statusCode, 403, hidden.body);
      },
    );

    await t.test(
      "post-contest practice ignores locks and consumes neither choices nor formal dependencies",
      async () => {
        const first = await challenge(),
          second = await challenge(),
          target = await challenge();
        const scope = await contest(
          [first, second, target],
          [
            ...[first, second].map((id) => ({
              challenge_id: id,
              logic: exclusive("practice"),
            })),
            {
              challenge_id: target,
              logic: dependency("global", "all", [second]),
            },
          ],
        );
        assert.equal(
          (await submit(scope, first, alice, "wrong")).statusCode,
          200,
        );
        await db.query(
          "UPDATE contests SET ends_at=now()-interval '1 minute',practice_mode=true WHERE id=$1",
          [scope],
        );
        await expectVisible(scope, alice, [first, second, target]);
        assert(
          (await list(scope)).items.every(
            (item) => item.contest_logic === undefined,
          ),
        );
        assert.equal((await submit(scope, second)).statusCode, 200);
        assert.equal((await submit(scope, first, bob)).statusCode, 200);
        assert.equal((await submit(scope, second, bob)).statusCode, 200);
        assert.deepEqual(await choices(scope), [
          { group_name: "practice", challenge_id: first },
        ]);
        assert.deepEqual(await choices(scope, bob), []);
        const [solves] = await db.query(
          "SELECT count(*)::int n FROM solves WHERE scope=$1 AND contest_practice",
          [scope],
        );
        assert.equal(solves!.n, 3);
        await db.query(
          "UPDATE contests SET ends_at=now()+interval '1 hour',practice_mode=false WHERE id=$1",
          [scope],
        );
        await expectVisible(scope, alice, [first]);
        await expectVisible(scope, bob, [first, second]);
        assert.equal(
          (await request(`/challenges/${target}?scope=${scope}`, bob))
            .statusCode,
          403,
        );
      },
    );

    await t.test(
      "wrong AWD attacks and accepted defense applications bind, but invalid and quota-rejected patches do not",
      async () => {
        const who = await actor(),
          attack = await challenge("awd"),
          attackSibling = await challenge("awd"),
          cappedAttack = await challenge("awd");
        const scope = await contest(
          [attack, attackSibling, cappedAttack],
          [attack, attackSibling, cappedAttack].map((id) => ({
            challenge_id: id,
            logic: exclusive("attack"),
          })),
          [who],
        );
        const invalid = await request(`/challenges/${attack}/attack`, who, {
          scope,
          flag: "",
        });
        assert.equal(invalid.statusCode, 400);
        assert.deepEqual(await choices(scope, who), []);
        await db.query(
          'UPDATE contests SET submission_limits=\'{"flag":1,"defense":null}\' WHERE id=$1',
          [scope],
        );
        await db.query(
          "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct) VALUES($1,$2,$3,$4,$5,false)",
          [crypto.randomUUID(), who.id, cappedAttack, scope, `t:${who.team}`],
        );
        const cappedAttackResponse = await request(
          `/challenges/${cappedAttack}/attack`,
          who,
          { scope, flag: "wrong" },
        );
        assert.equal(
          cappedAttackResponse.statusCode,
          409,
          cappedAttackResponse.body,
        );
        assert.deepEqual(await choices(scope, who), []);
        const wrong = await ok(`/challenges/${attack}/attack`, who, {
          scope,
          flag: "wrong",
        });
        assert.equal(wrong.json<{ correct: boolean }>().correct, false);
        assert.deepEqual(await choices(scope, who), [
          { group_name: "attack", challenge_id: attack },
        ]);
        assert.equal(
          (
            await request(`/challenges/${attackSibling}/attack`, who, {
              scope,
              flag: "wrong",
            })
          ).statusCode,
          403,
        );

        const defender = await actor(),
          defense = await challenge("awdp"),
          sibling = await challenge("awdp");
        const defenseScope = await contest(
          [defense, sibling],
          [defense, sibling].map((id) => ({
            challenge_id: id,
            logic: exclusive("defense"),
          })),
          [defender],
        );
        const upload = (id: string, data: Buffer) =>
          app.inject({
            method: "POST",
            url: `/api/challenges/${id}/patches?scope=${defenseScope}`,
            ...multipart(data, defender, "patch.tar.gz"),
          });
        const archive = gzipSync(
          makeTar([
            {
              name: "update.sh",
              data: Buffer.from("#!/bin/sh\nexit 0\n"),
              executable: false,
            },
          ]),
        );
        assert.equal(
          (await upload(defense, Buffer.from("invalid archive"))).statusCode,
          400,
        );
        assert.deepEqual(await choices(defenseScope, defender), []);
        // A failed, historical defense attempt can exhaust quota without any route choice.
        await db.query(
          'UPDATE contests SET submission_limits=\'{"flag":null,"defense":1}\' WHERE id=$1',
          [defenseScope],
        );
        await db.query(
          "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'failed',$1,'old.tar.gz','{}',now()+interval '1 hour')",
          [
            crypto.randomUUID(),
            defense,
            defenseScope,
            `t:${defender.team}`,
            defender.id,
          ],
        );
        const capped = await upload(defense, archive);
        assert.equal(capped.statusCode, 409, capped.body);
        assert.deepEqual(await choices(defenseScope, defender), []);
        const accepted = await upload(sibling, archive);
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.deepEqual(await choices(defenseScope, defender), [
          { group_name: "defense", challenge_id: sibling },
        ]);
        assert.equal(await count("judge_jobs", defenseScope), 2);
      },
    );

    await t.test(
      "admin validation rejects invalid and unreachable graphs and normalizes group names",
      async () => {
        const a = await challenge(),
          b = await challenge(),
          c = await challenge();
        const input = {
          title: "Logic validation",
          published: true,
          starts_at: new Date(Date.now() + 3600000).toISOString(),
          ends_at: new Date(Date.now() + 7200000).toISOString(),
          challenge_ids: [a, b, c],
        };
        const cases: { name: string; settings: Setting[] }[] = [
          {
            name: "self reference",
            settings: [
              { challenge_id: a, logic: dependency("team", "all", [a]) },
            ],
          },
          {
            name: "missing reference",
            settings: [
              {
                challenge_id: a,
                logic: dependency("team", "all", [crypto.randomUUID()]),
              },
            ],
          },
          {
            name: "duplicate prerequisite",
            settings: [
              { challenge_id: a, logic: dependency("global", "any", [b, b]) },
            ],
          },
          {
            name: "cycle across scopes",
            settings: [
              { challenge_id: a, logic: dependency("team", "all", [b]) },
              { challenge_id: b, logic: dependency("global", "any", [a]) },
            ],
          },
          {
            name: "empty dependency",
            settings: [
              { challenge_id: a, logic: dependency("team", "all", []) },
            ],
          },
          {
            name: "empty group",
            settings: [{ challenge_id: a, logic: exclusive("   ") }],
          },
          {
            name: "oversized group",
            settings: [{ challenge_id: a, logic: exclusive("x".repeat(61)) }],
          },
          {
            name: "invalid scope",
            settings: [
              {
                challenge_id: a,
                logic: {
                  dependency: {
                    scope: "user",
                    mode: "all",
                    challenge_ids: [b],
                  },
                },
              },
            ],
          },
          {
            name: "invalid mode",
            settings: [
              {
                challenge_id: a,
                logic: {
                  dependency: {
                    scope: "team",
                    mode: "some",
                    challenge_ids: [b],
                  },
                },
              },
            ],
          },
          {
            name: "duplicate settings",
            settings: [
              { challenge_id: a, logic: emptyLogic() },
              { challenge_id: a, logic: emptyLogic() },
            ],
          },
          {
            name: "unselected setting",
            settings: [
              { challenge_id: crypto.randomUUID(), logic: emptyLogic() },
            ],
          },
          {
            name: "exclusive prerequisite",
            settings: [
              {
                challenge_id: a,
                logic: {
                  ...dependency("team", "all", [b]),
                  exclusive_group: "route",
                },
              },
              { challenge_id: b, logic: exclusive("route") },
            ],
          },
          {
            name: "all requires siblings",
            settings: [
              { challenge_id: a, logic: dependency("team", "all", [b, c]) },
              ...[b, c].map((id) => ({
                challenge_id: id,
                logic: exclusive("route"),
              })),
            ],
          },
          {
            name: "transitive exclusive conflict",
            settings: [
              {
                challenge_id: a,
                logic: {
                  ...dependency("team", "all", [b]),
                  exclusive_group: "route",
                },
              },
              { challenge_id: b, logic: dependency("team", "all", [c]) },
              { challenge_id: c, logic: exclusive("route") },
            ],
          },
        ];
        for (const entry of cases) {
          const response = await request("/admin/contests", admin, {
            ...input,
            challenge_settings: entry.settings,
          });
          assert.equal(
            response.statusCode,
            400,
            `${entry.name}: ${response.body}`,
          );
        }
        for (const scope of ["team", "global"] as const) {
          const settings = [
            {
              challenge_id: a,
              logic: dependency(scope, scope === "team" ? "any" : "all", [
                b,
                c,
              ]),
            },
            ...[b, c].map((id) => ({
              challenge_id: id,
              logic: exclusive("  route  "),
            })),
          ];
          const created = await ok("/admin/contests", admin, {
            ...input,
            challenge_settings: settings,
          });
          const id = created.json<{ id: string }>().id;
          const saved = (await ok(`/admin/contests/${id}`, admin)).json<{
            challenge_settings: {
              challenge_id: string;
              logic: QuestionLogic;
            }[];
          }>();
          assert.equal(
            saved.challenge_settings.find(
              (setting) => setting.challenge_id === b,
            )!.logic.exclusive_group,
            "route",
          );
        }
      },
    );

    await t.test(
      "started contest logic is structurally locked while ordinary saves preserve choices",
      async () => {
        const a = await challenge(),
          b = await challenge();
        const settings = [a, b].map((id) => ({
          challenge_id: id,
          logic: exclusive("locked"),
        }));
        const input = {
          title: "Started rules",
          published: true,
          starts_at: new Date(Date.now() - 3600000).toISOString(),
          ends_at: new Date(Date.now() + 3600000).toISOString(),
          challenge_ids: [a, b],
          challenge_settings: settings,
        };
        const created = await ok("/admin/contests", admin, input),
          id = created.json<{ id: string }>().id;
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [id, alice.team],
        );
        assert.equal((await submit(id, a, alice, "wrong")).statusCode, 200);
        for (const logic of [
          exclusive("renamed"),
          emptyLogic(),
          { ...dependency("global", "all", [b]), exclusive_group: "locked" },
        ]) {
          const response = await request(
            `/admin/contests/${id}`,
            admin,
            {
              ...input,
              challenge_settings: [{ challenge_id: a, logic }, settings[1]],
            },
            "PUT",
          );
          assert.equal(response.statusCode, 409, response.body);
        }
        await ok(
          `/admin/contests/${id}`,
          admin,
          { ...input, title: "Renamed title" },
          "PUT",
        );
        const { challenge_settings, ...legacy } = input;
        await ok(`/admin/contests/${id}`, admin, legacy, "PUT");
        const saved = (await ok(`/admin/contests/${id}`, admin)).json<{
          challenge_settings: { challenge_id: string; logic: QuestionLogic }[];
        }>();
        assert(
          saved.challenge_settings.every(
            (setting) => setting.logic.exclusive_group === "locked",
          ),
        );
        assert.deepEqual(await choices(id), [
          { group_name: "locked", challenge_id: a },
        ]);
        assert.equal((await submit(id, b)).statusCode, 403);
        assert.equal(challenge_settings.length, 2);
      },
    );

    await t.test(
      "one successful AWD attack unlocks team and global dependencies without awarding a whole-challenge solve",
      async () => {
        const awd = await challenge("awd"),
          teamTarget = await challenge(),
          globalTarget = await challenge();
        const scope = await contest(
          [awd, teamTarget, globalTarget],
          [
            {
              challenge_id: teamTarget,
              logic: dependency("team", "all", [awd]),
            },
            {
              challenge_id: globalTarget,
              logic: dependency("global", "all", [awd]),
            },
          ],
        );
        const otherScope = await contest(
          [awd, teamTarget],
          [
            {
              challenge_id: teamTarget,
              logic: dependency("global", "all", [awd]),
            },
          ],
        );
        const round = crypto.randomUUID(),
          flag = `flag{awd-prerequisite-${round}}`;
        const { target } = await resources(scope, awd, bob);
        await db.query(
          "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,1,now()-interval '1 minute',now()+interval '1 minute','{}')",
          [round, scope, awd],
        );
        await db.query(
          "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 minute')",
          [flagHash(flag), round, target, `t:${bob.team}`],
        );
        await expectVisible(scope, alice, [awd]);
        const wrong = await ok(`/challenges/${awd}/attack`, alice, {
          scope,
          flag: "wrong",
        });
        assert.equal(wrong.json<{ correct: boolean }>().correct, false);
        await expectVisible(scope, alice, [awd]);
        const captured = await ok(`/challenges/${awd}/attack`, alice, {
          scope,
          flag,
        });
        assert.equal(captured.json<{ correct: boolean }>().correct, true);
        await expectVisible(scope, alice, [awd, teamTarget, globalTarget]);
        await expectVisible(scope, bob, [awd, globalTarget]);
        await expectVisible(otherScope, alice, [awd]);
        const [solves] = await db.query(
          "SELECT count(*)::int n FROM solves WHERE scope=$1 AND challenge_id=$2",
          [scope, awd],
        );
        assert.equal(solves!.n, 0);
      },
    );

    await t.test(
      "contest export/import remaps dependency ids while retaining exclusive groups and excluding choices",
      async () => {
        // Create through the admin API so the archive contains fully valid definitions.
        const base = {
          category: "Misc",
          difficulty: "入门",
          published: true,
          practice: true,
          flag: "flag{transfer-logic}",
        };
        const sourceIds: string[] = [];
        for (const title of [
          "Transfer prerequisite",
          "Transfer branch A",
          "Transfer branch B",
        ])
          sourceIds.push(
            (await ok("/admin/challenges", admin, { ...base, title })).json<{
              id: string;
            }>().id,
          );
        const [pre, a, b] = sourceIds as [string, string, string];
        const startsAt = new Date(Date.now() - 3600000).toISOString(),
          endsAt = new Date(Date.now() + 3600000).toISOString();
        const created = await ok("/admin/contests", admin, {
          title: "Transfer logic source",
          starts_at: startsAt,
          ends_at: endsAt,
          published: true,
          challenge_ids: sourceIds,
          challenge_settings: [
            { challenge_id: pre, logic: emptyLogic() },
            {
              challenge_id: a,
              logic: {
                ...dependency("team", "all", [pre]),
                exclusive_group: "transfer-route",
              },
            },
            {
              challenge_id: b,
              logic: {
                ...dependency("global", "any", [pre]),
                exclusive_group: "transfer-route",
              },
            },
          ],
        });
        const source = created.json<{ id: string }>().id;
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [source, alice.team],
        );
        assert.equal(
          (await submit(source, pre, alice, "flag{transfer-logic}")).statusCode,
          200,
        );
        assert.equal((await submit(source, a, alice, "wrong")).statusCode, 200);
        const exported = await ok(`/admin/contests/${source}/export`, admin);
        const preview = await app.inject({
          method: "POST",
          url: "/api/admin/transfers/preview?kind=contest",
          ...multipart(exported.rawPayload, admin, "logic.zip"),
        });
        assert.equal(preview.statusCode, 200, preview.body);
        const imported = await ok(
          `/admin/transfers/${preview.json<{ token: string }>().token}/commit`,
          admin,
          {
            title: "Imported logic",
            starts_at: new Date(Date.now() + 86400000).toISOString(),
          },
        );
        const copyId = imported.json<{ id: string }>().id;
        const copy = (await ok(`/admin/contests/${copyId}`, admin)).json<{
          challenge_ids: string[];
          challenge_settings: { challenge_id: string; logic: QuestionLogic }[];
        }>();
        assert.equal(copy.challenge_ids.length, 3);
        assert(copy.challenge_ids.every((id) => !sourceIds.includes(id)));
        const [newPre, newA, newB] = copy.challenge_ids;
        assert.deepEqual(
          copy.challenge_settings.find(
            (setting) => setting.challenge_id === newA,
          )!.logic,
          {
            ...dependency("team", "all", [newPre!]),
            exclusive_group: "transfer-route",
          },
        );
        assert.deepEqual(
          copy.challenge_settings.find(
            (setting) => setting.challenge_id === newB,
          )!.logic,
          {
            ...dependency("global", "any", [newPre!]),
            exclusive_group: "transfer-route",
          },
        );
        assert.deepEqual(await choices(copyId), []);
        assert.equal(await count("solves", copyId), 0);
        assert.deepEqual(await choices(source), [
          { group_name: "transfer-route", challenge_id: a },
        ]);
      },
    );
  },
);
