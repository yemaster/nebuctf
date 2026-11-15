import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";

test("group invitation codes isolate registration and stay private", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1");
  const app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  async function player(role = "user") {
    const id = crypto.randomUUID(),
      team = crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
      [id, `group-${id.slice(0, 8)}`, `${id}@example.test`, role],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), id],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
      [team, `Team ${team}`, id, digest(team)],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      id,
      team,
    ]);
    return { team, cookie: `${sessionCookie}=${token}` };
  }
  const admin = await player("admin"),
    a = await player(),
    b = await player(),
    c = await player();
  async function request(
    path: string,
    actor = admin,
    body?: unknown,
    method: "POST" | "PUT" = "POST",
  ) {
    return app.inject({
      url: `/api${path}`,
      method: body === undefined ? "GET" : method,
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
    method: "POST" | "PUT" = "POST",
  ) {
    const res = await request(path, actor, body, method);
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  }
  const base = {
    title: "Group invitations",
    published: true,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
  };
  const created = await ok("/admin/contests", admin, {
    ...base,
    require_review: true,
    groups: [
      { name: "Alpha", invite_code: "alpha-secret" },
      { name: "Beta", invite_code: "beta-secret", review_mode: "auto" },
      { name: "Open" },
    ],
  });
  const path = `/admin/contests/${created.id}`;
  let contest = await ok(path);
  const alpha = contest.groups.find((g: any) => g.name === "Alpha");
  const beta = contest.groups.find((g: any) => g.name === "Beta");
  const defaultGroup = contest.groups.find((g: any) => g.is_default);
  assert.equal(alpha.invite_code, "alpha-secret");
  assert.equal(alpha.invite_code_set, true);
  assert.equal("invite_code_cipher" in alpha, false);
  const stored = await db.query(
    "SELECT invite_code_cipher FROM contest_groups WHERE id=$1",
    [alpha.id],
  );
  assert.match(stored[0]!.invite_code_cipher, /^v1\./);
  assert(!stored[0]!.invite_code_cipher.includes("alpha-secret"));
  for (const cookie of [undefined, a.cookie, admin.cookie]) {
    const res = await app.inject({
      url: `/api/contests/${created.id}`,
      headers: cookie ? { cookie } : {},
    });
    assert.equal(res.statusCode, 200);
    assert(!res.body.includes("alpha-secret"));
    assert(!res.body.includes("invite_code_cipher"));
    assert(!res.json().groups.some((g: any) => "invite_code" in g));
    assert.equal(
      res.json().groups.find((g: any) => g.id === alpha.id).invite_code_set,
      true,
    );
  }
  assert.equal((await request(path, a, contest, "PUT")).statusCode, 403);
  const register = (
    actor: typeof a,
    group: string,
    code?: string,
    cid = created.id,
  ) =>
    request(`/contests/${cid}/register`, actor, {
      team_id: actor.team,
      group_id: group,
      invite_code: code,
    });
  for (const code of [undefined, "wrong-code", "beta-secret"])
    assert.equal((await register(a, alpha.id, code)).statusCode, 403);
  assert.equal((await register(a, alpha.id, " alpha-secret ")).statusCode, 200);
  assert.equal(
    (await ok(`/contests/${created.id}`, a)).registration.status,
    "pending",
  );
  assert.equal((await register(b, beta.id, "alpha-secret")).statusCode, 403);
  assert.equal((await register(b, beta.id, "beta-secret")).statusCode, 200);
  assert.equal(
    (await ok(`/contests/${created.id}`, b)).registration.status,
    "accepted",
  );
  assert.equal((await register(c, defaultGroup.id)).statusCode, 200);
  // Omitted invitation fields preserve an existing code; blank explicitly clears it.
  await ok(
    path,
    admin,
    {
      ...contest,
      groups: contest.groups.map(({ invite_code, ...g }: any) => g),
    },
    "PUT",
  );
  assert.equal(
    (await ok(path)).groups.find((g: any) => g.id === alpha.id).invite_code,
    "alpha-secret",
  );
  contest = await ok(path);
  await ok(
    path,
    admin,
    {
      ...contest,
      groups: contest.groups.map((g: any) =>
        g.id === alpha.id ? { ...g, invite_code: "new-alpha-code" } : g,
      ),
    },
    "PUT",
  );
  const d = await player();
  assert.equal((await register(d, alpha.id, "alpha-secret")).statusCode, 403);
  assert.equal((await register(d, alpha.id, "new-alpha-code")).statusCode, 200);
  assert.equal(
    (await ok(`/contests/${created.id}`, a)).registration.status,
    "pending",
  );
  contest = await ok(path);
  for (const code of ["short", "x".repeat(129)])
    assert.equal(
      (
        await request(
          path,
          admin,
          { ...contest, groups: [{ ...alpha, invite_code: code }] },
          "PUT",
        )
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await request(
        path,
        admin,
        {
          ...contest,
          groups: [{ ...defaultGroup, invite_code: "not-allowed" }],
        },
        "PUT",
      )
    ).statusCode,
    400,
  );
  await ok(
    path,
    admin,
    {
      ...contest,
      groups: contest.groups.map((g: any) =>
        g.id === alpha.id ? { ...g, invite_code: "" } : g,
      ),
    },
    "PUT",
  );
  assert.equal((await register(await player(), alpha.id)).statusCode, 200);
  assert.equal(
    (await ok(path)).groups.find((g: any) => g.id === alpha.id).invite_code_set,
    false,
  );
  // A group code overrides the event code; empty/default groups still use the event code.
  const invited = await ok("/admin/contests", admin, {
    ...base,
    registration_mode: "invite",
    registration_code: "contest-secret",
    groups: [
      { name: "Restricted", invite_code: "group-secret" },
      { name: "Inherited" },
      {
        name: "Closed",
        invite_code: "closed-secret",
        permissions: { join: false },
      },
    ],
  });
  const inviteConfig = await ok(`/admin/contests/${invited.id}`);
  const restricted = inviteConfig.groups.find(
    (g: any) => g.name === "Restricted",
  );
  const inherited = inviteConfig.groups.find(
    (g: any) => g.name === "Inherited",
  );
  const closed = inviteConfig.groups.find((g: any) => g.name === "Closed");
  const e = await player(),
    f = await player(),
    h = await player();
  assert.equal(
    (await register(e, restricted.id, "contest-secret", invited.id)).statusCode,
    403,
  );
  assert.equal(
    (await register(e, restricted.id, "group-secret", invited.id)).statusCode,
    200,
  );
  assert.equal(
    (await register(f, inherited.id, "group-secret", invited.id)).statusCode,
    403,
  );
  assert.equal(
    (await register(f, inherited.id, "contest-secret", invited.id)).statusCode,
    200,
  );
  const invitedDefault = inviteConfig.groups.find((g: any) => g.is_default);
  assert.equal(
    (await register(h, invitedDefault.id, undefined, invited.id)).statusCode,
    403,
  );
  assert.equal(
    (await register(h, invitedDefault.id, "contest-secret", invited.id))
      .statusCode,
    200,
  );
  assert.equal(
    (await register(await player(), closed.id, "closed-secret", invited.id))
      .statusCode,
    403,
  );
  await ok(
    `/admin/contests/${invited.id}`,
    admin,
    {
      ...inviteConfig,
      groups: inviteConfig.groups.map((g: any) =>
        g.id === restricted.id ? { ...g, invite_code: "" } : g,
      ),
    },
    "PUT",
  );
  const j = await player();
  assert.equal(
    (await register(j, restricted.id, "group-secret", invited.id)).statusCode,
    403,
  );
  assert.equal(
    (await register(j, restricted.id, "contest-secret", invited.id)).statusCode,
    200,
  );
  const scoped = await ok("/admin/contests", admin, {
    ...base,
    registration_mode: "teams",
    registration_team_ids: [a.team],
    groups: [{ name: "Allowed", invite_code: "scoped-secret" }],
  });
  const scopedGroup = (await ok(`/admin/contests/${scoped.id}`)).groups.find(
    (g: any) => !g.is_default,
  );
  assert.equal(
    (await register(b, scopedGroup.id, "scoped-secret", scoped.id)).statusCode,
    403,
  );
  assert.equal(
    (await register(a, scopedGroup.id, "scoped-secret", scoped.id)).statusCode,
    200,
  );
});
