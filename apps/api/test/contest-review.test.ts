import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, dynamicFlag } from "../src/security.js";
import { monitorRevision, recordIssuedFlags } from "../src/contest-monitor.js";
import type { WebSocket } from "ws";

test(
  "registration review, administrator monitoring and Flag provenance are scoped and revocable",
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
    async function player(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "review" + id.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1::uuid,$2,$3,$1::text)",
        [team, "Review " + team, id],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await player("admin"),
      a = await player(),
      b = await player();
    async function request(
      path: string,
      actor = admin,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) {
      return app.inject({
        url: "/api" + path,
        method: method as "GET" | "POST" | "PUT",
        headers: {
          cookie: actor.cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: body as any,
      });
    }
    async function ok(
      path: string,
      actor = admin,
      body?: unknown,
      method?: string,
    ) {
      const r = await request(path, actor, body, method);
      assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
      return r.json();
    }
    const challenge = await ok("/admin/challenges", admin, {
      title: "Provenance",
      category: "Web",
      difficulty: "入门",
      published: true,
      practice: true,
      flag_mode: "dynamic",
      initial_points: 100,
      minimum_points: 10,
      decay: 2,
      resources: {
        container: {
          image: "nebuctf/test:1",
          cpu: 100,
          memory: 64,
          ttl: 600,
          mode: "private",
          access_mode: "port",
          port: 8080,
        },
      },
    });
    const base = {
      title: "Review contest",
      description: "",
      starts_at: new Date(Date.now() + 60000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      published: true,
      team_limit: 4,
      require_review: true,
      challenge_ids: [challenge.id],
    };
    const c = await ok("/admin/contests", admin, base),
      other = await ok("/admin/contests", admin, {
        ...base,
        title: "Other contest",
        require_review: false,
      });
    await ok(`/contests/${c.id}/register`, a, { team_id: a.team });
    await ok(`/contests/${c.id}/register`, b, { team_id: b.team });
    assert.equal((await ok(`/contests/${c.id}`, a)).registered, false);
    assert.equal(
      (await ok(`/contests/${c.id}`, a)).registration.status,
      "pending",
    );
    await db.query(
      "UPDATE contests SET starts_at=now()-interval '1 minute' WHERE id=$1",
      [c.id],
    );
    assert.equal(
      (await request(`/challenges?scope=${c.id}`, a)).statusCode,
      403,
    );
    assert.equal(
      (await request(`/admin/contests/${c.id}/registrations`, a)).statusCode,
      403,
    );
    assert.equal(
      (await request(`/admin/contests/${c.id}/activity`, a)).statusCode,
      403,
    );
    assert.equal(
      (await request(`/admin/contests/${c.id}/integrity`, a)).statusCode,
      403,
    );
    const review = (team_ids: string[], status: string, review_note = "") =>
      ok(
        `/admin/contests/${c.id}/registrations`,
        admin,
        { team_ids, status, review_note },
        "PUT",
      );
    assert.equal(
      (
        await request(
          `/admin/contests/${c.id}/registrations`,
          admin,
          { team_ids: [a.team], status: "rejected" },
          "PUT",
        )
      ).statusCode,
      400,
    );
    await review([a.team], "rejected", "补充队员信息");
    assert.equal(
      (await ok(`/contests/${c.id}`, a)).registration.review_note,
      "补充队员信息",
    );
    // Changing only a group must not erase the existing review decision or reason.
    await ok(
      `/admin/contests/${c.id}/registrations`,
      admin,
      {
        team_ids: [a.team],
        group_id: null,
      },
      "PUT",
    );
    const unchangedReview = (await ok(`/contests/${c.id}`, a)).registration;
    assert.equal(unchangedReview.status, "rejected");
    assert.equal(unchangedReview.review_note, "补充队员信息");
    await ok(
      `/admin/contests/${c.id}/registrations`,
      admin,
      {
        team_ids: [a.team],
        status: "pending",
      },
      "PUT",
    );
    assert.equal(
      (await ok(`/contests/${c.id}`, a)).registration.review_note,
      "",
    );
    await review([a.team], "rejected", "请补全报名资料");
    await ok(`/contests/${c.id}/register`, a, { team_id: a.team });
    await review([a.team, b.team], "accepted");
    assert.equal((await ok(`/contests/${c.id}`, a)).registered, true);
    assert.equal(
      (await ok(`/admin/contests/${c.id}/registrations?status=accepted`)).total,
      2,
    );
    assert.equal(
      (await ok(`/admin/contests/${c.id}/registrations/${a.team}`)).members[0]
        .id,
      a.id,
    );
    const memberInfo = (
      await ok(`/admin/contests/${c.id}/registrations/${a.team}`)
    ).members[0];
    assert.ok(Number.isFinite(Date.parse(memberInfo.created_at)));
    assert.equal(memberInfo.captain, true);
    assert.equal(memberInfo.password_hash, undefined);
    assert.equal(
      (await request(`/admin/contests/${c.id}/registrations/${a.team}`, b))
        .statusCode,
      403,
    );
    assert.equal(
      (await request(`/admin/contests/${other.id}/registrations/${a.team}`))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          `/admin/contests/${other.id}/registrations`,
          admin,
          { team_ids: [a.team], status: "accepted" },
          "PUT",
        )
      ).statusCode,
      404,
    );
    await ok(`/contests/${other.id}/register`, a, { team_id: a.team });
    assert.equal(
      (await ok(`/contests/${other.id}`, a)).registration.status,
      "accepted",
    );
    // Batch validation is atomic, and it cannot silently approve a team from another contest.
    assert.equal(
      (
        await request(
          `/admin/contests/${c.id}/registrations`,
          admin,
          {
            team_ids: [a.team, crypto.randomUUID()],
            status: "suspended",
            review_note: "batch",
          },
          "PUT",
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await ok(`/contests/${c.id}`, a)).registration.status,
      "accepted",
    );
    assert.equal(
      (
        await request(
          `/admin/contests/${c.id}/registrations`,
          admin,
          { team_ids: [a.team], status: "pending" },
          "PUT",
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/admin/contests/${c.id}/registrations`,
          method: "PUT",
          headers: { cookie: admin.cookie },
          payload: {
            team_ids: [a.team],
            status: "suspended",
            review_note: "unsafe",
          },
        })
      ).statusCode,
      403,
    );
    const queued = await ok(`/challenges/${challenge.id}/instances`, a, {
      scope: c.id,
      resource_type: "container",
    });
    // Real issued resources register fingerprints; ordinary static/AWD/practice resources do not.
    await recordIssuedFlags(db, {
      scope: c.id,
      challenge_id: challenge.id,
      owner_key: `t:${b.team}`,
      kind: "dynamic_container",
      spec: { flag_mode: "dynamic", parts: [] },
    });
    const [fingerprints] = await db.query(
      "SELECT count(*)::int n FROM issued_flags",
    );
    await recordIssuedFlags(db, {
      scope: "practice",
      challenge_id: challenge.id,
      owner_key: `t:${a.team}`,
      kind: "dynamic_container",
      spec: { flag_mode: "dynamic", parts: [] },
    });
    await recordIssuedFlags(db, {
      scope: c.id,
      challenge_id: challenge.id,
      owner_key: "shared",
      kind: "static_container",
      spec: { flag_mode: "static", parts: [] },
    });
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM issued_flags"))[0]!.n,
      fingerprints!.n,
    );
    const foreignFlag = dynamicFlag(challenge.id, c.id, `t:${b.team}`);
    const result = await ok(`/challenges/${challenge.id}/submit`, a, {
      scope: c.id,
      flag: foreignFlag,
    });
    assert.equal(result.correct, false);
    const clues = await ok(`/admin/contests/${c.id}/integrity`);
    assert.equal(clues.total, 1);
    assert.equal(clues.items[0].source_team_id, b.team);
    assert.equal(clues.items[0].team_id, a.team);
    assert.equal(clues.items[0].status, "open");
    assert.equal(JSON.stringify(clues).includes(foreignFlag), false);
    assert.equal(JSON.stringify(clues).includes("flag_hash"), false);
    assert.equal((await ok(`/admin/contests/${other.id}/integrity`)).total, 0);
    const clue = clues.items[0];
    assert.equal(
      (
        await request(
          `/admin/contests/${other.id}/integrity/${clue.id}`,
          admin,
          { status: "confirmed", note: "test" },
          "PUT",
        )
      ).statusCode,
      404,
    );
    await ok(
      `/admin/contests/${c.id}/integrity/${clue.id}`,
      admin,
      { status: "dismissed", note: "管理员复核为测试" },
      "PUT",
    );
    assert.equal(
      (await ok(`/admin/contests/${c.id}/integrity/${clue.id}/reviews`)).total,
      1,
    );
    for (let n = 0; n < 12; n++)
      await ok(`/challenges/${challenge.id}/submit`, b, {
        scope: c.id,
        flag: "flag{unrecognized}",
      });
    const feed = await ok(`/admin/contests/${c.id}/activity?type=submission`);
    assert.equal(feed.total, 13);
    assert.equal(feed.items.length, 10);
    assert.equal(
      (await ok(`/admin/contests/${c.id}/activity?type=submission&page=2`))
        .items.length,
      3,
    );
    assert.equal(
      (await ok(`/admin/contests/${c.id}/activity?correct=false`)).total,
      13,
    );
    assert.ok((await monitorRevision(db, c.id)).revision);
    const snapshot: unknown[] = [];
    const socket = await app.injectWS(
      `/api/admin/contests/${c.id}/activity/ws`,
      { headers: { cookie: admin.cookie, origin: config.APP_ORIGIN } },
      {
        onInit: (s) =>
          s.on("message", (m) => snapshot.push(JSON.parse(m.toString()))),
      },
    );
    sockets.push(socket);
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(snapshot.some((m: any) => m.type === "monitor"));
    // A correct solve is counted, suspension removes it, restoration brings it back.
    await ok(`/challenges/${challenge.id}/submit`, a, {
      scope: c.id,
      flag: dynamicFlag(challenge.id, c.id, `t:${a.team}`),
    });
    await review([a.team], "suspended", "等待核实");
    assert.equal(
      (
        await request(`/challenges/${challenge.id}/submit`, a, {
          scope: c.id,
          flag: "x",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await db.query("SELECT status FROM instances WHERE id=$1", [queued.id])
      )[0]!.status,
      "stopping",
    );
    assert.equal(
      (await request(`/contests/${c.id}/activity`, a)).statusCode,
      403,
    );
    assert.equal(
      (await request(`/contests/${c.id}/unregister`, a, {})).statusCode,
      403,
    );
    assert.equal(
      (await ok(`/scoreboard?scope=${c.id}`, b)).items.some(
        (r: any) => r.id === a.team,
      ),
      false,
    );
    await review([a.team], "accepted");
    assert.equal(
      (await ok(`/scoreboard?scope=${c.id}`, b)).items.some(
        (r: any) => r.id === a.team,
      ),
      true,
    );
    // Demotion revokes a monitor socket even while its session remains valid.
    const closed = new Promise<number>((resolve) =>
      socket.once("close", resolve),
    );
    await db.query("UPDATE users SET role='user' WHERE id=$1", [admin.id]);
    const closeCode = await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("monitor did not revoke")), 6500),
      ),
    ]);
    assert.equal(closeCode, 1008);
  },
);
