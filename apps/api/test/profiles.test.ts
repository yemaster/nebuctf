import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";

test(
  "private profiles are self-managed and registration details retain the contest roster",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    const people = [];
    for (const role of ["admin", "user", "user", "user"]) {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'private-password-hash',$4)",
        [id, `profile_${id.slice(0, 8)}`, `${id}@example.test`, role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      people.push({ id, cookie: `${sessionCookie}=${token}` });
    }
    const [admin, captain, former, late] = people as [
      (typeof people)[number],
      (typeof people)[number],
      (typeof people)[number],
      (typeof people)[number],
    ];
    const request = (
      url: string,
      actor = captain,
      payload?: unknown,
      csrf = true,
    ) =>
      app.inject({
        url: `/api${url}`,
        method: payload === undefined ? "GET" : "PUT",
        headers: {
          cookie: actor?.cookie ?? "",
          ...(csrf
            ? { origin: config.APP_ORIGIN, "x-csrf-protection": "1" }
            : {}),
        },
        payload: payload as any,
      });
    const empty = { real_name: "", student_number: "", phone: "" };
    const profile = {
      real_name: "测试选手",
      student_number: "20260001",
      phone: "+86 138 0000 0000",
    };
    assert.equal(
      (await app.inject({ url: "/api/account/profile" })).statusCode,
      401,
    );
    assert.deepEqual((await request("/account/profile")).json(), empty);
    assert.equal(
      (await request("/account/profile", captain, profile, false)).statusCode,
      403,
    );
    for (const payload of [
      { ...profile, id: former.id },
      { ...profile, role: "admin" },
      { ...profile, email_verified_at: new Date().toISOString() },
      { ...profile, real_name: "a".repeat(81) },
      { ...profile, student_number: "a".repeat(49) },
      { ...profile, phone: "a".repeat(33) },
      { ...profile, real_name: null },
    ])
      assert.equal(
        (await request("/account/profile", captain, payload)).statusCode,
        400,
      );
    const saved = await request("/account/profile", captain, {
      ...profile,
      real_name: `  ${profile.real_name}  `,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json(), profile);
    assert.equal(saved.headers["cache-control"], "no-store");
    assert.deepEqual((await request("/account/profile", former)).json(), empty);
    assert.deepEqual(
      (await request(`/account/profile?user_id=${former.id}`)).json(),
      profile,
    );
    const me = (await request("/me")).json().user;
    assert.equal(me.role, "user");
    for (const key of ["real_name", "student_number", "phone", "password_hash"])
      assert.equal(me[key], undefined);
    const team = crypto.randomUUID(),
      contest = crypto.randomUUID();
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1::uuid,$2,$3,$1::text)",
      [team, `Profile ${team}`, captain.id],
    );
    await db.query(
      "INSERT INTO contests(id,title,starts_at,ends_at) VALUES($1,'Profile Cup',now()-interval '2 days',now()-interval '1 day')",
      [contest],
    );
    await db.query(
      "INSERT INTO registrations(contest_id,team_id,status,accepted_at) VALUES($1,$2,'accepted',now())",
      [contest, team],
    );
    await db.query(
      "INSERT INTO memberships(user_id,team_id) VALUES($1,$3),($2,$3)",
      [captain.id, late.id, team],
    );
    await db.query(
      "INSERT INTO contest_members(contest_id,team_id,user_id) VALUES($1,$2,$3),($1,$2,$4)",
      [contest, team, captain.id, former.id],
    );
    await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
      captain.id,
    ]);
    const path = `/admin/contests/${contest}/registrations/${team}`;
    assert.equal((await request(path)).statusCode, 403);
    const response = await request(path, admin);
    assert.equal(response.statusCode, 200, response.body);
    const members = response.json().members;
    assert.equal(members.length, 3);
    assert.equal(members[0].id, captain.id);
    for (const [key, value] of Object.entries(profile))
      assert.equal(members[0][key], value);
    assert.equal(members[0].registered, true);
    assert.equal(members[0].current_member, true);
    assert.ok(members[0].email_verified_at);
    assert.equal(members.find((m: any) => m.id === former.id).registered, true);
    assert.equal(
      members.find((m: any) => m.id === former.id).current_member,
      false,
    );
    assert.equal(members.find((m: any) => m.id === late.id).registered, false);
    assert.equal(
      members.find((m: any) => m.id === late.id).current_member,
      true,
    );
    assert.ok(members.every((m: any) => m.password_hash === undefined));
    assert.equal(
      (
        await request(
          `/admin/contests/${crypto.randomUUID()}/registrations/${team}`,
          admin,
        )
      ).statusCode,
      404,
    );
    assert.deepEqual(
      (await request("/account/profile", captain, empty)).json(),
      empty,
    );
  },
);
