import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import { containerStartPolicy } from "../src/container-start-policy.js";
import { exportContent } from "../src/content-transfer.js";

test(
  "contest start limits inherit, override, reserve atomically and count only successful starts",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    const user = crypto.randomUUID(),
      teammate = crypto.randomUUID(),
      team = crypto.randomUUID(),
      contest = crypto.randomUUID();
    const token = crypto.randomUUID();
    for (const uid of [user, teammate])
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test','admin')",
        [uid, "start" + uid.slice(0, 8), uid + "@test.invalid"],
      );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), user],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Start limit team',$2,'test')",
      [team, user],
    );
    for (const uid of [user, teammate])
      await db.query("INSERT INTO memberships(team_id,user_id) VALUES($1,$2)", [
        team,
        uid,
      ]);
    await db.query(
      "INSERT INTO contests(id,title,starts_at,ends_at,published,resource_limits) VALUES($1,'Start limit',now()-interval '1 hour',now()+interval '1 hour',true,'{}')",
      [contest],
    );
    await db.query(
      "INSERT INTO registrations(contest_id,team_id,status) VALUES($1,$2,'accepted')",
      [contest, team],
    );
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const cid of ids) {
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,image,flag_hash,published,practice) VALUES($1,'Start target','Web','入门','dynamic_container','nebuctf/example-web:local','',true,false)",
        [cid],
      );
      await db.query(
        "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
        [contest, cid],
      );
    }
    const cid = ids[0]!,
      owner = "t:" + team,
      headers = {
        cookie: `${sessionCookie}=${token}`,
        origin: config.APP_ORIGIN,
        "x-csrf-protection": "1",
      };
    const get = (url: string) => app.inject({ url: "/api" + url, headers });
    const post = (url: string, payload: object) =>
      app.inject({ url: "/api" + url, headers, method: "POST", payload });
    const policy = () => containerStartPolicy(db, contest, owner, cid);
    assert.equal(await policy(), null);
    await db.query("UPDATE contests SET resource_limits=$2 WHERE id=$1", [
      contest,
      JSON.stringify({ container_starts_per_team: 1 }),
    ]);
    assert.equal((await policy())!.remaining, 1);
    assert.equal(await containerStartPolicy(db, "practice", owner, cid), null);
    assert.equal(await containerStartPolicy(db, contest, "shared", cid), null);
    const created = await Promise.all([
      post(`/challenges/${cid}/instances`, { scope: contest }),
      post(`/challenges/${cid}/instances`, { scope: contest }),
    ]);
    for (const result of created)
      assert.equal(result.statusCode, 200, result.body);
    assert.equal(created[0]!.json().id, created[1]!.json().id);
    const iid = created[0]!.json().id;
    assert.deepEqual(await policy(), {
      limit: 1,
      used: 0,
      pending: 1,
      remaining: 0,
      blocked: true,
    });
    await db.query("UPDATE instances SET status='failed' WHERE id=$1", [iid]);
    assert.equal((await policy())!.remaining, 1);
    await db.query("DELETE FROM rate_limits");
    const next = await post(`/challenges/${cid}/instances`, { scope: contest });
    assert.equal(next.statusCode, 200, next.body);
    await db.query(
      "UPDATE instances SET status='stopped',started_at=now() WHERE id=$1",
      [next.json().id],
    );
    await db.query("DELETE FROM rate_limits");
    const blocked = await post(`/challenges/${cid}/instances`, {
      scope: contest,
    });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.match(blocked.json().error, /次数已用完/);
    assert.equal(
      (await get(`/challenges/${cid}/instance-policy?scope=${contest}`)).json()
        .starts.remaining,
      0,
    );
    assert.equal(
      (await containerStartPolicy(db, contest, owner, ids[1]!))!.remaining,
      1,
    );
    await db.query("UPDATE instances SET status='failed' WHERE id=$1", [
      next.json().id,
    ]);
    assert.equal(
      (await policy())!.used,
      1,
      "later failure does not refund a completed start",
    );
    await db.query(
      "UPDATE contest_challenges SET container_start_limit=$3 WHERE contest_id=$1 AND challenge_id=$2",
      [contest, cid, JSON.stringify({ mode: "unlimited", count: null })],
    );
    assert.equal(await policy(), null);
    await db.query(
      "UPDATE contest_challenges SET container_start_limit=$3 WHERE contest_id=$1 AND challenge_id=$2",
      [contest, cid, JSON.stringify({ mode: "custom", count: 2 })],
    );
    assert.equal((await policy())!.remaining, 1);
    const adminContest = (await get(`/admin/contests/${contest}`)).json();
    assert.deepEqual(
      adminContest.challenge_settings.find((s: any) => s.challenge_id === cid)
        .container_start_limit,
      { mode: "custom", count: 2 },
    );
    const saved = await app.inject({
      url: `/api/admin/contests/${contest}`,
      method: "PUT",
      headers,
      payload: {
        ...adminContest,
        challenge_settings: adminContest.challenge_settings.map((s: any) => ({
          ...s,
          container_start_limit:
            s.challenge_id === cid
              ? { mode: "custom", count: 0 }
              : s.container_start_limit,
        })),
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await policy())!.remaining, 0);
    const prohibited = await post(`/challenges/${cid}/instances`, {
      scope: contest,
    });
    assert.equal(prohibited.statusCode, 409, prohibited.body);
    const { manifest } = await exportContent(db, "contest", contest);
    assert.deepEqual(
      manifest.contest!.config.challenge_settings!.find(
        (s) => s.challenge_id === cid,
      )!.container_start_limit,
      { mode: "custom", count: 0 },
    );
  },
);
