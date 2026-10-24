import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, dynamicFlag, flagHash } from "../src/security.js";
import { recordContestNotice } from "../src/activity-events.js";
import {
  allPermissions,
  effectivePermissions,
} from "../src/group-permissions.js";
import { settleRound } from "../src/rounds.js";
import { contestScoringInput } from "../src/competition-rules.js";
import { AwdWorker } from "../src/awd-worker.js";

test(
  "division permissions protect actions, scoring, resources and websocket audiences",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1");
    const app = await buildApp(db);
    await app.ready();
    const sockets: WebSocket[] = [];
    t.after(async () => {
      sockets.forEach((s) => s.terminate());
      await app.close();
      await db.close();
    });
    async function player(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "group" + id.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1::uuid,$2,$3,$1::text)",
        [team, "Group " + team, id],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await player("admin"),
      official = await player(),
      guest = await player("admin"),
      observer = await player();
    const request = (
      path: string,
      actor = official,
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
      actor = official,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) => {
      const res = await request(path, actor, body, method);
      assert.equal(res.statusCode, 200, `${path}: ${res.body}`);
      return res.json();
    };
    const base = {
      title: "Scored",
      category: "Web",
      difficulty: "入门",
      published: true,
      practice: true,
      flag: "flag{sample}",
      initial_points: 100,
      minimum_points: 10,
      decay: 2,
      dynamic_score: true,
    };
    const profile = {
      image: "nebuctf/group-test:1",
      cpu: 100,
      memory: 64,
      ttl: 600,
      mode: "private",
      access_mode: "port",
      port: 8080,
    };
    const scored = await ok("/admin/challenges", admin, base),
      secret = await ok("/admin/challenges", admin, {
        ...base,
        title: "Secret",
      });
    const restricted = await ok("/admin/challenges", admin, {
      ...base,
      title: "Read only",
      resources: { container: profile },
    });
    const objective = await ok("/admin/challenges", admin, {
      ...base,
      title: "Choice",
      challenge_type: "objective",
      flag: undefined,
      objective: {
        type: "single",
        options: [
          { id: "A", text: "Alpha" },
          { id: "B", text: "Beta" },
        ],
        correct_options: ["B"],
      },
    });
    const awdp = await ok("/admin/challenges", admin, {
      ...base,
      title: "Patch",
      challenge_type: "awdp",
      flag: undefined,
      flag_mode: "dynamic",
      resources: { container: profile },
      patch_config: { checker_image: "nebuctf/checker:1" },
      parts: [
        {
          title: "Attack",
          role: "attack",
          initial_points: 100,
          minimum_points: 10,
        },
        {
          title: "Defense",
          role: "defense",
          initial_points: 100,
          minimum_points: 10,
        },
      ],
    });
    const awd = await ok("/admin/challenges", admin, {
      ...base,
      title: "Arena",
      practice: false,
      challenge_type: "awd",
      flag: undefined,
      flag_mode: "dynamic",
      resources: { container: profile },
      patch_config: { checker_image: "nebuctf/checker:1" },
      awd_config: { checker_image: "nebuctf/checker:1" },
    });
    const contest = await ok("/admin/contests", admin, {
      title: "Groups",
      published: true,
      starts_at: new Date(Date.now() + 600000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      challenge_ids: [
        scored.id,
        secret.id,
        restricted.id,
        objective.id,
        awdp.id,
        awd.id,
      ],
      challenge_settings: [
        {
          challenge_id: awd.id,
          scoring: {
            mode: "round",
            round: {},
            points: { initial_points: 100, minimum_points: 10, decay: 2 },
          },
        },
      ],
      groups: [
        { name: "Official", description: "" },
        {
          name: "Guest",
          description: "",
          permissions: {
            score: false,
            blood: false,
            dynamic: false,
            rank_overall: false,
          },
          challenge_permissions: {
            [secret.id]: { view: false },
            [restricted.id]: { submit: false, resources: false },
            [objective.id]: { submit: false },
            [awdp.id]: { resources: false },
            [awd.id]: { resources: false },
          },
        },
        {
          name: "Observer",
          description: "",
          permissions: { view: false, submit: false, resources: false },
          challenge_permissions: { [restricted.id]: { view: true } },
        },
        { name: "Closed", description: "", permissions: { join: false } },
      ],
    });
    let editable = await ok(`/admin/contests/${contest.id}`, admin);
    const group = (name: string) =>
      editable.groups.find((g: any) => g.name === name);
    await t.test(
      "defaults, strict input, closed registration and old clients preserve permissions",
      async () => {
        assert.deepEqual(effectivePermissions(), allPermissions);
        assert.equal(
          (
            await request(`/contests/${contest.id}/register`, official, {
              team_id: official.team,
              group_id: group("Closed").id,
            })
          ).statusCode,
          403,
        );
        const publicEvent = await ok(`/contests/${contest.id}`, official);
        assert.equal(
          publicEvent.groups.find((g: any) => g.name === "Closed").joinable,
          false,
        );
        assert(!JSON.stringify(publicEvent).includes("challenge_permissions"));
        const invalid = structuredClone(editable);
        invalid.groups[0].challenge_permissions = {
          [crypto.randomUUID()]: { view: false },
        };
        assert.equal(
          (
            await request(
              `/admin/contests/${contest.id}`,
              admin,
              invalid,
              "PUT",
            )
          ).statusCode,
          400,
        );
        invalid.groups[0].challenge_permissions = {
          [scored.id]: { rank_overall: false },
        };
        assert.equal(
          (
            await request(
              `/admin/contests/${contest.id}`,
              admin,
              invalid,
              "PUT",
            )
          ).statusCode,
          400,
        );
        await ok(
          `/admin/contests/${contest.id}`,
          admin,
          {
            ...editable,
            groups: editable.groups.map(({ id, name, description }: any) => ({
              id,
              name,
              description,
            })),
          },
          "PUT",
        );
        editable = await ok(`/admin/contests/${contest.id}`, admin);
        assert.equal(group("Guest").permissions.score, false);
        for (const [actor, name] of [
          [official, "Official"],
          [guest, "Guest"],
          [observer, "Observer"],
        ] as const)
          await ok(`/contests/${contest.id}/register`, actor, {
            team_id: actor.team,
            group_id: group(name).id,
          });
        await db.query(
          "UPDATE contests SET starts_at=now()-interval '5 minutes' WHERE id=$1",
          [contest.id],
        );
        editable = await ok(`/admin/contests/${contest.id}`, admin);
      },
    );
    await t.test(
      "visibility and action permissions apply to every question type and registered admins",
      async () => {
        assert.equal(
          (await request(`/challenges/${secret.id}?scope=${contest.id}`, guest))
            .statusCode,
          404,
        );
        assert.equal(
          (await request(`/challenges/${secret.id}?scope=${contest.id}`, admin))
            .statusCode,
          200,
        );
        assert.equal(
          (await request(`/challenges/${secret.id}?scope=practice`, guest))
            .statusCode,
          200,
        );
        assert(
          !(await ok(`/challenges?scope=${contest.id}`, guest)).items.some(
            (c: any) => c.id === secret.id,
          ),
        );
        assert.deepEqual(
          (await ok(`/challenges?scope=${contest.id}`, observer)).items.map(
            (c: any) => c.id,
          ),
          [restricted.id],
        );
        const exposed = await ok(
          `/challenges/${restricted.id}?scope=${contest.id}`,
          guest,
        );
        assert.equal(exposed.permissions.submit, false);
        for (const path of [
          `/challenges/${restricted.id}/instance-policy?scope=${contest.id}`,
          `/challenges/${awd.id}/arena?scope=${contest.id}`,
        ])
          assert.equal((await request(path, guest)).statusCode, 403, path);
        for (const path of [
          `/challenges/${restricted.id}/instances`,
          `/challenges/${restricted.id}/submit`,
          `/challenges/${objective.id}/answer`,
          `/challenges/${awd.id}/restart`,
        ])
          assert.equal(
            (
              await request(path, guest, {
                scope: contest.id,
                flag: "flag{sample}",
                answer: { choices: ["B"] },
              })
            ).statusCode,
            403,
            path,
          );
        const patch = await app.inject({
          url: `/api/challenges/${awdp.id}/patches?scope=${contest.id}`,
          method: "POST",
          headers: {
            cookie: guest.cookie,
            origin: config.APP_ORIGIN,
            "x-csrf-protection": "1",
          },
        });
        assert.equal(patch.statusCode, 403);
        const attachment = crypto.randomUUID();
        await db.query(
          "INSERT INTO attachments(id,challenge_id,name,size) VALUES($1,$2,'sample.zip',0)",
          [attachment, restricted.id],
        );
        assert.equal(
          (
            await request(
              `/attachments/${attachment}?scope=${contest.id}`,
              guest,
            )
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "non-scoring solves retain progress without consuming bloods or dynamic decay",
      async () => {
        await ok(`/challenges/${scored.id}/submit`, guest, {
          scope: contest.id,
          flag: "flag{sample}",
        });
        let c = await ok(`/challenges/${scored.id}?scope=${contest.id}`, guest);
        assert(c.solved);
        assert.equal(c.earned_points, 0);
        assert.equal(c.points, 100);
        await ok(`/challenges/${scored.id}/submit`, official, {
          scope: contest.id,
          flag: "flag{sample}",
        });
        c = await ok(`/challenges/${scored.id}?scope=${contest.id}`, official);
        assert.equal(c.points, 78);
        assert.equal(c.earned_points, 78);
        const board = await ok(`/scoreboard?scope=${contest.id}`, official);
        assert(!board.items.some((v: any) => v.id === guest.team));
        assert.equal(
          board.items.find((v: any) => v.id === official.team).cells[0]
            .blood_rank,
          1,
        );
        const own = await ok(
          `/scoreboard/${guest.team}?scope=${contest.id}&group=${group("Guest").id}`,
          guest,
        );
        assert.equal(own.overall_rank, null);
        assert.equal(own.group_rank, 1);
        assert.equal(own.score, 0);
        assert.equal(own.cells[0].blood_rank, null);
        const activity = await ok(`/contests/${contest.id}/activity`, official);
        assert.equal(
          activity.items.find(
            (v: any) =>
              v.type === "solve" && v.team_name === "Group " + official.team,
          ).blood_rank,
          1,
        );
        assert.equal(
          activity.items.find(
            (v: any) =>
              v.type === "solve" && v.team_name === "Group " + guest.team,
          ).blood_rank,
          null,
        );
      },
    );
    await t.test(
      "hidden questions never appear in ranking columns, cells or activity",
      async () => {
        await ok(`/challenges/${secret.id}/submit`, official, {
          scope: contest.id,
          flag: "flag{sample}",
        });
        await db.transaction((tx) =>
          recordContestNotice(tx, contest.id, secret.id, "hint"),
        );
        for (const actor of [guest, observer]) {
          const board = await ok(`/scoreboard?scope=${contest.id}`, actor);
          assert(!JSON.stringify(board).includes(secret.id));
          const detail = await ok(
            `/scoreboard/${official.team}?scope=${contest.id}`,
            actor,
          );
          assert(!JSON.stringify(detail).includes(secret.id));
          const activity = await ok(`/contests/${contest.id}/activity`, actor);
          assert(!JSON.stringify(activity).includes(secret.id));
        }
        const anonymous = await app.inject(
          `/api/scoreboard?scope=${contest.id}`,
        );
        assert.equal(anonymous.statusCode, 200);
        assert.deepEqual(
          anonymous.json().columns.map((c: any) => c.challenge_id),
          [restricted.id],
        );
      },
    );
    await t.test(
      "websocket snapshots are scoped per group including reconnect and revocation",
      async () => {
        async function connect(actor: typeof official) {
          const messages: any[] = [];
          const socket = await app.injectWS(
            `/api/contests/${contest.id}/activity/ws`,
            { headers: { cookie: actor.cookie, origin: config.APP_ORIGIN } },
            {
              onInit: (s) =>
                s.on("message", (data) =>
                  messages.push(JSON.parse(data.toString())),
                ),
            },
          );
          sockets.push(socket);
          return { socket, messages };
        }
        async function wait(check: () => boolean) {
          const deadline = Date.now() + 7000;
          while (!check() && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 20));
          assert(check(), "group-specific websocket update");
        }
        const [a, b, c] = await Promise.all([
          connect(official),
          connect(guest),
          connect(observer),
        ]);
        await wait(() =>
          [a, b, c].every((v) => v.messages.some((m) => m.type === "activity")),
        );
        assert(JSON.stringify(a.messages).includes(secret.id));
        assert(!JSON.stringify(b.messages).includes(secret.id));
        assert(!JSON.stringify(c.messages).includes(scored.id));
        b.socket.terminate();
        const again = await connect(guest);
        await wait(() => again.messages.some((m) => m.type === "activity"));
        assert(!JSON.stringify(again.messages).includes(secret.id));
        const changed = structuredClone(editable);
        changed.groups.find(
          (g: any) => g.name === "Official",
        ).challenge_permissions = { [secret.id]: { view: false } };
        await ok(`/admin/contests/${contest.id}`, admin, changed, "PUT");
        await wait(
          () => !JSON.stringify(a.messages.at(-1)).includes(secret.id),
        );
        await ok(`/admin/contests/${contest.id}`, admin, editable, "PUT");
        await wait(() => JSON.stringify(a.messages.at(-1)).includes(secret.id));
        const previous = a.messages.at(-1).data;
        const readOnly = structuredClone(editable);
        readOnly.groups[0].permissions.submit = false;
        await ok(`/admin/contests/${contest.id}`, admin, readOnly, "PUT");
        await wait(
          () =>
            a.messages.at(-1).data.permissions_version !==
            previous.permissions_version,
        );
        assert.deepEqual(a.messages.at(-1).data.items, previous.items);
        await ok(`/admin/contests/${contest.id}`, admin, editable, "PUT");
      },
    );
    await t.test(
      "scoring permissions are immutable after start; resource revocation stops private instances",
      async () => {
        for (const key of ["score", "blood", "dynamic", "rank_overall"]) {
          const changed = structuredClone(editable);
          changed.groups[0].permissions[key] = false;
          assert.equal(
            (
              await request(
                `/admin/contests/${contest.id}`,
                admin,
                changed,
                "PUT",
              )
            ).statusCode,
            409,
            key,
          );
        }
        const changed = structuredClone(editable);
        changed.groups[0].challenge_permissions = {
          [scored.id]: { score: false },
        };
        assert.equal(
          (
            await request(
              `/admin/contests/${contest.id}`,
              admin,
              changed,
              "PUT",
            )
          ).statusCode,
          409,
        );
        const instance = crypto.randomUUID(),
          shared = crypto.randomUUID();
        for (const [id, owner] of [
          [instance, "t:" + official.team],
          [shared, "shared"],
        ])
          await db.query(
            "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','running',$6,now()+interval '1 hour',now()+interval '1 hour')",
            [
              id,
              restricted.id,
              contest.id,
              owner,
              official.id,
              JSON.stringify(profile),
            ],
          );
        changed.groups[0].challenge_permissions = {
          [restricted.id]: { resources: false },
        };
        changed.groups[0].permissions.join = false;
        await ok(`/admin/contests/${contest.id}`, admin, changed, "PUT");
        const rows = await db.query(
          "SELECT id,status FROM instances WHERE id=ANY($1::uuid[])",
          [[instance, shared]],
        );
        assert.equal(rows.find((r) => r.id === instance)!.status, "stopping");
        assert.equal(rows.find((r) => r.id === shared)!.status, "running");
        assert(
          !(await ok(`/instances?scope=${contest.id}`, official)).items.some(
            (i: any) => [instance, shared].includes(i.id),
          ),
        );
        assert.equal(
          (await request(`/instances/${instance}/renew`, official, {}))
            .statusCode,
          403,
        );
        await ok(`/admin/contests/${contest.id}`, admin, editable, "PUT");
      },
    );
    await t.test(
      "round ledgers respect non-scoring and non-decaying group permissions",
      async () => {
        const round = crypto.randomUUID(),
          settings = contestScoringInput.parse({
            mode: "round",
            points: { initial_points: 100, minimum_points: 10, decay: 2 },
            round: { interval: 60, carry: true, dynamic: true },
          });
        await db.query(
          "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,1,now()-interval '1 minute',now()-interval '1 second',$4)",
          [round, contest.id, scored.id, JSON.stringify(settings)],
        );
        await db.query(
          "UPDATE solves SET created_at=now()-interval '10 seconds' WHERE scope=$1 AND challenge_id=$2",
          [contest.id, scored.id],
        );
        await db.query(
          "UPDATE registrations SET created_at=now()-interval '20 seconds' WHERE contest_id=$1",
          [contest.id],
        );
        const [r] = await db.query("SELECT * FROM contest_rounds WHERE id=$1", [
            round,
          ]),
          [c] = await db.query("SELECT * FROM challenges WHERE id=$1", [
            scored.id,
          ]);
        await db.transaction((tx) => settleRound(tx, r!, c!));
        const results = await db.query(
          "SELECT owner_key,points FROM round_results WHERE round_id=$1",
          [round],
        );
        assert.equal(
          results.find((r) => r.owner_key === "t:" + guest.team)!.points,
          0,
        );
        assert.equal(
          results.find((r) => r.owner_key === "t:" + official.team)!.points,
          78,
        );
      },
    );
    await t.test(
      "multipart AWDP and objective solves honor the same group scoring policy",
      async () => {
        const detail = await ok(`/admin/challenges/${awdp.id}`, admin),
          attack = detail.parts.find((p: any) => p.role === "attack");
        for (const actor of [guest, official])
          await ok(`/challenges/${awdp.id}/submit`, actor, {
            scope: contest.id,
            flag: dynamicFlag(
              awdp.id,
              contest.id,
              "t:" + actor.team,
              attack.id,
            ),
          });
        const g = await ok(`/challenges/${awdp.id}?scope=${contest.id}`, guest),
          o = await ok(`/challenges/${awdp.id}?scope=${contest.id}`, official);
        assert.equal(g.solved_parts, 1);
        assert.equal(g.earned_points, 0);
        assert.equal(o.parts.find((p: any) => p.id === attack.id).points, 78);
        assert.equal(o.earned_points, 78);
        const changed = structuredClone(editable);
        changed.groups.find(
          (g: any) => g.name === "Guest",
        ).challenge_permissions[objective.id] = { submit: true };
        await ok(`/admin/contests/${contest.id}`, admin, changed, "PUT");
        const answer = await ok(`/challenges/${objective.id}/answer`, guest, {
          scope: contest.id,
          answer: { choices: ["B"] },
          finalize: true,
        });
        assert.equal(answer.correct, true);
        assert.equal(
          (await ok(`/challenges/${objective.id}?scope=${contest.id}`, guest))
            .earned_points,
          0,
        );
      },
    );
    await t.test(
      "AWD ledgers and member attribution exclude non-scoring and non-decaying groups",
      async () => {
        const round = crypto.randomUUID(),
          settings = contestScoringInput.parse({
            mode: "round",
            points: { initial_points: 100, minimum_points: 10, decay: 2 },
            round: { interval: 60, dynamic: true },
          });
        await db.query(
          "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,1,now()-interval '1 minute',now()-interval '1 second',$4)",
          [round, contest.id, awd.id, JSON.stringify(settings)],
        );
        for (const [actor, attacker] of [
          [official, guest],
          [guest, official],
        ]) {
          const instance = crypto.randomUUID(),
            hash = flagHash(instance);
          await db.query(
            "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','running',$6,now()+interval '1 hour',now()+interval '1 hour')",
            [
              instance,
              awd.id,
              contest.id,
              "t:" + actor.team,
              actor.id,
              JSON.stringify(profile),
            ],
          );
          await db.query(
            "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 minute')",
            [hash, round, instance, "t:" + actor.team],
          );
          await db.query(
            "INSERT INTO awd_attacks(id,flag_hash,attacker_key,user_id) VALUES($1,$2,$3,$4)",
            [crypto.randomUUID(), hash, "t:" + attacker.team, attacker.id],
          );
          await db.query(
            "INSERT INTO awd_checks(id,round_id,instance_id,owner_key,status) VALUES($1,$2,$3,$4,'up')",
            [crypto.randomUUID(), round, instance, "t:" + actor.team],
          );
        }
        const [r] = await db.query("SELECT * FROM contest_rounds WHERE id=$1", [
          round,
        ]);
        await new AwdWorker(db).settle(
          { contest_id: contest.id, challenge_id: awd.id },
          r!,
        );
        const results = await db.query(
          "SELECT * FROM round_results WHERE round_id=$1",
          [round],
        );
        const g = results.find((r) => r.owner_key === "t:" + guest.team)!,
          o = results.find((r) => r.owner_key === "t:" + official.team)!;
        assert.equal(g.points, 0);
        assert.equal(g.details.members[0].points, 0);
        assert.equal(o.points, 178);
        assert.equal(o.details.attack, 78);
        assert.equal(o.details.members[0].points, 78);
      },
    );
  },
);
