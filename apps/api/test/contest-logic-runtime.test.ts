import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB, type DB, type Row } from "../src/db.js";
import { config } from "../src/config.js";
import {
  DockerEngine,
  DockerError,
  type ContainerInfo,
  type NetworkInfo,
} from "../src/docker.js";
import { settleRound } from "../src/rounds.js";
import { AwdWorker } from "../src/awd-worker.js";
import { JudgeWorker } from "../src/judge-worker.js";
import { Worker } from "../src/worker.js";

class RuntimeDocker extends DockerEngine {
  flags: string[] = [];
  builds = 0;
  removed = 0;
  override async listContainers() {
    return [];
  }
  override async listNetworks() {
    return [];
  }
  override async inspectContainer(): Promise<ContainerInfo> {
    throw new DockerError(404);
  }
  override async inspectNetwork(): Promise<NetworkInfo> {
    throw new DockerError(404);
  }
  override async inspectImage() {
    this.builds++;
    throw Error("unexpected runtime allocation");
  }
  override async writeFlag(name: string) {
    this.flags.push(name);
  }
  override async removeContainer() {
    this.removed++;
  }
  override async removeImage() {}
}

const profile = {
  image: "nebuctf/test:local",
  port: 8080,
  cpu: 100,
  memory: 32,
  ttl: 600,
  mode: "private",
  access_mode: "port",
};
const scoring = {
  mode: "round",
  points: {
    initial_points: 100,
    minimum_points: 100,
    decay: 20,
    dynamic_score: false,
  },
  round: {
    interval: 60,
    carry: true,
    dynamic: false,
    flag_lifetime: 1,
    defense_points: 50,
    availability_points: 20,
  },
};

async function fixture(t: TestContext, type = "ctf") {
  const db = await openDB(true),
    prior = config.DATA_DIR;
  const dir = await mkdtemp(join(tmpdir(), "nebuctf-runtime-logic-"));
  config.DATA_DIR = dir;
  t.after(async () => {
    config.DATA_DIR = prior;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const user = crypto.randomUUID(),
    contest = crypto.randomUUID();
  const target = crypto.randomUUID(),
    prerequisite = crypto.randomUUID(),
    alternate = crypto.randomUUID();
  const teams = Array.from({ length: 5 }, () => crypto.randomUUID());
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'runtime','runtime@test.invalid','test')",
    [user],
  );
  await db.query(
    "INSERT INTO contests(id,title,published,starts_at,ends_at,round_duration) VALUES($1,'Runtime rules',true,now()-interval '5 minutes',now()+interval '1 hour',60)",
    [contest],
  );
  for (const team of teams) {
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1::uuid,$1::text,$2,$1::text)",
      [team, user],
    );
    await db.query(
      "INSERT INTO registrations(contest_id,team_id,created_at) VALUES($1,$2,now()-interval '1 hour')",
      [contest, team],
    );
  }
  for (const challenge of [target, prerequisite, alternate]) {
    await db.query(
      "INSERT INTO challenges(id,title,category,difficulty,kind,published,challenge_type,resources,awd_config) VALUES($1::uuid,$1::text,'Web','入门','dynamic_container',true,$2,$3,$4)",
      [
        challenge,
        challenge === target ? type : "ctf",
        JSON.stringify({ container: profile, attachment: null }),
        challenge === target && type === "awd"
          ? JSON.stringify({
              checker_image: "nebuctf/check:local",
              timeout: 10,
            })
          : null,
      ],
    );
    await db.query(
      "INSERT INTO contest_challenges(contest_id,challenge_id,scoring,logic) VALUES($1,$2,$3,$4)",
      [
        contest,
        challenge,
        JSON.stringify(scoring),
        JSON.stringify({
          exclusive_group: challenge === prerequisite ? null : "route",
          dependency:
            challenge === target
              ? { scope: "team", mode: "all", challenge_ids: [prerequisite] }
              : null,
        }),
      ],
    );
  }
  const parts = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [position, part] of parts.entries())
    await db.query(
      "INSERT INTO challenge_parts(id,challenge_id,title,position,role,flag_hash,initial_points,minimum_points) VALUES($1::uuid,$2,$1::text,$3,'flag','test',100,100)",
      [part, prerequisite, position],
    );
  for (const [index, team] of teams.entries()) {
    const practice = index === 2;
    await db.query(
      "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,$6)",
      [crypto.randomUUID(), prerequisite, contest, "t:" + team, user, practice],
    );
    for (const part of index === 1 ? parts.slice(0, 1) : parts)
      await db.query(
        "INSERT INTO part_solves(id,part_id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          part,
          prerequisite,
          contest,
          "t:" + team,
          user,
          practice,
        ],
      );
    if (index !== 4)
      await db.query(
        "INSERT INTO contest_exclusive_choices(contest_id,owner_key,group_name,challenge_id) VALUES($1,$2,'route',$3)",
        [contest, "t:" + team, index === 3 ? alternate : target],
      );
  }
  const [challenge] = await db.query("SELECT * FROM challenges WHERE id=$1", [
    target,
  ]);
  return {
    db,
    user,
    contest,
    target,
    prerequisite,
    alternate,
    teams,
    parts,
    challenge: challenge!,
  };
}

