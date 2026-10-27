import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { checkRegistrationWindow } from "../src/contest-entry.js";

test("registration windows include opening and exclude closing", () => {
  const c = {
    id: "test",
    registration_opens_at: new Date(1000),
    registration_closes_at: new Date(2000),
    ends_at: new Date(3000),
  };
  assert.throws(() => checkRegistrationWindow(c, 999), /报名尚未开放/);
  assert.doesNotThrow(() => checkRegistrationWindow(c, 1000));
  assert.doesNotThrow(() => checkRegistrationWindow(c, 1999));
  assert.throws(() => checkRegistrationWindow(c, 2000), /报名已截止/);
});

test(
  "contest registration schedule is enforced and preserves existing contests",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    await app.ready();
    t.after(async () => {
      await app.close();
      await db.close();
    });
    async function actor(role = "user") {
      const id = crypto.randomUUID(),
        team = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "schedule" + id.slice(0, 8), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, "Schedule " + team, id, team],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await actor("admin"),
      player = await actor();
    const time = (hours: number) =>
      new Date(Date.now() + hours * 3600000).toISOString();
    const base = {
      title: "Schedule cup",
      starts_at: time(1),
      ends_at: time(4),
      published: true,
    };
    const request = (
      path: string,
      user = admin,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: method as "GET" | "POST" | "PUT",
        headers: {
          cookie: user.cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: body as any,
      });
    async function create(extra = {}) {
      const response = await request("/admin/contests", admin, {
        ...base,
        ...extra,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().id as string;
    }
    async function join(id: string, user = player) {
      return request(`/contests/${id}/register`, user, { team_id: user.team });
    }
    await t.test(
      "default window allows registration during the contest",
      async () => {
        const id = await create({ starts_at: time(-1) });
        assert.equal((await join(id)).statusCode, 200);
        const detail = (await request(`/contests/${id}`, player)).json();
        assert.equal(detail.registration_opens_at, null);
        assert.equal(detail.registration_closes_at, null);
        assert.equal(detail.registered, true);
      },
    );
    await t.test(
      "future opening denies competitors and administrators without writing a registration",
      async () => {
        const id = await create({
          registration_opens_at: time(0.5),
          registration_closes_at: time(2),
        });
        for (const user of [player, admin]) {
          const response = await join(id, user);
          assert.equal(response.statusCode, 403);
          assert.match(response.body, /报名尚未开放/);
          assert.match(response.body, /查看赛程/);
        }
        assert.equal(
          (
            await db.query("SELECT * FROM registrations WHERE contest_id=$1", [
              id,
            ])
          ).length,
          0,
        );
      },
    );
    await t.test(
      "registration can overlap competition and still requires review",
      async () => {
        const id = await create({
          starts_at: time(-1),
          registration_opens_at: time(-2),
          registration_closes_at: time(1),
          require_review: true,
        });
        assert.equal((await join(id)).statusCode, 200);
        assert.equal(
          (await request(`/contests/${id}`, player)).json().registration.status,
          "pending",
        );
      },
    );
    await t.test(
      "closed registration rejects direct API calls while the contest is still running",
      async () => {
        const id = await create({
          starts_at: time(-1),
          registration_opens_at: time(-3),
          registration_closes_at: time(-2),
        });
        const response = await join(id);
        assert.equal(response.statusCode, 403);
        assert.match(response.body, /报名已截止/);
      },
    );
    await t.test(
      "invalid schedules and malformed timestamps cannot be saved",
      async () => {
        for (const extra of [
          { registration_opens_at: time(2), registration_closes_at: time(1) },
          {
            registration_opens_at: base.ends_at,
            registration_closes_at: base.ends_at,
          },
          { registration_opens_at: time(5) },
          { registration_closes_at: time(5) },
          { registration_opens_at: "not-a-date" },
        ])
          assert.equal(
            (await request("/admin/contests", admin, { ...base, ...extra }))
              .statusCode,
            400,
          );
      },
    );
    await t.test(
      "updates preserve omitted dates, validate merged schedules and allow explicit reset",
      async () => {
        const opens = time(-2),
          closes = time(3);
        const id = await create({
          registration_opens_at: opens,
          registration_closes_at: closes,
        });
        assert.equal(
          (
            await request(
              `/admin/contests/${id}`,
              admin,
              { ...base, title: "Edited" },
              "PUT",
            )
          ).statusCode,
          200,
        );
        const data = (await request(`/admin/contests/${id}`)).json();
        assert.equal(data.registration_opens_at, opens);
        assert.equal(data.registration_closes_at, closes);
        assert.equal(
          (
            await request(
              `/admin/contests/${id}`,
              admin,
              { ...base, ends_at: time(2) },
              "PUT",
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request(
              `/admin/contests/${id}`,
              admin,
              {
                ...base,
                registration_opens_at: null,
                registration_closes_at: null,
              },
              "PUT",
            )
          ).statusCode,
          200,
        );
        assert.equal(
          (await request(`/contests/${id}`, player)).json()
            .registration_closes_at,
          null,
        );
      },
    );
    await t.test(
      "post-contest practice reopens registration without changing official rosters",
      async () => {
        const id = await create({
          starts_at: time(-3),
          ends_at: time(-1),
          registration_opens_at: time(-5),
          registration_closes_at: time(-4),
          practice_mode: true,
        });
        assert.equal((await join(id)).statusCode, 200);
        assert.equal(
          (await request(`/contests/${id}`, player)).json().registration
            .practice_only,
          true,
        );
        assert.equal(
          (
            await db.query(
              "SELECT * FROM contest_members WHERE contest_id=$1",
              [id],
            )
          ).length,
          0,
        );
      },
    );
  },
);
