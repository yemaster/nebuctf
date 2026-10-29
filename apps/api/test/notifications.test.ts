import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import {
  deliverNotification,
  publishNotificationReminders,
} from "../src/notifications.js";

test(
  "private inbox delivery, review events, reminders and realtime",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(true),
      app = await buildApp(db),
      sockets: WebSocket[] = [];
    await app.ready();
    t.after(async () => {
      sockets.forEach((s) => s.terminate());
      await app.close();
      await db.close();
    });
    async function player(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        username = "notice_" + id.slice(0, 8),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, username, id + "@test.invalid", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, "Team " + username, id, crypto.randomUUID()],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return {
        id,
        team,
        username,
        email: id + "@test.invalid",
        token,
        headers: {
          cookie: `${sessionCookie}=${token}`,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
      };
    }
    const admin = await player("admin"),
      a = await player(),
      b = await player(),
      outsider = await player();
    const request = (
      path: string,
      actor = a,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: method as "GET" | "PUT" | "POST" | "DELETE",
        headers: actor.headers,
        payload: body as any,
      });
    async function ok(
      path: string,
      actor = a,
      body?: unknown,
      method?: string,
    ) {
      const response = await request(path, actor, body, method);
      assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
      return response.json();
    }
    const compose = (extra: Record<string, unknown> = {}) => ({
      title: "系统维护",
      body: "维护内容",
      audience: "users",
      recipients: [a.username],
      request_id: crypto.randomUUID(),
      ...extra,
    });
    let first = "",
      contest = "";
    await t.test(
      "targeted delivery is idempotent, private and authenticated",
      async () => {
        const input = compose({ recipients: [a.username, a.email] });
        const [one, two] = await Promise.all([
          ok("/admin/notifications", admin, input),
          ok("/admin/notifications", admin, input),
        ]);
        assert.equal(one.id, two.id);
        first = one.id;
        assert.equal((await ok("/notifications")).total, 1);
        assert.equal((await ok("/notifications/summary")).unread, 1);
        assert.equal(
          (await ok(`/notifications/${first}`)).read_at,
          null,
          "reading a GET does not mutate state",
        );
        assert.equal(
          (await request(`/notifications/${first}`, b)).statusCode,
          404,
        );
        assert.equal(
          (await request(`/notifications/${first}`, b, { read: true }, "PUT"))
            .statusCode,
          404,
        );
        assert.equal(
          (await request("/admin/notifications", a, compose())).statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ url: "/api/notifications" })).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: `/api/notifications/${first}`,
              method: "PUT",
              headers: { cookie: a.headers.cookie },
              payload: { read: true },
            })
          ).statusCode,
          403,
        );
        for (const href of [
          "https://example.com",
          "//example.com",
          "/\\example.com",
          "javascript:alert(1)",
        ])
          assert.equal(
            (await request("/admin/notifications", admin, compose({ href })))
              .statusCode,
            400,
          );
        assert.equal(
          (
            await request(
              "/admin/notifications",
              admin,
              compose({ recipients: ["missing-user"] }),
            )
          ).statusCode,
          400,
        );
        assert.equal((await ok("/notifications")).total, 1);
      },
    );
    await t.test(
      "read, unread, archive, restore and withdrawal preserve recipient isolation",
      async () => {
        await ok(`/notifications/${first}`, a, { read: true }, "PUT");
        assert.equal((await ok("/notifications/summary")).unread, 0);
        await ok(`/notifications/${first}`, a, { read: false }, "PUT");
        await ok(`/notifications/${first}`, a, { archived: true }, "PUT");
        assert.equal((await ok("/notifications/summary")).unread, 0);
        assert.equal((await ok("/notifications")).total, 0);
        assert.equal((await ok("/notifications?state=archived")).total, 1);
        await ok(`/notifications/${first}`, a, { archived: false }, "PUT");
        assert.equal((await ok("/notifications/summary")).unread, 1);
        await ok(`/admin/notifications/${first}`, admin, undefined, "DELETE");
        assert.equal(
          (await request(`/notifications/${first}`)).statusCode,
          404,
        );
        assert.equal((await ok("/notifications/summary")).unread, 0);
        assert.ok(
          (await ok("/admin/notifications", admin)).items[0].withdrawn_at,
        );
      },
    );
    await t.test(
      "pagination, filters and mark-all use a bounded inbox snapshot",
      async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < 25; i++)
            await deliverNotification(
              tx,
              {
                kind: i % 2 ? "reminder" : "system",
                title: `记录 ${i}`,
                body: "内容",
              },
              { kind: "users", ids: [a.id] },
            );
        });
        const pages = await Promise.all(
          [1, 2, 3].map((p) => ok(`/notifications?page=${p}`)),
        );
        assert.deepEqual(
          pages.map((p) => p.items.length),
          [10, 10, 5],
        );
        assert.equal(
          new Set(pages.flatMap((p) => p.items.map((m: any) => m.id))).size,
          25,
        );
        assert.equal((await ok("/notifications?kind=reminder")).total, 12);
        assert.equal((await ok("/notifications?q=记录%2024")).total, 1);
        const late = await db.transaction((tx) =>
          deliverNotification(
            tx,
            { kind: "system", title: "刚刚收到", body: "新内容" },
            { kind: "users", ids: [a.id] },
          ),
        );
        await db.query(
          "UPDATE notification_recipients SET created_at=$2::timestamptz+interval '1 second' WHERE notification_id=$1",
          [late.id, pages[0].as_of],
        );
        await ok(
          "/notifications/read-all",
          a,
          { before: pages[0].as_of },
          "PUT",
        );
        assert.equal((await ok("/notifications/summary")).unread, 1);
        assert.equal(
          (await ok("/notifications?state=unread")).items[0].id,
          late.id,
        );
        assert.equal((await ok("/notifications", outsider)).total, 0);
      },
    );
    await t.test(
      "registration decisions reach the team, not other players, and identical saves do not repeat",
      async () => {
        await db.query(
          "INSERT INTO memberships(user_id,team_id) VALUES($1,$2)",
          [b.id, a.team],
        );
        const c = await ok("/admin/contests", admin, {
          title: "通知测试赛",
          starts_at: new Date(Date.now() + 600000).toISOString(),
          ends_at: new Date(Date.now() + 7200000).toISOString(),
          published: true,
          team_limit: 4,
          require_review: true,
          challenge_ids: [],
        });
        contest = c.id;
        await ok(`/contests/${contest}/register`, a, { team_id: a.team });
        assert.equal(
          (await ok("/notifications?kind=contest", b)).items[0].title,
          "报名已提交",
        );
        assert.equal(
          (await ok("/notifications?kind=contest", admin)).items[0].title,
          "新的报名申请",
        );
        const review = {
          team_ids: [a.team],
          status: "rejected",
          review_note: "请补充资料",
        };
        await ok(
          `/admin/contests/${contest}/registrations`,
          admin,
          review,
          "PUT",
        );
        const rejected = (await ok("/notifications?kind=contest", b)).items[0];
        assert.equal(rejected.title, "报名审核未通过");
        assert.match(
          (await ok(`/notifications/${rejected.id}`, b)).body,
          /请补充资料/,
        );
        const total = (await ok("/notifications", b)).total;
        await ok(
          `/admin/contests/${contest}/registrations`,
          admin,
          review,
          "PUT",
        );
        assert.equal((await ok("/notifications", b)).total, total);
        await ok(
          `/admin/contests/${contest}/registrations`,
          admin,
          { team_ids: [a.team], status: "accepted" },
          "PUT",
        );
        assert.equal(
          (await ok("/notifications?kind=contest", b)).items[0].title,
          "报名审核通过",
        );
        assert.equal((await ok("/notifications", outsider)).total, 0);
      },
    );
    await t.test(
      "WriteUp changes and acceptance include the review reason once",
      async () => {
        // Joining the current team must not grant access to its earlier contest roster.
        await db.query(
          "INSERT INTO memberships(user_id,team_id) VALUES($1,$2)",
          [outsider.id, a.team],
        );
        await db.query(
          "INSERT INTO contest_writeups(contest_id,team_id,file_id,name,size,format,submitted_by) VALUES($1,$2,$3,'answer.pdf',100,'pdf',$4)",
          [contest, a.team, crypto.randomUUID(), a.id],
        );
        const input = {
          version: 1,
          status: "changes_requested",
          note: "请补充利用过程",
        };
        await ok(
          `/admin/contests/${contest}/writeups/${a.team}`,
          admin,
          input,
          "PUT",
        );
        const item = (await ok("/notifications?kind=contest", b)).items[0];
        assert.equal(item.title, "WriteUp 需要修改");
        assert.match(
          (await ok(`/notifications/${item.id}`, b)).body,
          /请补充利用过程/,
        );
        const total = (await ok("/notifications", b)).total;
        await ok(
          `/admin/contests/${contest}/writeups/${a.team}`,
          admin,
          input,
          "PUT",
        );
        assert.equal((await ok("/notifications", b)).total, total);
        assert.equal(
          (
            await request(
              `/admin/contests/${contest}/writeups/${a.team}`,
              admin,
              { ...input, version: 2 },
              "PUT",
            )
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "scheduled reminders are durable, deduplicated and only sent to eligible participants",
      async () => {
        await publishNotificationReminders(db);
        await publishNotificationReminders(db);
        const start = await ok("/notifications?kind=reminder", b);
        assert.equal(start.total, 1);
        assert.equal(start.items[0].title, "比赛即将开始");
        await ok(
          `/notifications/${start.items[0].id}`,
          b,
          { read: true },
          "PUT",
        );
        await publishNotificationReminders(db);
        assert.ok((await ok(`/notifications/${start.items[0].id}`, b)).read_at);
        const deadline = new Date(Date.now() + 1800000).toISOString();
        await db.query(
          "UPDATE contests SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',writeup=$2 WHERE id=$1",
          [contest, JSON.stringify({ enabled: true, deadline })],
        );
        await publishNotificationReminders(db);
        const reminders = await ok("/notifications?kind=reminder", b);
        assert.equal(reminders.total, 2);
        assert.equal(reminders.items[0].title, "WriteUp 即将截止");
        await db.query(
          "UPDATE contest_writeups SET status='accepted' WHERE contest_id=$1",
          [contest],
        );
        await publishNotificationReminders(db);
        assert.equal((await ok("/notifications?kind=reminder", b)).total, 2);
        assert.equal(
          (await ok("/notifications?kind=reminder", outsider)).total,
          0,
        );
      },
    );
    await t.test(
      "disabled users are excluded and contest broadcasts use accepted rosters",
      async () => {
        await db.query("UPDATE users SET disabled=true WHERE id=$1", [
          outsider.id,
        ]);
        const message = await ok(
          "/admin/notifications",
          admin,
          compose({ audience: "all", recipients: [] }),
        );
        assert.equal(message.recipients, 3);
        const targeted = await ok(
          "/admin/notifications",
          admin,
          compose({ audience: "contest", contest_id: contest, recipients: [] }),
        );
        assert.equal(targeted.recipients, 2);
        assert.equal(
          (await request(`/notifications/${targeted.id}`, admin)).statusCode,
          404,
        );
      },
    );
    await t.test(
      "websocket publishes only own counters, synchronizes tabs and revokes sessions",
      async () => {
        const updates: any[][] = [[], []];
        for (let i = 0; i < 2; i++)
          sockets.push(
            await app.injectWS(
              "/api/notifications/live",
              { headers: a.headers },
              {
                onInit: (s) =>
                  s.on("message", (m) =>
                    updates[i]!.push(JSON.parse(m.toString())),
                  ),
              },
            ),
          );
        async function until(check: () => boolean) {
          const end = Date.now() + 4500;
          while (!check() && Date.now() < end)
            await new Promise((r) => setTimeout(r, 30));
          assert.ok(check());
        }
        await until(() => updates.every((list) => list.length > 0));
        const initial = updates[0]!.at(-1).unread;
        await ok("/admin/notifications", admin, compose());
        await until(() =>
          updates.every((list) => list.at(-1)?.unread === initial + 1),
        );
        assert.deepEqual(Object.keys(updates[0]!.at(-1)).sort(), [
          "revision",
          "type",
          "unread",
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [a.id]);
        await until(() => sockets.every((s) => s.readyState >= 2));
        assert.equal(
          (await request("/notifications/summary", a)).statusCode,
          401,
        );
      },
    );
  },
);
