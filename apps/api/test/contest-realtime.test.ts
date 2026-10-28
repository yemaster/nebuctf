import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest, flagHash } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import { recordContestReleases } from "../src/contest-activity.js";
import { recordContestNotice } from "../src/activity-events.js";
import { creditSolve } from "../src/solve.js";

test(
  "websocket origin/session/registration guards, events, reconnect snapshots and freeze",
  { timeout: 30000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    await app.ready();
    const sockets: WebSocket[] = [];
    t.after(async () => {
      for (const s of sockets) s.terminate();
      await app.close();
      await db.close();
    });
    const user = crypto.randomUUID(),
      team = crypto.randomUUID(),
      contest = crypto.randomUUID(),
      cid = crypto.randomUUID(),
      token = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
      [user, "stream" + user.slice(0, 8), user + "@example.test"],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), user],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Streaming Team',$2,$3)",
      [team, user, team],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      user,
      team,
    ]);
    await db.query(
      "INSERT INTO contests(id,title,published,starts_at,ends_at) VALUES($1,'Realtime',true,now()-interval '1 hour',now()+interval '1 hour')",
      [contest],
    );
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,hints) VALUES($1,'Stream question','Web','入门','static_attachment',$2,true,'[\"new clue\"]')",
      [cid, flagHash("flag{sample}")],
    );
    await db.query(
      "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
      [contest, cid],
    );
    const path = `/api/contests/${contest}/activity/ws`,
      headers = {
        cookie: `${sessionCookie}=${token}`,
        origin: config.APP_ORIGIN,
      };
    await assert.rejects(
      app.injectWS(path, {
        headers: { ...headers, origin: "https://elsewhere.invalid" },
      }),
      /403/,
    );
    await assert.rejects(
      app.injectWS(path, { headers: { origin: config.APP_ORIGIN } }),
      /401/,
    );
    await assert.rejects(app.injectWS(path, { headers }), /403/);
    await db.query(
      "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
      [contest, team],
    );
    const messages: any[] = [];
    const connect = async () => {
      const socket = await app.injectWS(
        path,
        { headers },
        {
          onInit: (ws) =>
            ws.on("message", (data) =>
              messages.push(JSON.parse(data.toString())),
            ),
        },
      );
      sockets.push(socket);
      return socket;
    };
    const wait = async (predicate: () => boolean) => {
      const end = Date.now() + 7000;
      while (!predicate() && Date.now() < end)
        await new Promise((r) => setTimeout(r, 20));
      assert(predicate(), "websocket event arrived");
    };
    const ws = await connect();
    await wait(() => messages.some((m) => m.type === "activity"));
    // A session can have several tabs; deduplicating authorization must not drop a recipient.
    const tabMessages: any[] = [];
    const tab = await app.injectWS(
      path,
      { headers },
      {
        onInit: (socket) =>
          socket.on("message", (data) =>
            tabMessages.push(JSON.parse(data.toString())),
          ),
      },
    );
    sockets.push(tab);
    await wait(() => tabMessages.some((m) => m.type === "activity"));
    await db.transaction((tx) => recordContestReleases(tx, contest, [cid]));
    await wait(() =>
      messages.at(-1)?.data?.items.some((e: any) => e.type === "release"),
    );
    await wait(() =>
      tabMessages.at(-1)?.data?.items.some((e: any) => e.type === "release"),
    );
    await db.transaction((tx) => recordContestNotice(tx, contest, cid, "hint"));
    await wait(() => messages.at(-1)?.data?.hint_updates?.length === 1);
    const [challenge] = await db.query("SELECT * FROM challenges WHERE id=$1", [
      cid,
    ]);
    await db.transaction((tx) =>
      creditSolve(tx, challenge!, contest, "t:" + team, user),
    );
    await wait(() =>
      messages
        .at(-1)
        ?.data?.items.some(
          (e: any) => e.type === "solve" && e.blood_rank === 1,
        ),
    );
    await db.query(
      "UPDATE contests SET freeze_at=now()-interval '30 minutes' WHERE id=$1",
      [contest],
    );
    await wait(() => messages.at(-1)?.data?.frozen === true);
    assert(!messages.at(-1).data.items.some((e: any) => e.type === "solve"));
    assert(messages.at(-1).data.items.some((e: any) => e.type === "hint"));
    await db.query(
      "UPDATE contest_challenges SET published=false WHERE contest_id=$1 AND challenge_id=$2",
      [contest, cid],
    );
    await db.transaction((tx) =>
      recordContestNotice(tx, contest, cid, "withdraw"),
    );
    await wait(() =>
      messages.at(-1)?.data?.items.some((e: any) => e.type === "withdraw"),
    );
    assert.equal(messages.at(-1).data.hint_updates.length, 0);
    await t.test(
      "patch revisions reach only their owning team and contain no private result",
      async () => {
        const otherUser = crypto.randomUUID(),
          otherTeam = crypto.randomUUID(),
          otherToken = crypto.randomUUID(),
          jid = crypto.randomUUID();
        await db.query(
          "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
          [
            otherUser,
            "peer" + otherUser.slice(0, 8),
            otherUser + "@test.invalid",
          ],
        );
        await db.query(
          "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
          [digest(otherToken), otherUser],
        );
        await db.query(
          "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
          [otherTeam, otherTeam, otherUser, otherTeam],
        );
        await db.query(
          "INSERT INTO memberships(user_id,team_id) VALUES($1,$2)",
          [otherUser, otherTeam],
        );
        await db.query(
          "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
          [contest, otherTeam],
        );
        const otherMessages: any[] = [];
        const peer = await app.injectWS(
          path,
          { headers: { ...headers, cookie: `${sessionCookie}=${otherToken}` } },
          {
            onInit: (socket) =>
              socket.on("message", (data) =>
                otherMessages.push(JSON.parse(data.toString())),
              ),
          },
        );
        sockets.push(peer);
        await wait(() => otherMessages.some((m) => m.type === "activity"));
        await db.query(
          "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'queued',$1,'private-file.tar','{}',now()+interval '2 minutes')",
          [jid, cid, contest, "t:" + team, user],
        );
        await wait(() => messages.some((m) => m.type === "judges"));
        await wait(() => tabMessages.some((m) => m.type === "judges"));
        const first = messages.findLast((m) => m.type === "judges");
        assert.deepEqual(
          tabMessages.findLast((m) => m.type === "judges"),
          first,
        );
        assert.deepEqual(Object.keys(first).sort(), ["revision", "type"]);
        assert.equal(
          otherMessages.filter((m) => m.type === "judges").length,
          0,
        );
        await db.query(
          "UPDATE judge_jobs SET status='failed',result='{\"verdict\":\"exploit_success\"}',updated_at=clock_timestamp() WHERE id=$1",
          [jid],
        );
        await wait(
          () => messages.filter((m) => m.type === "judges").length >= 2,
        );
        assert.notEqual(
          messages.findLast((m) => m.type === "judges").revision,
          first.revision,
        );
        assert.equal(
          otherMessages.filter((m) => m.type === "judges").length,
          0,
        );
        peer.terminate();
      },
    );
    ws.terminate();
    messages.length = 0;
    const next = await connect();
    await wait(() =>
      messages.at(-1)?.data?.items.some((e: any) => e.type === "withdraw"),
    );
    const closed = new Promise<number>((resolve) =>
      next.once("close", (code) => resolve(code)),
    );
    const tabClosed = new Promise<number>((resolve) =>
      tab.once("close", resolve),
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1", [user]);
    assert.equal(await closed, 1008);
    assert.equal(await tabClosed, 1008);
  },
);
