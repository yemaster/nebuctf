import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { config } from "../src/config.js";
import { digest, flagHash } from "../src/security.js";
import { makeTar } from "../src/patch-archive.js";

test(
  "contest submission caps are shared, atomic and independently overridable",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      dir = await mkdtemp(join(tmpdir(), "nebuctf-limit-test-")),
      previous = config.DATA_DIR;
    config.DATA_DIR = dir;
    t.after(async () => {
      await app.close();
      await db.close();
      config.DATA_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    });
    const scope = crypto.randomUUID(),
      cid = crypto.randomUUID(),
      awd = crypto.randomUUID(),
      team = crypto.randomUUID();
    const users = [];
    for (let i = 0; i < 2; i++) {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID();
      users.push({ id, cookie: `${sessionCookie}=${token}` });
      await db.query(
        "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
        [id, "limit" + id.slice(0, 10), id + "@test.invalid"],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      if (!i)
        await db.query(
          "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
          [team, team, id, team],
        );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
    }
    await db.query(
      "INSERT INTO contests(id,title,starts_at,ends_at,published,submission_limits) VALUES($1,'Limits',now()-interval '1 hour',now()+interval '1 hour',true,'{\"flag\":1,\"defense\":1}')",
      [scope],
    );
    await db.query(
      "INSERT INTO registrations(contest_id,team_id) VALUES($1,$2)",
      [scope, team],
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
        timeout: 10,
        cpu: 100,
        memory: 32,
      };
    for (const [id, type] of [
      [cid, "awdp"],
      [awd, "awd"],
    ]) {
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice,challenge_type,resources,patch_config) VALUES($1,$2,'Web','入门','static_attachment',$3,true,true,$4,$5,$6)",
        [
          id,
          id,
          flagHash("flag{right}"),
          type,
          JSON.stringify({ container: profile, attachment: null }),
          JSON.stringify(patch),
        ],
      );
      await db.query(
        "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
        [scope, id],
      );
    }
    const request = (path: string, user = users[0]!, body?: unknown) =>
      app.inject({
        url: "/api" + path,
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
          cookie: user.cookie,
        },
        payload: body as any,
      });
    await t.test(
      "two members cannot both use the last Flag attempt",
      async () => {
        const results = await Promise.all(
          users.map((user) =>
            request(`/challenges/${cid}/submit`, user, {
              scope,
              flag: "wrong",
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
        const detail = (
          await request(`/challenges/${cid}?scope=${scope}`)
        ).json();
        assert.deepEqual(detail.submission_usage.flag, {
          limit: 1,
          used: 1,
          remaining: 0,
        });
        assert.equal(
          (
            await request(`/challenges/${cid}/submit`, users[0], {
              scope,
              flag: "flag{right}",
            })
          ).statusCode,
          409,
        );
        await db.query(
          "UPDATE contests SET submission_overrides=$2 WHERE id=$1",
          [
            scope,
            JSON.stringify([{ challenge_id: cid, flag: null, defense: 1 }]),
          ],
        );
        assert.equal(
          (
            await request(`/challenges/${cid}/submit`, users[0], {
              scope,
              flag: "flag{right}",
            })
          ).statusCode,
          200,
        );
      },
    );
    await t.test(
      "invalid AWD attacks consume the same team cap and practice does not consume formal attempts",
      async () => {
        const r = await request(`/challenges/${awd}/attack`, users[0], {
          scope,
          flag: "wrong",
        });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(
          (
            await request(`/challenges/${awd}/attack`, users[1], {
              scope,
              flag: "wrong",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await request(`/challenges/${cid}/submit`, users[0], {
              scope: "practice",
              flag: "wrong",
            })
          ).statusCode,
          200,
        );
        const count = await db.query(
          "SELECT count(*)::int n FROM submissions WHERE scope=$1 AND challenge_id=$2",
          [scope, cid],
        );
        assert.equal(count[0]!.n, 2);
      },
    );
    const upload = (data: Buffer, user = users[0]!) =>
      app.inject({
        url: `/api/challenges/${cid}/patches?scope=${scope}`,
        method: "POST",
        headers: {
          cookie: user.cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
          "content-type": "multipart/form-data; boundary=limit-upload",
        },
        payload: Buffer.concat([
          Buffer.from(
            '--limit-upload\r\nContent-Disposition: form-data; name="file"; filename="patch.tar"\r\nContent-Type: application/x-tar\r\n\r\n',
          ),
          data,
          Buffer.from("\r\n--limit-upload--\r\n"),
        ]),
      });
    await t.test(
      "invalid archives cost no attempt; accepted and failed patches retain their defense attempt",
      async () => {
        assert.equal(
          (await upload(Buffer.from("bad archive"))).statusCode,
          400,
        );
        const archive = makeTar([
          {
            name: "settings.py",
            data: Buffer.from("safe=True"),
            executable: false,
          },
        ]);
        const accepted = await upload(archive);
        assert.equal(accepted.statusCode, 200, accepted.body);
        await db.query(
          "UPDATE judge_jobs SET status='failed',result='{\"verdict\":\"service_error\"}',error='test',finished_at=now() WHERE id=$1",
          [accepted.json().id],
        );
        const retry = await upload(archive, users[1]);
        assert.equal(retry.statusCode, 409, retry.body);
        assert.match(retry.body, /防御申请次数已用完/);
        const results = (
          await request(`/challenges/${cid}/patches?scope=${scope}`)
        ).json();
        assert.deepEqual(results.usage, { limit: 1, used: 1, remaining: 0 });
        assert.equal(results.items[0].result.verdict, "service_error");
        await db.query(
          "UPDATE contests SET ends_at=now()-interval '1 second',practice_mode=true WHERE id=$1",
          [scope],
        );
        assert.equal(
          (await request(`/challenges/${cid}?scope=${scope}`)).json()
            .submission_usage.flag.limit,
          null,
        );
        assert.equal(
          (await request(`/challenges/${cid}/patches?scope=${scope}`)).json()
            .usage.limit,
          null,
        );
      },
    );
    await t.test(
      "administrator can save, preserve and clear submission policies",
      async () => {
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [
          users[0]!.id,
        ]);
        const input = {
          title: "Limit configuration",
          starts_at: new Date(Date.now() + 3600000).toISOString(),
          ends_at: new Date(Date.now() + 7200000).toISOString(),
          challenge_ids: [cid],
          submission_limits: { flag: 20, defense: 5 },
          submission_overrides: [{ challenge_id: cid, flag: 3, defense: null }],
        };
        const created = await request("/admin/contests", users[0], input);
        assert.equal(created.statusCode, 200, created.body);
        const path = `/admin/contests/${created.json().id}`;
        const saved = (await request(path)).json();
        assert.deepEqual(saved.submission_limits, input.submission_limits);
        assert.deepEqual(
          saved.submission_overrides,
          input.submission_overrides,
        );
        const put = (payload: unknown) =>
          app.inject({
            url: "/api" + path,
            method: "PUT",
            payload: payload as any,
            headers: {
              origin: config.APP_ORIGIN,
              "x-csrf-protection": "1",
              cookie: users[0]!.cookie,
            },
          });
        const { submission_limits, submission_overrides, ...legacy } = input;
        assert.equal((await put(legacy)).statusCode, 200);
        assert.deepEqual(
          (await request(path)).json().submission_overrides,
          submission_overrides,
        );
        const invalid = await put({
          ...input,
          submission_limits: { flag: 0, defense: 5 },
        });
        assert.equal(invalid.statusCode, 400);
        const cleared = await put({
          ...input,
          submission_limits: { flag: null, defense: null },
          submission_overrides: [],
        });
        assert.equal(cleared.statusCode, 200, cleared.body);
        const final = (await request(path)).json();
        assert.deepEqual(final.submission_limits, {
          flag: null,
          defense: null,
        });
        assert.deepEqual(final.submission_overrides, []);
      },
    );
  },
);
