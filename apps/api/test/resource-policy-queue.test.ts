import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { defaults, saveSetting } from "../src/settings.js";
import { allocationPlan } from "../src/container-policy.js";
import {
  withQueuePositions,
  queuePriority,
  queueReady,
} from "../src/resource-queue.js";
import { creditSolve } from "../src/solve.js";

test("container limits, queue priority and complete-solve cleanup share current owner progress", async (t) => {
  const db = await openDB(true);
  t.after(() => db.close());
  const uid = crypto.randomUUID(),
    owner = "u:" + uid;
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'queue-user','queue@test.invalid','test')",
    [uid],
  );
  const cs = [];
  for (let n = 0; n < 3; n++) {
    const id = crypto.randomUUID();
    cs.push(id);
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice) VALUES($1,$2,'Web','入门','dynamic_container','',true,true)",
      [id, "Queue " + n],
    );
  }
  const ids = [];
  for (let n = 0; n < 3; n++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(
      "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,created_at,expires_at,max_expires_at) VALUES($1,$2,'practice',$3,$4,'dynamic_container','queued',$5,now()+$6*interval '1 second',now()+interval '5 minutes',now()+interval '1 hour')",
      [id, cs[n], owner, uid, JSON.stringify({ cpu: 100, memory: 32 }), n],
    );
  }
  await db.query(
    "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id) VALUES($1,$2,'practice',$3,$4)",
    [crypto.randomUUID(), cs[0], owner, uid],
  );
  const items = await db.query(
    "SELECT id,status FROM instances ORDER BY created_at",
  );
  const positions = await withQueuePositions(db, items);
  assert.deepEqual(
    positions.map((i) => i.queue_ahead),
    [2, 0, 1],
  );
  const scheduled = await db.query(
    `SELECT i.id FROM instances i WHERE i.status='queued' AND ${queueReady("i")} ORDER BY ${queuePriority("i")},i.created_at,i.id`,
  );
  assert.deepEqual(
    scheduled.map((i) => i.id),
    [ids[1], ids[2], ids[0]],
  );
  assert.deepEqual(Object.keys(positions[0]!).sort(), [
    "id",
    "queue_ahead",
    "queue_blocked",
    "status",
  ]);
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 10,
    max_owner_instances: 3,
  });
  const candidate = {
    id: crypto.randomUUID(),
    cpu: 100,
    memory: 32,
    resource_type: "container",
  };
  await assert.rejects(
    () => allocationPlan(db, "practice", owner, candidate),
    /数量上限/,
  );
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: 3,
    max_owner_instances: null,
  });
  await assert.rejects(
    () => allocationPlan(db, "practice", owner, candidate),
    /资源池已满/,
  );
  await saveSetting(db, "containers", {
    ...defaults.containers,
    max_instances: null,
    max_owner_instances: null,
    destroy_on_solve: true,
  });
  assert.equal(
    (await allocationPlan(db, "practice", owner, candidate)).replacements
      .length,
    0,
  );
  const parts = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [position, id] of parts.entries())
    await db.query(
      "INSERT INTO challenge_parts(id,challenge_id,title,position,flag_hash,initial_points,minimum_points) VALUES($1,$2,'Part',$3,'test',100,10)",
      [id, cs[1], position],
    );
  const challenge = { id: cs[1], challenge_type: "ctf" };
  await creditSolve(db, challenge, "practice", owner, uid, { id: parts[0] });
  assert.equal(
    (await db.query("SELECT status FROM instances WHERE id=$1", [ids[1]]))[0]!
      .status,
    "queued",
  );
  await creditSolve(db, challenge, "practice", owner, uid, { id: parts[1] });
  assert.equal(
    (await db.query("SELECT status FROM instances WHERE id=$1", [ids[1]]))[0]!
      .status,
    "stopping",
  );
  assert.equal(
    (await db.query("SELECT status FROM instances WHERE id=$1", [ids[2]]))[0]!
      .status,
    "queued",
  );
  await db.query("UPDATE instances SET status='running' WHERE id=$1", [ids[1]]);
  await creditSolve(db, challenge, "practice", owner, uid, { id: parts[1] });
  assert.equal(
    (await db.query("SELECT status FROM instances WHERE id=$1", [ids[1]]))[0]!
      .status,
    "running",
    "reopened completed challenge is not destroyed by a duplicate answer",
  );
});
