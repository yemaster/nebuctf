import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { flagForInstance } from "../src/flag-environment.js";
import { recordIssuedFlags } from "../src/contest-monitor.js";
import { sampleTraffic, indexCaptureFiles } from "../src/traffic-worker.js";
import { notifyContest } from "../src/activity-events.js";
import type { DockerEngine } from "../src/docker.js";

test(
  "scoped roles, stable contest flags, private submission logs and traffic exports",
  { timeout: 90000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      previous = config.TRAFFIC_DIR;
    const directory = await mkdtemp(join(tmpdir(), "nebu-traffic-"));
    config.TRAFFIC_DIR = directory;
    t.after(async () => {
      await app.close();
      await db.close();
      config.TRAFFIC_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    });
    await app.ready();
    async function account(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        team = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, `access${id.slice(0, 8)}`, `${id}@example.test`, role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, `Team ${team.slice(0, 8)}`, id, team],
      );
      await db.query("INSERT INTO memberships VALUES($1,$2)", [id, team]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await account("admin"),
      manager = await account(),
      alice = await account(),
      bob = await account();
    const request = (
      path: string,
      user = admin,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: `/api${path}`,
        method: method as any,
        headers: {
          cookie: user.cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: body as any,
      });
    const ok = async (
      path: string,
      user = admin,
      body?: unknown,
      method?: string,
    ) => {
      const r = await request(path, user, body, method);
      assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
      return r.json();
    };
    const profile = {
      image: "nebuctf/test:1",
      cpu: 100,
      memory: 64,
      ttl: 600,
      mode: "private",
      access_mode: "port",
      port: 8080,
    };
    const body = {
      title: "Bound Flag",
      category: "Web",
      difficulty: "入门",
      published: true,
      practice: true,
      flag_mode: "dynamic",
      flag_template: "Nebu{[GUID]}",
      resources: { container: profile, attachment: profile },
    };
    const challenge = await ok("/admin/challenges", admin, body),
      otherChallenge = await ok("/admin/challenges", admin, {
        ...body,
        title: "Other Flag",
      });
    const contestBody = {
      title: "Scoped contest",
      description: "",
      starts_at: new Date(Date.now() - 60000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      published: true,
      require_review: false,
      team_limit: 4,
      challenge_ids: [challenge.id],
    };
    const contest = await ok("/admin/contests", admin, contestBody),
      otherContest = await ok("/admin/contests", admin, {
        ...contestBody,
        title: "Other contest",
        challenge_ids: [otherChallenge.id],
      });
    for (const user of [alice, bob])
      await ok(`/contests/${contest.id}/register`, user, {
        team_id: user.team,
      });
    await t.test(
      "roles and exact object grants are enforced by APIs and lists",
      async () => {
        assert.equal(
          (await request("/admin/resources", manager)).statusCode,
          403,
        );
        const role = await ok("/admin/roles", admin, {
          name: "Resource viewer",
          permissions: ["resources.read"],
        });
        const access = {
          role: "user",
          roles: [role.id],
          grants: [
            {
              kind: "challenge",
              id: challenge.id,
              permissions: ["challenges.read"],
            },
            {
              kind: "contest",
              id: contest.id,
              permissions: ["contests.read", "traffic.write"],
            },
          ],
        };
        await ok(`/admin/users/${manager.id}/access`, admin, access, "PUT");
        assert.equal(
          (await ok("/me", manager)).user.access.roles[0].name,
          "Resource viewer",
        );
        await ok("/admin/resources", manager);
        assert.equal(
          (await request(`/admin/challenges/${otherChallenge.id}`, manager))
            .statusCode,
          403,
        );
        assert.equal(
          (await request(`/admin/contests/${otherContest.id}`, manager))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await request(
              `/admin/challenges/${challenge.id}/publication`,
              manager,
              { published: false },
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (await request("/admin/challenges", manager, body)).statusCode,
          403,
        );
        assert.deepEqual(
          (await ok("/admin/challenges", manager)).items.map((c: any) => c.id),
          [challenge.id],
        );
        assert.deepEqual(
          (await ok("/admin/contests", manager)).items.map((c: any) => c.id),
          [contest.id],
        );
        assert.equal(
          (
            await request("/admin/roles", manager, {
              name: "Escalation",
              permissions: ["users.write"],
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await request(
              `/admin/users/${manager.id}/access`,
              manager,
              { ...access, role: "admin" },
              "PUT",
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await request(
              `/admin/users/${admin.id}/access`,
              admin,
              { role: "user", roles: [], grants: [] },
              "PUT",
            )
          ).statusCode,
          409,
        );
        await ok(
          `/admin/roles/${role.id}`,
          admin,
          { name: "Resource viewer", permissions: [] },
          "PUT",
        );
        assert.equal(
          (await request("/admin/resources", manager)).statusCode,
          403,
          "revocation is immediate for existing sessions",
        );
        assert.equal(
          (
            await request(
              "/admin/settings/traffic",
              manager,
              { enabled: false },
              "PUT",
            )
          ).statusCode,
          403,
          "contest grants cannot change global policy",
        );
        await ok(
          `/admin/contests/${contest.id}/traffic/policy`,
          manager,
          { mode: "capture" },
          "PUT",
        );
        assert.equal(
          (
            await request(
              `/admin/contests/${otherContest.id}/traffic/policy`,
              manager,
              { mode: "capture" },
              "PUT",
            )
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "scoped monitor sockets close when the grant is revoked",
      async () => {
        await db.query(
          "UPDATE contests SET visibility='private',spectator_enabled=false WHERE id=$1",
          [contest.id],
        );
        await ok(`/contests/${contest.id}/spectate`, manager);
        assert.equal(
          (await request(`/contests/${contest.id}/spectate`, alice)).statusCode,
          403,
        );
        const screen = await app.injectWS(
          `/api/contests/${contest.id}/spectate/ws`,
          { headers: { cookie: manager.cookie, origin: config.APP_ORIGIN } },
        );
        const screenClosed = new Promise<number>((resolve) =>
          screen.once("close", resolve),
        );
        const snapshots: unknown[] = [];
        const socket = await app.injectWS(
          `/api/admin/contests/${contest.id}/activity/ws`,
          { headers: { cookie: manager.cookie, origin: config.APP_ORIGIN } },
          {
            onInit: (s) =>
              s.on("message", (m) => snapshots.push(JSON.parse(m.toString()))),
          },
        );
        try {
          for (let n = 0; n < 100 && !snapshots.length; n++)
            await new Promise((r) => setTimeout(r, 20));
          assert(snapshots.length, "scoped viewer receives monitor data");
          const closed = new Promise<number>((resolve) =>
            socket.once("close", resolve),
          );
          await ok(
            `/admin/users/${manager.id}/access`,
            admin,
            {
              role: "user",
              roles: [],
              grants: [
                {
                  kind: "contest",
                  id: contest.id,
                  permissions: ["traffic.read"],
                },
              ],
            },
            "PUT",
          );
          await ok(`/admin/contests/${contest.id}/traffic/context`, manager);
          assert.equal(
            (await request(`/admin/contests/${contest.id}/activity`, manager))
              .statusCode,
            403,
          );
          await notifyContest(db, contest.id);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            assert.equal(
              await Promise.race([
                Promise.all([closed, screenClosed]).then((codes) => {
                  assert.equal(codes[1], 1008);
                  return codes[0];
                }),
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => reject(Error("monitor remained authorized")),
                    6500,
                  );
                }),
              ]),
              1008,
            );
          } finally {
            clearTimeout(timer);
          }
        } finally {
          socket.terminate();
          screen.terminate();
        }
        await ok(
          `/admin/users/${manager.id}/access`,
          admin,
          {
            role: "user",
            roles: [],
            grants: [
              {
                kind: "challenge",
                id: challenge.id,
                permissions: ["challenges.read"],
              },
              {
                kind: "contest",
                id: contest.id,
                permissions: ["contests.read", "traffic.write"],
              },
            ],
          },
          "PUT",
        );
      },
    );
    let first: any, flag: string;
    await t.test(
      "destroying and recreating attachments or containers keeps the same scoped flag",
      async () => {
        const started = await ok(
          `/challenges/${challenge.id}/instances`,
          alice,
          { scope: contest.id, resource_type: "container" },
        );
        [first] = await db.query("SELECT * FROM instances WHERE id=$1", [
          started.id,
        ]);
        flag = flagForInstance(first);
        await recordIssuedFlags(db, first);
        await db.query(
          "UPDATE instances SET status='stopped',expires_at=now()-interval '1 hour' WHERE id=$1",
          [first.id],
        );
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'resource:%'");
        await ok(
          `/admin/challenges/${challenge.id}`,
          admin,
          { ...body, flag_template: "Changed{[GUID]}" },
          "PUT",
        );
        const created = await ok(
          `/challenges/${challenge.id}/instances`,
          alice,
          { scope: contest.id, resource_type: "attachment" },
        );
        const [attachment] = await db.query(
          "SELECT * FROM instances WHERE id=$1",
          [created.id],
        );
        assert.equal(
          flagForInstance(attachment!),
          flag,
          "template is pinned across resource types and administrator edits",
        );
        assert.equal(
          (
            await ok(`/challenges/${challenge.id}/submit`, alice, {
              scope: contest.id,
              flag,
            })
          ).correct,
          true,
        );
        assert.equal(
          (
            await ok(`/challenges/${challenge.id}/submit`, bob, {
              scope: contest.id,
              flag,
            })
          ).correct,
          false,
          "other teams cannot reuse the flag",
        );
        await ok(`/contests/${otherContest.id}/register`, alice, {
          team_id: alice.team,
        });
        assert.equal(
          (
            await ok(`/challenges/${otherChallenge.id}/submit`, alice, {
              scope: otherContest.id,
              flag,
            })
          ).correct,
          false,
        );
      },
    );
    await t.test(
      "wrong flag text is encrypted at rest and returned only in authorized logs",
      async () => {
        const wrong = " flag{<script>example</script>}\n";
        await ok(`/challenges/${challenge.id}/submit`, alice, {
          scope: contest.id,
          flag: wrong,
        });
        const [stored] = await db.query(
          "SELECT * FROM submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
          [alice.id],
        );
        assert(stored!.flag_cipher && !stored!.flag_cipher.includes(wrong));
        const log = await ok("/admin/submissions");
        assert.equal(
          log.items.find((s: any) => s.id === stored!.id).submitted_flag,
          wrong,
        );
        assert(!JSON.stringify(log).includes("flag_cipher"));
        const activity = await ok(
          `/admin/contests/${contest.id}/activity`,
          manager,
        );
        assert.equal(
          activity.items.find((s: any) => s.id === stored!.id).submitted_flag,
          wrong,
        );
        const personal = await ok("/submissions", alice);
        assert(!JSON.stringify(personal).includes(wrong));
        assert.equal(
          (await request("/admin/submissions", alice)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/admin/contests/${contest.id}/activity`, bob))
            .statusCode,
          403,
        );
      },
    );
    await t.test(
      "traffic counters survive resets and PCAP exports respect the contest boundary",
      async () => {
        await db.query(
          "UPDATE instances SET status='running',endpoint='example.test:31000',container_id='test' WHERE id=$1",
          [first.id],
        );
        let rx = 100,
          tx = 200;
        const docker = {
          containerStats: async () => ({
            networks: {
              eth0: {
                rx_bytes: rx,
                tx_bytes: tx,
                rx_dropped: 0,
                tx_dropped: 0,
              },
            },
          }),
        } as unknown as DockerEngine;
        const now = Date.now();
        await sampleTraffic(db, docker, first.id, new Date(now - 30000));
        rx = 300;
        tx = 600;
        await sampleTraffic(db, docker, first.id, new Date(now - 15000));
        rx = 10;
        tx = 20;
        await sampleTraffic(db, docker, first.id, new Date(now));
        const [traffic] = await db.query(
          "SELECT * FROM instance_traffic WHERE instance_id=$1",
          [first.id],
        );
        assert.equal(Number(traffic!.rx_bytes), 310);
        assert.equal(Number(traffic!.tx_bytes), 620);
        const dir = join(directory, first.id);
        await mkdir(dir);
        const name = `${Date.now()}-${crypto.randomUUID()}.pcap`,
          pcap = Buffer.alloc(24);
        pcap.writeUInt32LE(0xa1b2c3d4);
        await writeFile(join(dir, name), pcap);
        await writeFile(join(dir, "unfinished.part"), pcap);
        await indexCaptureFiles(db, first.id);
        const detail = await ok(
          `/admin/contests/${contest.id}/traffic/instances/${first.id}`,
          manager,
        );
        assert.equal(detail.total, 1);
        assert.equal(detail.instance.endpoint, "example.test:31000");
        assert(detail.timeline.length);
        const path = `/admin/contests/${contest.id}/traffic/files/${detail.files[0].id}`;
        const download = await request(path, manager);
        assert.equal(download.statusCode, 200);
        assert.deepEqual(download.rawPayload, pcap);
        assert.equal((await request(path, alice)).statusCode, 403);
        assert.equal(
          (
            await request(
              `/admin/contests/${otherContest.id}/traffic/files/${detail.files[0].id}`,
              admin,
            )
          ).statusCode,
          404,
        );
        const resources = await ok("/admin/resources");
        assert.equal(
          resources.items.find((i: any) => i.id === first.id).endpoint,
          "example.test:31000",
        );
        assert(
          resources.items
            .find((i: any) => i.id === first.id)
            .owner_name.startsWith("Team"),
        );
        await ok(
          `/admin/users/${manager.id}/access`,
          admin,
          { role: "user", roles: [], grants: [] },
          "PUT",
        );
        assert.equal((await request(path, manager)).statusCode, 403);
      },
    );
  },
);
