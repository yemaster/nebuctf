import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB, type DB } from "../src/db.js";
import { runScheduler } from "../src/scheduler.js";

test(
  "scheduler expires non-execution state without deleting live state",
  { timeout: 60000 },
  async () => {
    const db = await openDB(true),
      controller = new AbortController(),
      user = crypto.randomUUID(),
      route = crypto.randomUUID(),
      expiredCaptcha = crypto.randomUUID(),
      liveCaptcha = crypto.randomUUID(),
      expiredEmail = crypto.randomUUID(),
      liveEmail = crypto.randomUUID(),
      expiredCall = crypto.randomUUID(),
      liveCall = crypto.randomUUID(),
      completedCall = crypto.randomUUID(),
      oldCall = crypto.randomUUID();
    const errors: unknown[] = [];
    try {
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,'scheduler-test','scheduler@example.test','test','user')",
        [user],
      );
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('expired',$1,now()-interval '1 second'),('live',$1,now()+interval '1 hour')",
        [user],
      );
      await db.query(
        "INSERT INTO rate_limits(key,hits,expires_at) VALUES('expired',1,now()-interval '1 second'),('live',1,now()+interval '1 hour')",
      );
      await db.query(
        "INSERT INTO captcha_uses(id,expires_at) VALUES($1,now()-interval '1 second'),($2,now()+interval '1 hour')",
        [expiredCaptcha, liveCaptcha],
      );
      await db.query(
        "INSERT INTO email_verifications(id,email,code_hash,expires_at) VALUES($1,'expired@example.test','test',now()-interval '1 second'),($2,'live@example.test','test',now()+interval '1 hour')",
        [expiredEmail, liveEmail],
      );
      await db.query(
        "INSERT INTO ai_routes(id,name,protocol,base_url,key_cipher,access_hash,access_prefix,models,rpm,daily_limit,concurrency,max_tokens,timeout_seconds) VALUES($1,'scheduler','openai','http://localhost','test','scheduler','test','[]',1,1,1,1,60)",
        [route],
      );
      await db.query(
        "INSERT INTO ai_calls(id,route_id,model,protocol,status,created_at,expires_at) VALUES($1,$5,'test','openai',0,now()-interval '1 minute',now()-interval '1 second'),($2,$5,'test','openai',0,now(),now()+interval '1 hour'),($3,$5,'test','openai',200,now()-interval '1 minute',now()-interval '1 second'),($4,$5,'test','openai',200,now()-interval '91 days',now()-interval '90 days')",
        [expiredCall, liveCall, completedCall, oldCall, route],
      );
      let electedChecks = 0,
        heartbeats = 0;
      await runScheduler(db, controller.signal, (error) => errors.push(error), {
        checkLeadership: async () => {
          electedChecks++;
        },
        heartbeat: async () => {
          heartbeats++;
          controller.abort();
        },
      });
      assert.deepEqual(errors, []);
      assert.equal(electedChecks, 1);
      assert.equal(heartbeats, 1);
      assert.deepEqual(await db.query("SELECT token_hash FROM sessions"), [
        { token_hash: "live" },
      ]);
      assert.deepEqual(await db.query("SELECT key FROM rate_limits"), [
        { key: "live" },
      ]);
      assert.deepEqual(await db.query("SELECT id FROM captcha_uses"), [
        { id: liveCaptcha },
      ]);
      assert.deepEqual(await db.query("SELECT id FROM email_verifications"), [
        { id: liveEmail },
      ]);
      const calls = await db.query("SELECT id,status,elapsed_ms FROM ai_calls");
      assert.equal(calls.length, 3);
      assert.equal(calls.find((call) => call.id === expiredCall)?.status, 504);
      assert(calls.find((call) => call.id === expiredCall)!.elapsed_ms > 0);
      assert.equal(calls.find((call) => call.id === liveCall)?.status, 0);
      assert.equal(
        calls.find((call) => call.id === completedCall)?.status,
        200,
      );
      assert(!calls.some((call) => call.id === oldCall));
    } finally {
      controller.abort();
      await db.close();
    }
  },
);

test("scheduler does not admit jobs after a failed leadership check", async () => {
  let queries = 0;
  const db: DB = {
    query: async () => {
      queries++;
      return [];
    },
    transaction: async () => {
      throw Error("unexpected transaction");
    },
    close: async () => {},
  };
  const errors: unknown[] = [];
  await assert.rejects(
    runScheduler(
      db,
      new AbortController().signal,
      (error) => errors.push(error),
      {
        checkLeadership: async () => {
          throw Error("leader disconnected");
        },
      },
    ),
    /leader disconnected/,
  );
  assert.equal(queries, 0);
  assert.deepEqual(errors, []);
});

test("scheduler shutdown drains its active job without starting another", async () => {
  const controller = new AbortController(),
    blocked = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  let active = 0,
    maxActive = 0,
    transactions = 0,
    settled = false,
    heartbeats = 0;
  const errors: unknown[] = [];
  const db: DB = {
    query: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      entered.resolve();
      await blocked.promise;
      active--;
      return [];
    },
    transaction: async () => {
      transactions++;
      throw Error("unexpected transaction");
    },
    close: async () => {},
  };
  const running = runScheduler(
    db,
    controller.signal,
    (error) => errors.push(error),
    {
      heartbeat: async () => {
        heartbeats++;
      },
    },
  ).then(() => {
    settled = true;
  });
  await entered.promise;
  controller.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  blocked.resolve();
  await running;
  assert.equal(active, 0);
  assert.equal(maxActive, 1);
  assert.equal(transactions, 0);
  assert.equal(heartbeats, 0);
  assert.deepEqual(errors, []);
});