async function round(db: DB, contest: string, target: string, number = 1) {
  const [row] = await db.query(
    "INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,$4,now()-interval '2 minutes',now()-interval '1 minute',$5) RETURNING *",
    [crypto.randomUUID(), contest, target, number, JSON.stringify(scoring)],
  );
  return row!;
}

async function running(
  db: DB,
  contest: string,
  target: string,
  owner: string,
  user: string,
) {
  const [row] = await db.query(
    "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at) VALUES($1,$2,$3,$4,$5,'dynamic_container','running',$6,now()+interval '1 hour',now()+interval '1 hour') RETURNING *",
    [
      crypto.randomUUID(),
      target,
      contest,
      owner,
      user,
      JSON.stringify({ ...profile, awd: true }),
    ],
  );
  return row!;
}

test("round settlement excludes partial/practice prerequisites, excluded and unchosen routes", async (t) => {
  const f = await fixture(t);
  for (const team of f.teams)
    await f.db.query(
      "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '3 minutes')",
      [crypto.randomUUID(), f.target, f.contest, "t:" + team, f.user],
    );
  const tick = await round(f.db, f.contest, f.target);
  await f.db.transaction((tx) => settleRound(tx, tick, f.challenge));
  const results = await f.db.query(
    "SELECT owner_key,points FROM round_results WHERE round_id=$1",
    [tick.id],
  );
  assert.deepEqual(results, [{ owner_key: "t:" + f.teams[0], points: 100 }]);
});

test("global dependencies require a full non-practice prerequisite from a formal team", async (t) => {
  const f = await fixture(t);
  await f.db.query(
    "UPDATE contest_challenges SET logic=jsonb_set(logic,'{dependency,scope}','\"global\"') WHERE contest_id=$1 AND challenge_id=$2",
    [f.contest, f.target],
  );
  await f.db.query(
    "DELETE FROM part_solves WHERE challenge_id=$1 AND owner_key=ANY($2::text[])",
    [f.prerequisite, [0, 3, 4].map((i) => "t:" + f.teams[i])],
  );
  for (const team of f.teams)
    await f.db.query(
      "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '3 minutes')",
      [crypto.randomUUID(), f.target, f.contest, "t:" + team, f.user],
    );
  const locked = await round(f.db, f.contest, f.target);
  await f.db.transaction((tx) => settleRound(tx, locked, f.challenge));
  assert.equal(
    (
      await f.db.query("SELECT 1 FROM round_results WHERE round_id=$1", [
        locked.id,
      ])
    ).length,
    0,
  );
  await f.db.query(
    "INSERT INTO part_solves(id,part_id,challenge_id,scope,owner_key,user_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      crypto.randomUUID(),
      f.parts[1],
      f.prerequisite,
      f.contest,
      "t:" + f.teams[1],
      f.user,
    ],
  );
  const unlocked = await round(f.db, f.contest, f.target, 2);
  await f.db.transaction((tx) => settleRound(tx, unlocked, f.challenge));
  const results = await f.db.query(
    "SELECT owner_key FROM round_results WHERE round_id=$1 ORDER BY owner_key",
    [unlocked.id],
  );
  assert.deepEqual(
    results.map((r) => r.owner_key).sort(),
    f.teams
      .slice(0, 3)
      .map((team) => "t:" + team)
      .sort(),
  );
});

