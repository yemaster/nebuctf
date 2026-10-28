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
  { timeout: 40000 },
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
      override async createTerminalExec() {
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
