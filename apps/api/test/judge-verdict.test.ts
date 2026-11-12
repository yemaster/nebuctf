import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { openDB } from "../src/db.js";
import { JudgeWorker } from "../src/judge-worker.js";
import { config } from "../src/config.js";
import { makeTar } from "../src/patch-archive.js";
import {
  flagEnvironmentSpec,
  flagForInstance,
} from "../src/flag-environment.js";
import { patchStorage } from "../src/judge.js";

test("patch worker reports functional, exploit, success and infrastructure outcomes without awarding failed defense", async (t) => {
  const db = await openDB(true),
    prior = config.DATA_DIR,
    dir = await mkdtemp(join(tmpdir(), "nebuctf-verdict-"));
  config.DATA_DIR = dir;
  t.after(async () => {
    await db.close();
    config.DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  });
  const user = crypto.randomUUID();
  await db.query(
    "INSERT INTO users(id,username,email,password_hash) VALUES($1,'verdict','verdict@test.invalid','test')",
    [user],
  );
  const profile = {
      image: "nebuctf/test:local",
      port: 8080,
      cpu: 100,
      memory: 32,
      ttl: 600,
      mode: "private",
      access_mode: "port",
    },
    patch = {
      checker_image: "nebuctf/check:local",
      patch_root: "/app",
      update_timeout: 2,
      timeout: 10,
      cpu: 100,
      memory: 32,
    };
  for (const [name, updateExit, functional, defense, expected, steps] of [
    ["update failure", 7, 0, 0, "update_error", []],
    ["update timeout", "timeout", 0, 0, "update_error", []],
    ["service failure", 0, 1, 0, "service_error", ["functional"]],
    ["exploit works", 0, 0, 1, "exploit_success", ["functional", "defense"]],
    ["checker error", 0, 0, 2, "error", ["functional", "defense"]],
    ["repaired", 0, 0, 0, "defended", ["functional", "defense"]],
  ] as const)
    await t.test(name, async () => {
      const cid = crypto.randomUUID(),
        jid = crypto.randomUUID(),
        def = crypto.randomUUID();
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice,challenge_type,resources,patch_config) VALUES($1,'Check','Web','入门','dynamic_container','',true,true,'awdp',$2,$3)",
        [
          cid,
          JSON.stringify({ container: profile, attachment: null }),
          JSON.stringify(patch),
        ],
      );
      await db.query(
        "INSERT INTO challenge_parts(id,challenge_id,title,position,role,flag_hash,initial_points,minimum_points) VALUES($1,$2,'Defense',1,'defense','',100,100),($3,$2,'Attack',0,'attack','',100,100)",
        [def, cid, crypto.randomUUID()],
      );
      await db.query(
        "UPDATE challenges SET flag_template='Judge{[GUID]}' WHERE id=$1",
        [cid],
      );
      await db.query(
        "UPDATE challenge_parts SET flag_template='Attack{[TEAM_HASH]}' WHERE challenge_id=$1 AND role='attack'",
        [cid],
      );
      const [challenge] = await db.query(
        "SELECT * FROM challenges WHERE id=$1",
        [cid],
      );
      const environment = await flagEnvironmentSpec(db, challenge!);
      const expectedFlag = flagForInstance(
        {
          challenge_id: cid,
          scope: "practice",
          owner_key: "u:" + user,
          spec: environment,
        },
        environment.parts[0],
      );
      await mkdir(patchStorage(), { recursive: true });
      await writeFile(
        join(patchStorage(), jid),
        gzipSync(
          makeTar([
            {
              name: "update.sh",
              data: Buffer.from(
                '#!/bin/sh\nset -eu\ncp "$PATCH_DIR/files/settings.py" ./settings.py\n',
              ),
              executable: false,
            },
            {
              name: "files/settings.py",
              data: Buffer.from("safe=True"),
              executable: false,
            },
          ]),
        ),
      );
      await db.query(
        "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,'practice',$3,$4,'queued',$1,'defense.tar.gz',$5,now()+interval '2 minutes')",
        [
          jid,
          cid,
          "u:" + user,
          user,
          JSON.stringify({
            container: profile,
            patch,
            type: "awdp",
            flag_environment: environment,
          }),
        ],
      );
      const containers = new Map<string, any>(),
        networks = new Map<string, any>(),
        seen: string[] = [];
      const missing = () => {
        throw Object.assign(Error("missing"), { statusCode: 404 });
      };
      const docker = {
        inspectImage: async () => ({
          Id: "sha256:" + "a".repeat(64),
          Config: {},
        }),
        buildPatch: async () => `nebuctf-patch:${jid}`,
        commitPatch: async () => `nebuctf-patch:${jid}`,
        createNetwork: async (c: any) => {
          networks.set(c.Name, { Id: c.Name, ...c });
        },
        inspectNetwork: async (name: string) => networks.get(name) ?? missing(),
        removeNetwork: async (name: string) => {
          networks.delete(name);
        },
        createContainer: async (c: any) => {
          if (!c.name.endsWith("-update")) {
            const prefix = c.name.endsWith("-target")
              ? "FLAG="
              : "EXPECTED_FLAG=";
            const flag = c.Env.find((v: string) => v.startsWith(prefix));
            assert.equal(
              flag,
              prefix + expectedFlag,
              "target and both checker stages receive the exact attack template flag",
            );
          }
          const v = {
            Config: c,
            NetworkSettings: {
              Networks: {
                [c.HostConfig.NetworkMode]: { IPAddress: "172.20.0.3" },
              },
            },
          };
          containers.set(c.name, v);
          return { Id: c.name };
        },
        startContainer: async () => {},
        inspectContainer: async (id: string) => containers.get(id) ?? missing(),
        waitContainer: async (id: string) => {
          if (id.endsWith("-update")) {
            if (updateExit === "timeout") throw Error("Docker API deadline");
            return { StatusCode: updateExit };
          }
          const mode = containers
            .get(id)
            .Config.Env.find((v: string) => v.startsWith("CHECK_MODE="))
            .split("=")[1];
          seen.push(mode);
          return { StatusCode: mode === "functional" ? functional : defense };
        },
        removeContainer: async (id: string) => {
          containers.delete(id);
        },
        removeImage: async () => {},
      };
      const job = (
        await db.query("SELECT * FROM judge_jobs WHERE id=$1", [jid])
      )[0]!;
      await new JudgeWorker(db, docker as any).run(job);
      const result = (
        await db.query("SELECT * FROM judge_jobs WHERE id=$1", [jid])
      )[0]!;
      assert.equal(result.result.verdict, expected);
      if (updateExit === 7) {
        assert.equal(result.result.update_exit_code, 7);
        assert.match(result.error, /退出码 7/);
      } else if (updateExit === "timeout") {
        assert.match(result.error, /更新脚本执行超时/);
      }
      assert.equal(
        result.status,
        expected === "defended" ? "passed" : "failed",
      );
      assert.deepEqual(seen, [...steps]);
      assert.equal(containers.size, 0);
      assert.equal(networks.size, 0);
      assert.equal(
        (await db.query("SELECT 1 FROM part_solves WHERE part_id=$1", [def]))
          .length,
        expected === "defended" ? 1 : 0,
      );
    });
});