test("AWD settlement gates attackers and victims without creating permanent solves or stopping services", async (t) => {
  const f = await fixture(t, "awd"),
    tick = await round(f.db, f.contest, f.target);
  const instances: Row[] = [];
  for (const team of f.teams) {
    const owner = "t:" + team,
      instance = await running(f.db, f.contest, f.target, owner, f.user);
    instances.push(instance);
    await f.db.query(
      "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,now())",
      [instance.id, tick.id, instance.id, owner],
    );
    await f.db.query(
      "INSERT INTO awd_checks(id,round_id,instance_id,owner_key,status) VALUES($1,$2,$3,$4,'up')",
      [crypto.randomUUID(), tick.id, instance.id, owner],
    );
  }
  for (const [attacker, victim] of [
    [0, 4],
    [0, 3],
    [3, 0],
  ])
    await f.db.query(
      "INSERT INTO awd_attacks(id,flag_hash,attacker_key,user_id) VALUES($1,$2,$3,$4)",
      [
        crypto.randomUUID(),
        instances[victim!]!.id,
        "t:" + f.teams[attacker!],
        f.user,
      ],
    );
  await new AwdWorker(f.db).settle(
    { contest_id: f.contest, challenge_id: f.target },
    tick,
  );
  const results = await f.db.query(
    "SELECT owner_key,points FROM round_results WHERE round_id=$1",
    [tick.id],
  );
  assert.deepEqual(results, [{ owner_key: "t:" + f.teams[0], points: 170 }]);
  assert.equal(
    (await f.db.query("SELECT 1 FROM solves WHERE challenge_id=$1", [f.target]))
      .length,
    0,
  );
  assert.equal(
    (
      await f.db.query(
        "SELECT 1 FROM instances WHERE challenge_id=$1 AND status<>'running'",
        [f.target],
      )
    ).length,
    0,
  );
});

test("AWD allocates unchosen routes and rotates their attack flags without running automatic checks", async (t) => {
  const f = await fixture(t, "awd"),
    docker = new RuntimeDocker();
  const worker = new AwdWorker(f.db, docker);
  await worker.tick();
  const allocated = await f.db.query(
    "SELECT owner_key FROM instances WHERE challenge_id=$1 ORDER BY owner_key",
    [f.target],
  );
  assert.deepEqual(
    allocated.map((r) => r.owner_key).sort(),
    [f.teams[0], f.teams[4]].map((team) => "t:" + team).sort(),
  );
  await f.db.query(
    "UPDATE instances SET status='running' WHERE challenge_id=$1 AND owner_key=$2",
    [f.target, "t:" + f.teams[4]],
  );
  for (const index of [1, 3])
    await running(f.db, f.contest, f.target, "t:" + f.teams[index], f.user);
  await worker.tick();
  assert.equal(docker.flags.length, 1);
  assert.equal((await f.db.query("SELECT 1 FROM awd_checks")).length, 0);
  const flags = await f.db.query("SELECT owner_key FROM awd_flags");
  assert.deepEqual(flags, [{ owner_key: "t:" + f.teams[4] }]);
  assert.equal(
    (await f.db.query("SELECT 1 FROM instances WHERE status='running'")).length,
    3,
  );
  assert.equal(docker.removed, 0);
});

test("queued judge jobs and ordinary instances cannot execute locked or excluded routes", async (t) => {
  const f = await fixture(t),
    docker = new RuntimeDocker();
  for (const index of [1, 2, 3, 4]) {
    const owner = "t:" + f.teams[index],
      id = crypto.randomUUID();
    const spec = {
      container: profile,
      patch: { timeout: 10 },
      type: "awdp",
      contest_practice: false,
    };
    const [job] = await f.db.query(
      "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'queued',$1,'patch.tar.gz',$6,now()+interval '1 minute') RETURNING *",
      [id, f.target, f.contest, owner, f.user, JSON.stringify(spec)],
    );
    await new JudgeWorker(f.db, docker).run(job!);
    const [result] = await f.db.query(
      "SELECT status FROM judge_jobs WHERE id=$1",
      [id],
    );
    assert.equal(result!.status, "failed");
    if (index !== 4)
      await assert.rejects(
        new Worker(f.db, docker).start({
          id: crypto.randomUUID(),
          challenge_id: f.target,
          scope: f.contest,
          owner_key: owner,
          kind: "dynamic_container",
          spec: profile,
        }),
        /赛题尚未解锁或已选择其他互斥题目/,
      );
  }
  assert.equal(docker.builds, 0);
  assert.equal(docker.removed, 0);
  assert.equal(
    (await f.db.query("SELECT 1 FROM solves WHERE challenge_id=$1", [f.target]))
      .length,
    0,
  );
});
