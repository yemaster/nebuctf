import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { requireUser, sessionCookie } from "./auth.js";
import { audit, lock, type DB } from "./db.js";
import { config } from "./config.js";
import { digest, fail, rate } from "./security.js";
import { id } from "./schemas.js";
import {
  activeStatuses,
  resourceCooldown,
  validateImage,
} from "./resources.js";
import { allocationPlan } from "./container-policy.js";
import { withQueuePositions } from "./resource-queue.js";
import { signTerminalTicket } from "./terminal-auth.js";

export function terminalRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/terminal", async (req) => {
    const u = requireUser(req);
    const rows = await db.query(
      `SELECT i.id,i.status,i.error,i.created_at,i.expires_at,i.max_expires_at,i.renew_count,
       (i.spec->>'ttl')::int ttl,(i.spec->>'renew_limit')::int renew_limit,r.expires_at next_operation_at
       FROM instances i LEFT JOIN rate_limits r ON r.key='resource:'||i.owner_key||':practice:terminal:terminal'
       WHERE i.kind='terminal' AND i.owner_key=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 1`,
      [`u:${u.id}`],
    );
    return { instance: (await withQueuePositions(db, rows))[0] ?? null };
  });
  app.post("/api/terminal", async (req) => {
    const u = requireUser(req),
      owner = `u:${u.id}`;
    await rate(db, `terminal:${u.id}`, 10, 60);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [existing] = await tx.query(
        "SELECT id,status FROM instances WHERE kind='terminal' AND owner_key=$1 AND status=ANY($2::text[])",
        [owner, activeStatuses],
      );
      if (existing) return existing;
      validateImage(config.TERMINAL_IMAGE);
      const spec = {
        image: config.TERMINAL_IMAGE,
        cpu: 250,
        memory: 128,
        resource_type: "terminal",
      };
      const { policy } = await allocationPlan(tx, "practice", owner, spec);
      await resourceCooldown(tx, owner, "practice", "terminal", "terminal");
      const iid = crypto.randomUUID();
      await tx.query(
        `INSERT INTO instances(id,scope,owner_key,requested_by,kind,resource_type,status,spec,expires_at,max_expires_at)
        VALUES($1,'practice',$2,$3,'terminal','terminal','queued',$4,now()+interval '5 minutes',now()+$5*interval '1 second')`,
        [
          iid,
          owner,
          u.id,
          JSON.stringify({
            ...spec,
            ttl: policy.default_ttl,
            renew_limit: policy.renew_limit,
            renew_seconds: policy.renew_seconds,
          }),
          policy.default_ttl + policy.renew_limit * policy.renew_seconds + 300,
        ],
      );
      await audit(tx, u.id, "terminal.create", iid);
      return { id: iid, status: "queued" };
    });
  });
  const peers = new Set<WebSocket>();
  app.get(
    "/api/terminal/:id/connect",
    {
      websocket: true,
      preValidation: async (req) => {
        const u = requireUser(req);
        if (req.headers.origin !== config.APP_ORIGIN)
          fail(403, "请求来源验证失败");
        const iid = id.parse((req.params as { id: string }).id);
        const [row] = await db.query(
          "SELECT id FROM instances WHERE id=$1 AND kind='terminal' AND owner_key=$2 AND status='running' AND expires_at>now()",
          [iid, `u:${u.id}`],
        );
        if (!row) fail(404, "终端未启动或已到期");
        await rate(db, `terminal-connect:${u.id}`, 20, 60);
      },
    },
    (socket, req) => {
      const iid = (req.params as { id: string }).id;
      const upstream = new WebSocket(config.TERMINAL_WORKER_URL, {
        headers: {
          Authorization: `Bearer ${signTerminalTicket({ instance: iid, user: req.user!.id, session: digest(req.cookies[sessionCookie]!) })}`,
        },
        handshakeTimeout: 10000,
        maxPayload: 65536,
        perMessageDeflate: false,
      });
      peers.add(socket);
      let alive = true;
      socket.on("pong", () => {
        alive = true;
      });
      const timer = setInterval(() => {
        if (!alive) socket.terminate();
        else {
          alive = false;
          socket.ping();
        }
      }, 20000);
      timer.unref();
      socket.on("message", (data, binary) => {
        if (binary) return socket.close(1003, "Text messages required");
        if (upstream.readyState !== WebSocket.OPEN) return;
        if (upstream.bufferedAmount > 65536)
          return socket.close(1008, "Input too fast");
        upstream.send(data, { binary: false });
      });
      upstream.on("open", () => {
        if (socket.readyState !== WebSocket.OPEN) upstream.close();
      });
      upstream.on("message", (data, binary) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 1024 * 1024)
          return socket.close(1013, "Output too fast");
        socket.send(data, { binary });
      });
      upstream.on("close", (code) =>
        socket.close(
          code === 1008 ? 1008 : code === 4001 ? 4001 : 1011,
          code === 4001 ? "Connected elsewhere" : "Terminal disconnected",
        ),
      );
      upstream.on("error", () => socket.close(1011, "Terminal unavailable"));
      socket.on("error", () => socket.terminate());
      socket.on("close", () => {
        clearInterval(timer);
        peers.delete(socket);
        upstream.terminate();
      });
    },
  );
  app.addHook("preClose", async () => {
    for (const peer of peers) peer.terminate();
  });
}
