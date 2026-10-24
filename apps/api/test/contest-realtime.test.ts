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
    await db.transaction((tx) => recordContestReleases(tx, contest, [cid]));
    await wait(() =>
      messages.at(-1)?.data?.items.some((e: any) => e.type === "release"),
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
    ws.terminate();
    messages.length = 0;
    const next = await connect();
    await wait(() =>
      messages.at(-1)?.data?.items.some((e: any) => e.type === "withdraw"),
    );
    const closed = new Promise<number>((resolve) =>
      next.once("close", (code) => resolve(code)),
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1", [user]);
    assert.equal(await closed, 1008);
  },
);
