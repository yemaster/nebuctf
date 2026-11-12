import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { DockerEngine } from "../src/docker.js";
import { Worker } from "../src/worker.js";
import { JudgeWorker } from "../src/judge-worker.js";
import { AwdWorker } from "../src/awd-worker.js";
import { makeTar } from "../src/patch-archive.js";
import { patchStorage } from "../src/judge.js";
import { dynamicFlag, flagHash } from "../src/security.js";
import { contestScoringInput } from "../src/competition-rules.js";
import { flagEnvironmentSpec } from "../src/flag-environment.js";
import { saveContestGroups } from "../src/contest-groups.js";

test(
  "real Docker builds safe patch images, verifies defense, rotates AWD flags and applies patches",
  { skip: process.env.TEST_DOCKER !== "1", timeout: 120000 },
  async (t) => {
    const db = await openDB(true),
      docker = new DockerEngine(),
      worker = new Worker(db, docker),
      judge = new JudgeWorker(db, docker),
      awd = new AwdWorker(db, docker);
    const previous = config.DATA_DIR,
      dir = await mkdtemp(join(tmpdir(), "nebuctf-ad-"));
    config.DATA_DIR = dir;
    const uid = crypto.randomUUID(),
      team = crypto.randomUUID(),
      contest = crypto.randomUUID(),
      cid = crypto.randomUUID(),
      aid = crypto.randomUUID(),
      attack = crypto.randomUUID(),
      defense = crypto.randomUUID();
    const jobs: string[] = [];
    t.after(async () => {
      await judge.drain();
      await awd.drain();
      await worker.drain();
      for (const i of await db.query("SELECT * FROM instances"))
        await worker.cleanup(i).catch(() => {});
      for (const id of jobs)
        await docker.removeImage(`nebuctf-patch:${id}`).catch(() => {});
      await db.close();
      await rm(dir, { recursive: true, force: true });
      config.DATA_DIR = previous;
    });
    await docker.ping();
    await docker.inspectImage("nebuctf/example-ad:local");
    await docker.inspectImage("nebuctf/example-checker:local");
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
      [uid, "dock" + uid.slice(0, 8), uid + "@example.test"],
    );
    await db.query(
      "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,'Docker test',$2,$3)",
      [team, uid, team],
    );
    await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
      uid,
      team,
    ]);
    await db.query(
      "INSERT INTO contests(id,title,published,starts_at,ends_at,round_duration) VALUES($1,'Docker rules',true,now()-interval '5 seconds',now()+interval '1 hour',60)",
      [contest],
    );
    await db.query(
      "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
      [contest, team],
    );
    const profile = {
        image: "nebuctf/example-ad:local",
        cpu: 250,
        memory: 64,
        ttl: 600,
        mode: "private",
        port: 8080,
        access_mode: "port",
      },
      patch = {
        checker_image: "nebuctf/example-checker:local",
        patch_root: "/app",
        update_timeout: 2,
        timeout: 15,
        cpu: 250,
        memory: 128,
      };
    for (const [id, type] of [
      [cid, "awdp"],
      [aid, "awd"],
    ])
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,challenge_type,flag_mode,resources,patch_config,awd_config) VALUES($1,$2,'Web','入门','dynamic_container','',true,$3,'dynamic',$4,$5,$6)",
        [
          id,
          type,
          type,
          JSON.stringify({ container: profile, attachment: null }),
          JSON.stringify(patch),
          type === "awd"
            ? JSON.stringify({
                checker_image: patch.checker_image,
                timeout: 10,
              })
            : null,
        ],
      );
    await db.query(
      "UPDATE challenges SET flag_template='AD{[GUID]_[TEAM_HASH]}' WHERE id=ANY($1::uuid[])",
      [[cid, aid]],
    );
    await db.query(
      "INSERT INTO challenge_parts(id,challenge_id,title,position,role,flag_hash,initial_points,minimum_points) VALUES($1,$3,'Attack',0,'attack','',100,10),($2,$3,'Defense',1,'defense','',100,10)",
      [attack, defense, cid],
    );
    await db.query(
      "INSERT INTO contest_challenges(contest_id,challenge_id,scoring) VALUES($1,$2,$3),($1,$4,$5)",
      [
        contest,
        cid,
        JSON.stringify({ mode: "inherit", parts: [] }),
        aid,
        JSON.stringify(
          contestScoringInput.parse({
            mode: "round",
            points: { initial_points: 100, minimum_points: 10, decay: 10 },
            round: {},
          }),
        ),
      ],
    );
    await db.query(
      "UPDATE challenge_parts SET flag_template='Attack{[TEAM_HASH]}' WHERE id=$1",
      [attack],
    );
    async function patchJob(
      challenge: string,
      type: string,
      contents: string,
      script = '#!/bin/sh\nset -eu\ncp "$PATCH_DIR/files/repaired.py" ./settings.py\n',
    ) {
      const id = crypto.randomUUID();
      jobs.push(id);
      await mkdir(patchStorage(), { recursive: true });
      await writeFile(
        join(patchStorage(), id),
        gzipSync(
          makeTar([
            {
              name: "update.sh",
              data: Buffer.from(script),
              executable: false,
            },
            {
              name: "files/repaired.py",
              data: Buffer.from(contents),
              executable: false,
            },
          ]),
        ),
      );
      await db.query(
        "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'queued',$1,'defense.tar.gz',$6,now()+interval '2 minutes')",
        [
          id,
          challenge,
          contest,
          "t:" + team,
          uid,
          JSON.stringify({
            container: profile,
            patch,
            type,
            flag_environment: await flagEnvironmentSpec(
              db,
              (
                await db.query("SELECT * FROM challenges WHERE id=$1", [
                  challenge,
                ])
              )[0]!,
            ),
            contest_scoring: { mode: "inherit", parts: [] },
          }),
        ],
      );
      const [job] = await db.query("SELECT * FROM judge_jobs WHERE id=$1", [
        id,
      ]);
      await judge.run(job!);
      return (await db.query("SELECT * FROM judge_jobs WHERE id=$1", [id]))[0]!;
    }
    const rejectedUpdate = await patchJob(
      cid,
      "awdp",
      "VULNERABLE = False\n",
      "exit 7\n",
    );
    assert.equal(rejectedUpdate.result.verdict, "update_error");
    assert.equal(rejectedUpdate.result.update_exit_code, 7);
    assert.equal(rejectedUpdate.result.functional, undefined);
    const timedOutUpdate = await patchJob(
      cid,
      "awdp",
      "VULNERABLE = False\n",
      "sleep 10\n",
    );
    assert.equal(timedOutUpdate.result.verdict, "update_error");
    assert.match(timedOutUpdate.error, /更新脚本执行超时/);
    assert.equal(
      (await db.query("SELECT 1 FROM part_solves WHERE part_id=$1", [defense]))
        .length,
      0,
    );
    const passed = await patchJob(cid, "awdp", "VULNERABLE = False\n");
    assert.equal(passed.status, "passed", passed.error);
    assert.equal(passed.result.verdict, "defended");
    assert.equal(
      (await db.query("SELECT * FROM part_solves WHERE part_id=$1", [defense]))
        .length,
      1,
    );
    assert.equal(
      (await db.query("SELECT * FROM solves WHERE challenge_id=$1", [cid]))
        .length,
      0,
    );
    const unsafe = await patchJob(cid, "awdp", "VULNERABLE = True\n");
    assert.equal(unsafe.status, "failed");
    assert.equal(unsafe.result.verdict, "exploit_success");
    assert.match(unsafe.error, /安全检查/);
    assert.equal((await docker.listContainers("io.nebuctf.judge")).length, 0);
    await awd.tick();
    const [instance] = await db.query(
      "SELECT * FROM instances WHERE challenge_id=$1",
      [aid],
    );
    assert(instance);
    await worker.tick();
    await worker.drain();
    await awd.tick();
    await awd.drain();
    const [live] = await db.query("SELECT * FROM instances WHERE id=$1", [
      instance!.id,
    ]);
    assert.equal(live!.status, "running");
    t.diagnostic("AWDP build and checker passed; verifying AWD endpoint");
    const leaked = await fetch("http://" + live!.endpoint + "/leak").then((r) =>
      r.text(),
    );
    const [round] = await db.query(
      "SELECT * FROM contest_rounds WHERE challenge_id=$1 ORDER BY number DESC LIMIT 1",
      [aid],
    );
    assert.equal(
      leaked,
      dynamicFlag(
        aid,
        contest,
        "t:" + team,
        round!.id,
        "AD{[GUID]_[TEAM_HASH]}",
      ),
    );
    const [flag] = await db.query(
      "SELECT * FROM awd_flags WHERE flag_hash=$1",
      [flagHash(leaked)],
    );
    assert(flag);
    const [check] = await db.query(
      "SELECT * FROM awd_checks WHERE round_id=$1",
      [round!.id],
    );
    assert.equal(check!.status, "up");
    const applied = await patchJob(aid, "awd", "VULNERABLE = False\n");
    assert.equal(applied.status, "passed", applied.error);
    assert(applied.result.image);
    await worker.cleanup(live!);
    await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
      live!.id,
    ]);
    await awd.tick();
    const [replacement] = await db.query(
      "SELECT * FROM instances WHERE challenge_id=$1 AND status='queued'",
      [aid],
    );
    assert.equal(replacement!.spec.patch_job_id, applied.id);
    await worker.tick();
    await worker.drain();
    await awd.tick();
    await awd.drain();
    t.diagnostic("AWD patch passed; verifying replacement endpoint");
    const [patched] = await db.query("SELECT * FROM instances WHERE id=$1", [
      replacement!.id,
    ]);
    assert.equal(
      (await fetch("http://" + patched!.endpoint + "/leak")).status,
      403,
    );
    assert.equal(
      await fetch("http://" + patched!.endpoint + "/health").then((r) =>
        r.text(),
      ),
      "ok",
    );
    const group = crypto.randomUUID();
    await db.query(
      "INSERT INTO contest_groups(id,contest_id,name,position) VALUES($1,$2,'Resource test',0)",
      [group, contest],
    );
    await db.query(
      "UPDATE registrations SET group_id=$1 WHERE contest_id=$2 AND team_id=$3",
      [group, contest, team],
    );
    await db.transaction((tx) =>
      saveContestGroups(tx, contest, [
        {
          id: group,
          name: "Resource test",
          description: "",
          permissions: { resources: false },
        },
      ]),
    );
    await worker.tick();
    await worker.drain();
    await assert.rejects(
      docker.inspectContainer(`nebuctf-${patched!.id}`),
      (e: any) => e.statusCode === 404,
    );
    await awd.tick();
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM instances WHERE challenge_id=$1 AND status IN ('queued','starting','running')",
          [aid],
        )
      ).length,
      0,
    );
    const denied = await patchJob(cid, "awdp", "VULNERABLE = False\n");
    assert.equal(denied.status, "failed");
    assert.match(denied.error, /使用权限/);
    assert.equal((await docker.listContainers("io.nebuctf.judge")).length, 0);
    t.diagnostic(
      "Group revocation removed the real AWD container, blocked reprovision and refused queued patches",
    );
  },
);
