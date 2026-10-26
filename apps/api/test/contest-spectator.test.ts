import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, flagHash } from "../src/security.js";
import { registrationCodeHash } from "../src/contest-entry.js";
import { creditSolve } from "../src/solve.js";
import { readSpectatorEngagements } from "../src/contest-spectator.js";
import { notifyContest } from "../src/activity-events.js";

test(
  "spectator permissions, admission scopes, live projections and post-contest practice",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    await app.ready();
    const sockets: WebSocket[] = [];
    t.after(async () => {
      sockets.forEach((s) => s.terminate());
      await app.close();
      await db.close();
    });
    async function actor(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "watch" + id.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, "Team " + team.slice(0, 8), id, team],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await actor("admin"),
      alice = await actor(),
      bob = await actor(),
      outsider = await actor();
    const request = (
      path: string,
      user?: typeof alice,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: body === undefined ? "GET" : method,
        headers: {
          ...(user ? { cookie: user.cookie } : {}),
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: body as any,
      });
    async function ok(
      path: string,
      user?: typeof alice,
      body?: unknown,
      method: "POST" | "PUT" = "POST",
    ) {
      const r = await request(path, user, body, method);
      assert.equal(r.statusCode, 200, path + ": " + r.body);
      return r.json();
    }
    async function contest(ended = false) {
      const id = crypto.randomUUID();
      await db.query(
        "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Spectator test',true,now()-interval '2 hours',now()+$2::interval)",
        [id, ended ? "-1 hour" : "1 hour"],
      );
      return id;
    }
    async function challenge(scope: string, title = "Public Web") {
      const id = crypto.randomUUID();
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice) VALUES($1,$2,'Web','入门','static_attachment',$3,true,false)",
        [id, title, flagHash("flag{spectator-test}")],
      );
      await db.query(
        "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
        [scope, id],
      );
      return id;
    }
    const game = await contest(),
      cid = await challenge(game);
    await db.query(
      "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
      [game, alice.team],
    );

    await t.test(
      "spectators get only configured pages; participants and staff retain their controls",
      async () => {
        assert.equal((await ok(`/contests/${game}`)).viewer_role, "spectator");
        assert.equal(
          (await ok(`/contests/${game}`, alice)).viewer_role,
          "participant",
        );
        assert.equal(
          (await ok(`/contests/${game}`, admin)).viewer_role,
          "staff",
        );
        await ok(`/contests/${game}/spectate`);
        assert.equal(
          (await request(`/challenges/${cid}?scope=${game}`)).statusCode,
          401,
        );
        assert.equal(
          (await request(`/challenges/${cid}?scope=${game}`, outsider))
            .statusCode,
          403,
        );
        await db.query(
          "UPDATE contests SET spectator_scoreboard=false WHERE id=$1",
          [game],
        );
        assert.equal(
          (await request(`/scoreboard?scope=${game}`)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/scoreboard/${alice.team}?scope=${game}`, outsider))
            .statusCode,
          403,
        );
        await ok(`/scoreboard?scope=${game}`, alice);
        await ok(`/scoreboard?scope=${game}`, admin);
        await ok(`/contests/${game}/spectate/ranking`);
        await db.query(
          "UPDATE contests SET spectator_enabled=false WHERE id=$1",
          [game],
        );
        assert.equal(
          (await request(`/contests/${game}/spectate`)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/contests/${game}/spectate/ranking`, alice))
            .statusCode,
          403,
        );
        await ok(`/contests/${game}/spectate`, admin);
        await db.query(
          "UPDATE contests SET spectator_enabled=true,spectator_scoreboard=true WHERE id=$1",
          [game],
        );
      },
    );

    await t.test(
      "invite codes and selected teams are checked server-side without disclosing their secrets",
      async () => {
        const invite = await contest();
        await db.query(
          "UPDATE contests SET registration_mode='invite',registration_code_hash=$2 WHERE id=$1",
          [invite, registrationCodeHash("invitation-123")],
        );
        assert.equal(
          (
            await request(`/contests/${invite}/register`, bob, {
              team_id: bob.team,
              invite_code: "wrong",
            })
          ).statusCode,
          403,
        );
        await ok(`/contests/${invite}/register`, bob, {
          team_id: bob.team,
          invite_code: "invitation-123",
        });
        const detail = await ok(`/contests/${invite}`),
          managed = await ok(`/admin/contests/${invite}`, admin);
        assert(!("registration_code_hash" in detail));
        assert(!("registration_code_hash" in managed));
        assert.equal(managed.registration_code_set, true);
        assert(
          !JSON.stringify(await ok("/contests")).includes(
            registrationCodeHash("invitation-123"),
          ),
        );
        const restricted = await contest();
        await db.query(
          "UPDATE contests SET registration_mode='teams',registration_team_ids=$2 WHERE id=$1",
          [restricted, [alice.team]],
        );
        assert.equal(
          (
            await request(`/contests/${restricted}/register`, bob, {
              team_id: bob.team,
            })
          ).statusCode,
          403,
        );
        await ok(`/contests/${restricted}/register`, alice, {
          team_id: alice.team,
        });
        assert.deepEqual(
          (await ok(`/contests/${restricted}`, bob)).eligible_team_ids,
          [],
        );
        assert.deepEqual(
          (await ok(`/contests/${restricted}`, alice)).eligible_team_ids,
          [alice.team],
        );
        assert(
          !("registration_team_ids" in (await ok(`/contests/${restricted}`))),
        );
      },
    );

    await t.test(
      "admin settings persist independently, validate admission and keep invitation secrets write-only",
      async () => {
        const input = {
          title: "Admin access",
          starts_at: new Date(Date.now() + 3600000).toISOString(),
          ends_at: new Date(Date.now() + 7200000).toISOString(),
          published: true,
          challenge_ids: [],
          spectator_enabled: false,
          spectator_scoreboard: true,
          practice_mode: true,
          registration_mode: "invite",
        };
        assert.equal(
          (await request("/admin/contests", admin, input)).statusCode,
          400,
        );
        const created = await ok("/admin/contests", admin, {
          ...input,
          registration_code: "secret-code",
        });
        const result = await ok(`/admin/contests/${created.id}`, admin);
        assert.equal(result.spectator_enabled, false);
        assert.equal(result.spectator_scoreboard, true);
        assert.equal(result.practice_mode, true);
        assert.equal(result.registration_code_set, true);
        assert(!JSON.stringify(result).includes("secret-code"));
        assert(!("registration_code_hash" in result));
        await ok(
          `/admin/contests/${created.id}`,
          admin,
          { ...input, registration_code: "" },
          "PUT",
        );
        await ok(`/contests/${created.id}/register`, outsider, {
          team_id: outsider.team,
          invite_code: "secret-code",
        });
        assert.equal(
          (await request(`/contests/${created.id}/spectate`)).statusCode,
          403,
        );
        await ok(`/scoreboard?scope=${created.id}`);
        assert.equal(
          (
            await request(
              `/admin/contests/${created.id}`,
              admin,
              {
                ...input,
                registration_mode: "teams",
                registration_team_ids: [],
              },
              "PUT",
            )
          ).statusCode,
          400,
        );
        await ok(
          `/admin/contests/${created.id}`,
          admin,
          {
            ...input,
            registration_mode: "teams",
            registration_team_ids: [alice.team],
          },
          "PUT",
        );
        const lookup = await ok(`/admin/teams?ids=${alice.team}`, admin);
        assert.equal(lookup.items.length, 1);
        assert.equal(lookup.items[0].id, alice.team);
        assert.equal((await request("/admin/teams", alice)).statusCode, 403);
      },
    );

    await t.test(
      "practice keeps review and group permissions, and suspended teams cannot bypass access",
      async () => {
        const scope = await contest(true),
          cid = await challenge(scope),
          group = crypto.randomUUID();
        await db.query(
          "UPDATE contests SET practice_mode=true,require_review=true WHERE id=$1",
          [scope],
        );
        await db.query(
          "INSERT INTO contest_groups(id,contest_id,name,position,permissions) VALUES($1,$2,'Observers',0,$3)",
          [
            group,
            scope,
            JSON.stringify({
              join: true,
              view: true,
              submit: false,
              resources: false,
            }),
          ],
        );
        await ok(`/contests/${scope}/register`, outsider, {
          team_id: outsider.team,
          group_id: group,
        });
        assert.equal(
          (await ok(`/contests/${scope}`, outsider)).registration.status,
          "pending",
        );
        assert.equal(
          (await request(`/challenges/${cid}?scope=${scope}`, outsider))
            .statusCode,
          403,
        );
        await db.query(
          "UPDATE registrations SET status='accepted' WHERE contest_id=$1",
          [scope],
        );
        await ok(`/challenges/${cid}?scope=${scope}`, outsider);
        assert.equal(
          (
            await request(`/challenges/${cid}/submit`, outsider, {
              scope,
              flag: "flag{spectator-test}",
            })
          ).statusCode,
          403,
        );
        await db.query(
          "UPDATE registrations SET status='suspended' WHERE contest_id=$1",
          [scope],
        );
        assert.equal(
          (await request(`/challenges/${cid}?scope=${scope}`, outsider))
            .statusCode,
          403,
        );
      },
    );

    await t.test(
      "practice registration and solves never change the official board, bloods or dynamic points",
      async () => {
        const scope = await contest(true),
          first = await challenge(scope, "Official solve"),
          second = await challenge(scope, "Practice solve");
        await db.query(
          "INSERT INTO registrations(contest_id,team_id,created_at) VALUES($1,$2,now()-interval '90 minutes')",
          [scope, alice.team],
        );
        await db.query(
          "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '80 minutes')",
          [crypto.randomUUID(), first, scope, "t:" + alice.team, alice.id],
        );
        assert.equal(
          (
            await request(`/contests/${scope}/register`, bob, {
              team_id: bob.team,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (await request(`/challenges/${second}?scope=${scope}`, alice))
            .statusCode,
          403,
        );
        await db.query("UPDATE contests SET practice_mode=true WHERE id=$1", [
          scope,
        ]);
        const before = await ok(`/scoreboard?scope=${scope}`);
        await ok(`/contests/${scope}/register`, bob, { team_id: bob.team });
        const registration = await ok(`/contests/${scope}`, bob);
        assert.equal(registration.practice_active, true);
        assert.equal(registration.registration.practice_only, true);
        assert.equal(registration.writeup_access, false);
        const q = await ok(`/challenges/${second}?scope=${scope}`, bob);
        assert.equal(q.contest_practice, true);
        assert.equal(q.permissions.score, false);
        assert.equal(
          (
            await ok(`/challenges/${second}/submit`, bob, {
              scope,
              flag: "flag{spectator-test}",
            })
          ).correct,
          true,
        );
        assert.equal(
          (
            await ok(`/challenges/${second}/submit`, alice, {
              scope,
              flag: "flag{spectator-test}",
            })
          ).correct,
          true,
        );
        assert.equal(
          (await ok(`/challenges/${second}?scope=${scope}`, alice)).solved,
          true,
        );
        assert.deepEqual(await ok(`/scoreboard?scope=${scope}`), before);
        const activity = await ok(`/contests/${scope}/activity`, alice);
        assert(!activity.items.some((e: any) => e.challenge_id === second));
        const timing = await ok(`/contests/${scope}/timing`, bob);
        assert(
          timing.phases.every(
            (p: any) => p.status === "active" && p.deadline_at === null,
          ),
        );
        assert.equal(
          (await request(`/contests/${scope}/start/practical`, bob, {}))
            .statusCode,
          403,
        );
        const [record] = await db.query(
          "SELECT contest_practice FROM solves WHERE scope=$1 AND challenge_id=$2 AND owner_key=$3",
          [scope, second, "t:" + bob.team],
        );
        assert.equal(record!.contest_practice, true);
        await db.query("UPDATE contests SET practice_mode=false WHERE id=$1", [
          scope,
        ]);
        assert.equal(
          (
            await request(`/challenges/${second}/submit`, bob, {
              scope,
              flag: "flag{spectator-test}",
            })
          ).statusCode,
          403,
        );
      },
    );

    await t.test(
      "objective practice answers preserve formal answers and permit corrections; resource TTL extends past the ended contest",
      async () => {
        const scope = await contest(true),
          question = await challenge(scope, "Objective"),
          container = await challenge(scope, "Container");
        await db.query("UPDATE contests SET practice_mode=true WHERE id=$1", [
          scope,
        ]);
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [scope, alice.team],
        );
        await db.query(
          "UPDATE challenges SET challenge_type='objective',objective=$2 WHERE id=$1",
          [
            question,
            JSON.stringify({
              type: "single",
              options: [
                { id: "A", text: "A" },
                { id: "B", text: "B" },
              ],
              correct_options: ["B"],
              blanks: [],
            }),
          ],
        );
        await db.query(
          "INSERT INTO objective_answers(id,challenge_id,scope,owner_key,user_id,answer,correct,finalized_at) VALUES($1,$2,$3,$4,$5,'{\"choices\":[\"A\"]}',false,now()-interval '90 minutes')",
          [crypto.randomUUID(), question, scope, "t:" + alice.team, alice.id],
        );
        assert.equal(
          (await ok(`/challenges/${question}/answer?scope=${scope}`, alice))
            .practice,
          true,
        );
        assert.equal(
          (
            await ok(`/challenges/${question}/answer`, alice, {
              scope,
              finalize: true,
              answer: { choices: ["A"] },
            })
          ).correct,
          false,
        );
        assert.equal(
          (
            await ok(`/challenges/${question}/answer`, alice, {
              scope,
              finalize: true,
              answer: { choices: ["B"] },
            })
          ).correct,
          true,
        );
        const answers = await db.query(
          "SELECT correct,contest_practice FROM objective_answers WHERE challenge_id=$1 ORDER BY contest_practice",
          [question],
        );
        assert.deepEqual(answers, [
          { correct: false, contest_practice: false },
          { correct: true, contest_practice: true },
        ]);
        await db.query(
          "UPDATE challenges SET kind='dynamic_container',image='nebuctf/practice:test' WHERE id=$1",
          [container],
        );
        const instance = await ok(`/challenges/${container}/instances`, alice, {
          scope,
        });
        const [row] = await db.query(
          "SELECT max_expires_at,expires_at FROM instances WHERE id=$1",
          [instance.id],
        );
        assert(new Date(row!.max_expires_at).getTime() > Date.now() + 3600000);
        assert(new Date(row!.expires_at).getTime() > Date.now());
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          instance.id,
        ]);
      },
    );

    await t.test(
      "multi-flag and AWDP practice retain progress without restarting rounds; AWD stays read-only",
      async () => {
        const scope = await contest(true),
          multipart = await challenge(scope, "Practice AWDP"),
          awd = await challenge(scope, "Ended AWD");
        await db.query("UPDATE contests SET practice_mode=true WHERE id=$1", [
          scope,
        ]);
        await db.query(
          "INSERT INTO registrations(contest_id,team_id,practice_only) VALUES($1,$2,true)",
          [scope, alice.team],
        );
        await db.query(
          "UPDATE challenges SET challenge_type='awdp' WHERE id=$1",
          [multipart],
        );
        await db.query(
          "UPDATE challenges SET challenge_type='awd' WHERE id=$1",
          [awd],
        );
        const attack = crypto.randomUUID(),
          defense = crypto.randomUUID();
        for (const [i, part] of [attack, defense].entries())
          await db.query(
            "INSERT INTO challenge_parts(id,challenge_id,title,position,flag_hash,initial_points,minimum_points,role) VALUES($1,$2,$3,$4,$5,100,100,$6)",
            [
              part,
              multipart,
              i ? "Defense" : "Attack",
              i,
              flagHash("flag{spectator-test}"),
              i ? "defense" : "attack",
            ],
          );
        const scoring = {
          mode: "round",
          points: { initial_points: 100, minimum_points: 100, decay: 10 },
          parts: [],
          round: { interval: 60, carry: false },
        };
        await db.query(
          "UPDATE contest_challenges SET scoring=$2 WHERE contest_id=$1",
          [scope, JSON.stringify(scoring)],
        );
        const first = await ok(`/challenges/${multipart}/submit`, alice, {
          scope,
          flag: "flag{spectator-test}",
        });
        assert.equal(first.completed, false);
        // A queued practice patch retains its identity even if practice is closed while the checker runs.
        await db.query("UPDATE contests SET practice_mode=false WHERE id=$1", [
          scope,
        ]);
        const [question] = await db.query(
          "SELECT * FROM challenges WHERE id=$1",
          [multipart],
        );
        await creditSolve(
          db,
          { ...question, contest_practice: true, contest_scoring: scoring },
          scope,
          "t:" + alice.team,
          alice.id,
          { id: defense },
        );
        await db.query("UPDATE contests SET practice_mode=true WHERE id=$1", [
          scope,
        ]);
        const progress = await ok(
          `/challenges/${multipart}?scope=${scope}`,
          alice,
        );
        assert.equal(progress.solved_parts, 2);
        assert.equal(progress.round, null);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM part_solves WHERE scope=$1 AND contest_practice",
              [scope],
            )
          )[0]!.n,
          2,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM contest_rounds WHERE contest_id=$1",
              [scope],
            )
          )[0]!.n,
          0,
        );
        assert.equal((await ok(`/scoreboard?scope=${scope}`)).items.length, 0);
        const closed = await ok(`/challenges/${awd}?scope=${scope}`, alice);
        assert.equal(closed.permissions.submit, false);
        assert.equal(closed.permissions.resources, false);
        assert.equal(
          (await request(`/challenges/${awd}/instances`, alice, { scope }))
            .statusCode,
          403,
        );
      },
    );

    await t.test(
      "live engagement broadcasts contain only recent eligible teams on public unsolved questions",
      async () => {
        const scope = await contest(),
          visible = await challenge(scope),
          hidden = await challenge(scope, "Private question"),
          past = Date.now() - 100000;
        await db.query(
          "INSERT INTO registrations(contest_id,team_id,status) VALUES($1,$2,'accepted'),($1,$3,'pending')",
          [scope, alice.team, bob.team],
        );
        const add = async (
          cid: string,
          who: typeof alice,
          practice = false,
          at = Date.now(),
        ) =>
          db.query(
            "INSERT INTO submissions(id,challenge_id,user_id,owner_key,scope,correct,contest_practice,created_at) VALUES($1,$2,$3,$4,$5,false,$6,$7)",
            [
              crypto.randomUUID(),
              cid,
              who.id,
              "t:" + who.team,
              scope,
              practice,
              new Date(at),
            ],
          );
        await add(visible, alice, false, past);
        await add(visible, alice, true);
        await add(visible, bob);
        await add(hidden, alice);
        const [ct] = await db.query("SELECT * FROM contests WHERE id=$1", [
          scope,
        ]);
        assert.deepEqual(
          await readSpectatorEngagements(db, ct!, [visible]),
          [],
        );
        await add(visible, alice);
        const rows = await readSpectatorEngagements(db, ct!, [visible]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.challenge_id, visible);
        assert.deepEqual(
          rows[0]!.teams.map((t: any) => t.id),
          [alice.team],
        );
        assert(!JSON.stringify(rows).includes("submitted_hash"));
        assert.deepEqual(
          await readSpectatorEngagements(
            db,
            { ...ct, freeze_at: new Date(Date.now() - 1) },
            [visible],
          ),
          [],
        );
        assert.deepEqual(
          await readSpectatorEngagements(
            db,
            { ...ct, ends_at: new Date(Date.now() - 1) },
            [visible],
          ),
          [],
        );
      },
    );

    await t.test(
      "anonymous sockets respect origin, common challenge visibility, freeze and access revocation",
      async () => {
        const scope = await contest(),
          visible = await challenge(scope, "Visible"),
          hidden = await challenge(scope, "Hidden division question");
        const group = crypto.randomUUID();
        await db.query(
          "INSERT INTO contest_groups(id,contest_id,name,position,challenge_permissions) VALUES($1,$2,'Limited',0,$3)",
          [group, scope, JSON.stringify({ [hidden]: { view: false } })],
        );
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [scope, alice.team],
        );
        const path = `/api/contests/${scope}/spectate/ws`,
          frames: any[] = [];
        await assert.rejects(
          app.injectWS(path, { headers: { origin: "https://wrong.invalid" } }),
          /403/,
        );
        const ws = await app.injectWS(
          path,
          { headers: { origin: config.APP_ORIGIN } },
          {
            onInit: (socket) =>
              socket.on("message", (data) =>
                frames.push(JSON.parse(String(data))),
              ),
          },
        );
        sockets.push(ws);
        const wait = async (predicate: () => boolean) => {
          const until = Date.now() + 7000;
          while (!predicate() && Date.now() < until)
            await new Promise((r) => setTimeout(r, 20));
          assert(predicate(), "spectator socket updated");
        };
        await wait(() => frames.length > 0);
        const secondFrames: any[] = [];
        const second = await app.injectWS(
          path,
          { headers: { origin: config.APP_ORIGIN } },
          {
            onInit: (socket) =>
              socket.on("message", (data) =>
                secondFrames.push(JSON.parse(String(data))),
              ),
          },
        );
        sockets.push(second);
        await wait(() => secondFrames.length > 0);
        assert(!JSON.stringify(frames).includes("Hidden division question"));
        assert(!JSON.stringify(frames).includes("flag_hash"));
        await ok(`/challenges/${visible}/submit`, alice, {
          scope,
          flag: "flag{spectator-test}",
        });
        await wait(() =>
          frames
            .at(-1)
            ?.data.events.some(
              (e: any) => e.challenge_id === visible && e.blood_rank === 1,
            ),
        );
        const round = crypto.randomUUID(),
          instance = crypto.randomUUID(),
          attackId = crypto.randomUUID(),
          hash = flagHash("flag{private-awd}");
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [scope, bob.team],
        );
        await db.query(
          "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,1,now()-interval '1 minute',now()+interval '1 minute','{}')",
          [round, scope, visible],
        );
        await db.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','stopped','{}',now(),now())",
          [instance, visible, scope, "t:" + bob.team, bob.id],
        );
        await db.query(
          "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 minute')",
          [hash, round, instance, "t:" + bob.team],
        );
        await db.query(
          "INSERT INTO awd_attacks(id,flag_hash,attacker_key,user_id) VALUES($1,$2,$3,$4)",
          [attackId, hash, "t:" + alice.team, alice.id],
        );
        await notifyContest(db, scope);
        await wait(() =>
          frames.at(-1)?.data.events.some((e: any) => e.type === "attack"),
        );
        const attackEvent = frames
          .at(-1)
          .data.events.find((e: any) => e.type === "attack");
        assert.equal(attackEvent.team_id, alice.team);
        assert.equal(attackEvent.target_team_id, bob.team);
        assert.equal(frames.at(-1).data.stats.attacks, 1);
        assert(!JSON.stringify(frames).includes(hash));
        await db.query(
          "UPDATE contests SET freeze_at=now()-interval '1 minute' WHERE id=$1",
          [scope],
        );
        await notifyContest(db, scope);
        await wait(() => frames.at(-1)?.data.frozen);
        assert.equal(
          frames.at(-1).data.events.filter((e: any) => e.type === "solve")
            .length,
          0,
        );
        assert.equal(frames.at(-1).data.stats.solves, 0);
        assert.equal(frames.at(-1).data.stats.attacks, 0);
        const closed = new Promise<number>((resolve) =>
          ws.once("close", (code) => resolve(code)),
        );
        await db.query(
          "UPDATE contests SET spectator_enabled=false WHERE id=$1",
          [scope],
        );
        await notifyContest(db, scope);
        await wait(() => ws.readyState >= 2);
        assert.equal(await closed, 1008);
        assert.equal(
          (await request(`/contests/${scope}/spectate`)).statusCode,
          403,
        );
        await db.query("UPDATE contests SET published=false WHERE id=$1", [
          scope,
        ]);
        assert.equal(
          (await request(`/contests/${scope}/spectate`, outsider)).statusCode,
          404,
        );
      },
    );
  },
);
