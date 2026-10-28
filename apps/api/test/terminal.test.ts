import {
  parseTerminalEndpoint,
  type TerminalTarget,
} from "../src/terminal-target.js";
import {
  containerInput,
  resourceProfiles,
  runtimeResourceProfiles,
} from "../src/challenge-model.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import WebSocket from "ws";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import { defaults, saveSetting } from "../src/settings.js";
import {
  signTerminalTicket,
  verifyTerminalTicket,
  terminalAccess,
} from "../src/terminal-auth.js";
import { DockerEngine } from "../src/docker.js";
import { startTerminalWorker } from "../src/terminal-worker.js";
import { containerConfig } from "../src/worker.js";

test(
  "terminal ownership, quotas, lifecycle and authenticated PTY websocket",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(true),
      app = await buildApp(db);
    const users = [crypto.randomUUID(), crypto.randomUUID()];
    const tokens = [crypto.randomUUID(), crypto.randomUUID()];
    for (let n = 0; n < 2; n++) {
      await db.query(
        "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,'test')",
        [users[n], `term${n}`, `term${n}@example.test`],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(tokens[n]!), users[n]],
      );
    }
    const headers = (n = 0) => ({
      cookie: `${sessionCookie}=${tokens[n]}`,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
    });
    const request = (url: string, method: "GET" | "POST" = "GET", n = 0) =>
      app.inject({ url, method, headers: headers(n) });
    const sockets: WebSocket[] = [];
    let iid = "";
    class TerminalDocker extends DockerEngine {
      streams: PassThrough[] = [];
      sizes: number[][] = [];
      override async inspectContainer() {
        return {
          Id: iid,
          Config: { Labels: { "io.nebuctf.instance": iid } },
          State: { Running: true, Status: "running" },
          NetworkSettings: { Ports: {}, Networks: {} },
        };
      }
      target?: TerminalTarget;
      override async createTerminalExec(
        _container: string,
        target?: TerminalTarget,
      ) {
        this.target = target;
        return "safe-exec";
      }
      override async attachTerminal() {
        const stream = new PassThrough();
        this.streams.push(stream);
        return stream;
      }
      override async resizeTerminal(_exec: string, cols: number, rows: number) {
        this.sizes.push([cols, rows]);
      }
    }
    const docker = new TerminalDocker(),
      server = startTerminalWorker(db, docker, 0);
    await once(server, "listening");
    const previousURL = config.TERMINAL_WORKER_URL;
    config.TERMINAL_WORKER_URL = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
    t.after(async () => {
      config.TERMINAL_WORKER_URL = previousURL;
      for (const s of sockets) s.terminate();
      for (const s of server.clients) s.terminate();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
      await db.close();
    });
    await app.ready();
    const wait = async (predicate: () => boolean) => {
      const deadline = Date.now() + 13000;
      while (!predicate() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 20));
      assert.ok(predicate(), "terminal event arrived");
    };
    await t.test(
      "only the owner can start/read; one active instance and common quotas",
      async () => {
        assert.equal((await app.inject("/api/terminal")).statusCode, 401);
        const created = await request("/api/terminal", "POST");
        assert.equal(created.statusCode, 200, created.body);
        iid = created.json().id;
        assert.equal((await request("/api/terminal", "POST")).json().id, iid);
        const detail = (await request("/api/terminal")).json().instance;
        assert.equal(detail.queue_ahead, 0);
        assert.equal(
          (await request("/api/terminal", "GET", 1)).json().instance,
          null,
        );
        assert.equal(
          (await request(`/api/instances/${iid}/stop`, "POST", 1)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/api/instances/${iid}/stop`, "POST")).statusCode,
          429,
        );
        const [row] = await db.query("SELECT * FROM instances WHERE id=$1", [
          iid,
        ]);
        assert.equal(row!.challenge_id, null);
        const spec = containerConfig(row!);
        assert.deepEqual(spec.HostConfig.PortBindings, {});
        assert.deepEqual(spec.HostConfig.CapDrop, ["ALL"]);
        assert.equal(spec.HostConfig.ReadonlyRootfs, true);
        assert.equal(spec.User, "65534:65534");
        assert.equal(
          spec.Env.some((value: string) => value.startsWith("FLAG=")),
          false,
        );
        assert.ok(!spec.HostConfig.Binds);
        await saveSetting(db, "containers", {
          ...defaults.containers,
          max_instances: 1,
        });
        assert.equal(
          (await request("/api/terminal", "POST", 1)).statusCode,
          409,
        );
        await saveSetting(db, "containers", defaults.containers);
        await db.query(
          "UPDATE instances SET status='running',expires_at=now()+interval '30 minutes' WHERE id=$1",
          [iid],
        );
        const listed = (
          await request("/api/instances?scope=practice&owned=true")
        ).json();
        assert.equal(listed.items[0]?.title, "终端");
        assert.equal(
          (await request(`/api/instances/${iid}/renew`, "POST")).statusCode,
          200,
        );
      },
    );
    await t.test(
      "signed tickets reject tampering and expired sessions",
      async () => {
        const ticket = signTerminalTicket({
          instance: iid,
          user: users[0]!,
          session: digest(tokens[0]!),
        });
        assert.equal(verifyTerminalTicket(ticket).instance, iid);
        assert.throws(() =>
          verifyTerminalTicket(
            ticket.replace(/^./, ticket[0] === "a" ? "b" : "a"),
          ),
        );
        assert.equal(
          await terminalAccess(db, verifyTerminalTicket(ticket)),
          true,
        );
        assert.equal(
          await terminalAccess(db, {
            ...verifyTerminalTicket(ticket),
            user: users[1]!,
          }),
          false,
        );
      },
    );
    await t.test(
      "nc links resolve authorized targets, reuse the terminal and revoke expired targets",
      async () => {
        const cid = crypto.randomUUID(),
          target = crypto.randomUUID(),
          other = crypto.randomUUID();
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,published,practice,resources) VALUES($1,'NC test','Pwn','简单','dynamic_container',true,true,$2)",
          [
            cid,
            JSON.stringify({
              container: {
                image: "test/nc",
                protocol: "nc",
                access_mode: "port",
                mode: "private",
                port: 8080,
                cpu: 500,
                memory: 256,
                ttl: 1800,
              },
              attachment: null,
            }),
          ],
        );
        for (const [id, user] of [
          [target, users[0]],
          [other, users[1]],
        ])
          await db.query(
            "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,endpoint,expires_at,max_expires_at) VALUES($1,$2,'practice',$3,$4,'dynamic_container','running','{}','127.0.0.1:30001',now()+interval '30 minutes',now()+interval '1 hour')",
            [id, cid, `u:${user}`, user],
          );
        const result = await request(`/api/terminal/targets/${target}`);
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(result.json().href, `/challenges?challenge=${cid}`);
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/api/terminal/targets/${target}`, "GET", 1))
            .statusCode,
          403,
        );
        const reused = await app.inject({
          method: "POST",
          url: "/api/terminal",
          headers: headers(),
          payload: { target },
        });
        assert.equal(reused.json().id, iid);
        const path = `/api/terminal/${iid}/connect?target=${target}`;
        await assert.rejects(
          app.injectWS(`/api/terminal/${iid}/connect?target=${other}`, {
            headers: headers(),
          }),
          /403/,
        );
        await assert.rejects(
          app.injectWS(`/api/terminal/${iid}/connect?command=whoami`, {
            headers: headers(),
          }),
          /400/,
        );
        let ready = false;
        const socket = await app.injectWS(
          path,
          { headers: headers() },
          {
            onInit: (ws) =>
              ws.on("message", (raw) => {
                if (raw.toString().includes('"ready"')) ready = true;
              }),
          },
        );
        sockets.push(socket);
        await wait(() => ready);
        assert.deepEqual(
          docker.target && {
            id: docker.target.id,
            host: docker.target.host,
            port: docker.target.port,
          },
          { id: target, host: "127.0.0.1", port: 30001 },
        );
        await db.query(
          "UPDATE instances SET expires_at=now()-interval '1 second' WHERE id=$1",
          [target],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${target}`)).statusCode,
          409,
        );
        await wait(() => socket.readyState === WebSocket.CLOSED);
        await db.query("UPDATE instances SET owner_key='shared' WHERE id=$1", [
          other,
        ]);
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          200,
        );
        await db.query(
          "UPDATE challenges SET resources=jsonb_set(resources,'{container,protocol}','\"http\"') WHERE id=$1",
          [cid],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          409,
        );
        await db.query("UPDATE challenges SET practice=false WHERE id=$1", [
          cid,
        ]);
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          404,
        );
        const cup = crypto.randomUUID(),
          teamA = crypto.randomUUID(),
          teamB = crypto.randomUUID(),
          group = crypto.randomUUID();
        for (const [team, user] of [
          [teamA, users[0]],
          [teamB, users[1]],
        ]) {
          await db.query(
            "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
            [team, `NC ${team}`, user, team],
          );
          await db.query(
            "INSERT INTO memberships(user_id,team_id) VALUES($1,$2)",
            [user, team],
          );
        }
        await db.query(
          "INSERT INTO contests(id,title,starts_at,ends_at,published) VALUES($1,'NC cup',now()-interval '1 hour',now()+interval '1 hour',true)",
          [cup],
        );
        await db.query(
          "INSERT INTO contest_challenges(contest_id,challenge_id) VALUES($1,$2)",
          [cup, cid],
        );
        await db.query(
          "INSERT INTO registrations(contest_id,team_id,status) VALUES($1,$2,'accepted'),($1,$3,'accepted')",
          [cup, teamA, teamB],
        );
        await db.query(
          "UPDATE challenges SET resources=jsonb_set(resources,'{container,protocol}','\"nc\"') WHERE id=$1",
          [cid],
        );
        await db.query(
          "UPDATE instances SET scope=$1,owner_key=$2 WHERE id=$3",
          [cup, `t:${teamB}`, other],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          403,
          "ordinary contests do not expose another team's instance",
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`, "GET", 1))
            .statusCode,
          200,
        );
        await db.query(
          "UPDATE challenges SET challenge_type='awd' WHERE id=$1",
          [cid],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          200,
          "AWD opponents are available to accepted participants",
        );
        await db.query(
          "INSERT INTO contest_groups(id,contest_id,name,position,permissions) VALUES($1,$2,'Restricted',0,'{\"resources\":false}')",
          [group, cup],
        );
        await db.query(
          "UPDATE registrations SET group_id=$1 WHERE contest_id=$2 AND team_id=$3",
          [group, cup, teamA],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          403,
          "group resource restrictions also apply to the terminal",
        );
        await db.query(
          "DELETE FROM registrations WHERE contest_id=$1 AND team_id=$2",
          [cup, teamA],
        );
        assert.equal(
          (await request(`/api/terminal/targets/${other}`)).statusCode,
          403,
          "spectators cannot connect to AWD targets",
        );
        await db.query("DELETE FROM instances WHERE challenge_id=$1", [cid]);
      },
    );
    await t.test(
      "proxy refuses cross-origin/other-owner access, forwards input and resize, reconnects and revokes",
      async () => {
        const path = `/api/terminal/${iid}/connect`;
        await assert.rejects(
          app.injectWS(path, {
            headers: { ...headers(), origin: "https://elsewhere.invalid" },
          }),
          /403/,
        );
        await assert.rejects(
          app.injectWS(path, { headers: headers(1) }),
          /404/,
        );
        await assert.rejects(
          app.injectWS(path, { headers: { origin: config.APP_ORIGIN } }),
          /401/,
        );
        const messages: { data: string; binary: boolean }[] = [];
        const connect = async () => {
          const socket = await app.injectWS(
            path,
            { headers: headers() },
            {
              onInit: (ws) =>
                ws.on("message", (raw, binary) =>
                  messages.push({ data: raw.toString(), binary }),
                ),
            },
          );
          sockets.push(socket);
          return socket;
        };
        const socket = await connect();
        await wait(() => messages.some((m) => m.data.includes('"ready"')));
        socket.send(
          JSON.stringify({ type: "input", data: "nc challenge 30001\r" }),
        );
        socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
        await wait(
          () =>
            messages.some((m) => m.binary && m.data.includes("nc challenge")) &&
            docker.sizes.length > 0,
        );
        assert.deepEqual(docker.sizes[0], [100, 30]);
        messages.length = 0;
        const replacement = await connect();
        await wait(
          () =>
            messages.some((m) => m.data.includes('"ready"')) &&
            socket.readyState === WebSocket.CLOSED,
        );
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(tokens[0]!),
        ]);
        await wait(() => replacement.readyState === WebSocket.CLOSED);
        assert.ok(docker.streams.every((s) => s.destroyed));
        await db.query(
          "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
          [digest(tokens[0]!), users[0]],
        );
      },
    );
    await t.test(
      "stop and expiry invalidate terminal access and release through the scheduler",
      async () => {
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'resource:%'");
        assert.equal(
          (await request(`/api/instances/${iid}/stop`, "POST")).statusCode,
          200,
        );
        assert.equal(
          (await request("/api/terminal")).json().instance.status,
          "stopping",
        );
        const ticket = verifyTerminalTicket(
          signTerminalTicket({
            instance: iid,
            user: users[0]!,
            session: digest(tokens[0]!),
          }),
        );
        assert.equal(await terminalAccess(db, ticket), false);
        await db.query(
          "UPDATE instances SET status='running',expires_at=now()-interval '1 second' WHERE id=$1",
          [iid],
        );
        assert.equal(await terminalAccess(db, ticket), false);
        assert.equal(
          (await request(`/api/instances/${iid}/renew`, "POST")).statusCode,
          409,
        );
      },
    );
  },
);

test("terminal endpoints cannot become shell commands and protocol changes preserve runtime configuration", () => {
  for (const value of [
    "127.0.0.1:30000",
    "challenge.example:30001",
    "[::1]:30002",
  ])
    assert.ok(parseTerminalEndpoint(value).port);
  for (const value of [
    "-e:30000",
    "foo;id:30000",
    "$(id):30000",
    "x:0",
    "x:65536",
    "http://x:80",
    "x:30\n000",
    "a..b:12",
  ])
    assert.throws(() => parseTerminalEndpoint(value));
  const http = containerInput.parse({
    image: "test/image",
    access_mode: "port",
  });
  const nc = { ...http, protocol: "nc" as const };
  assert.equal(
    containerInput.safeParse({ ...nc, access_mode: "domain" }).success,
    false,
  );
  const { protocol: _, ...old } = http;
  assert.deepEqual(
    resourceProfiles({ resources: { container: old, attachment: null } })
      .container,
    http,
  );
  assert.deepEqual(
    runtimeResourceProfiles({ resources: { container: nc } }),
    runtimeResourceProfiles({ resources: { container: http } }),
  );
});
