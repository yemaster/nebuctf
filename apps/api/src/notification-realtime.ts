import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DB } from "./db.js";
import { requireUser, sessionCookie } from "./auth.js";
import { config } from "./config.js";
import { digest, fail, rate } from "./security.js";
import { inboxSummary } from "./notifications.js";

type Peer = {
  socket: WebSocket;
  token: string;
  user: string;
  signature?: string;
  alive: boolean;
};
export function notificationRealtimeRoutes(app: FastifyInstance, db: DB) {
  const peers = new Set<Peer>();
  let pending = false,
    dirty = false,
    closing = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;
  async function publish() {
    if (closing || !peers.size) return;
    dirty = true;
    if (pending) return;
    pending = true;
    try {
      do {
        dirty = false;
        const snapshot = [...peers];
        const sessions = await db.query(
          `SELECT s.token_hash,u.id FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled`,
          [[...new Set(snapshot.map((p) => p.token))]],
        );
        const valid = new Map(sessions.map((s) => [s.token_hash, s.id]));
        const summaries = new Map(
          (await inboxSummary(db, [...new Set(sessions.map((s) => s.id))])).map(
            (s) => [s.user_id, s],
          ),
        );
        for (const p of snapshot) {
          if (valid.get(p.token) !== p.user) {
            p.socket.close(1008, "Authentication expired");
            continue;
          }
          const summary = summaries.get(p.user);
          const message = JSON.stringify({
            type: "notifications",
            unread: summary!.unread,
            revision: summary!.revision,
          });
          if (p.signature === message || p.socket.readyState !== 1) continue;
          if (p.socket.bufferedAmount > 65536) {
            p.socket.close(1013, "Connection too slow");
            continue;
          }
          p.signature = message;
          p.socket.send(message, (error) => {
            if (error) p.socket.terminate();
          });
        }
      } while (dirty && !closing && peers.size);
    } catch (error) {
      app.log.error(error, "notification broadcast failed");
    } finally {
      pending = false;
    }
  }
  function schedule() {
    if (scheduled || closing || !peers.size) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      void publish();
    }, 50);
    scheduled.unref();
  }
  app.get(
    "/api/notifications/live",
    {
      websocket: true,
      preValidation: async (req) => {
        if (req.headers.origin !== config.APP_ORIGIN)
          fail(403, "请求来源验证失败");
        const user = requireUser(req);
        await rate(db, `inbox-connect:${user.id}`, 20, 60);
        if ([...peers].filter((p) => p.user === user.id).length >= 4)
          fail(429, "消息连接数量已达上限");
      },
    },
    (socket, req) => {
      const peer: Peer = {
        socket,
        token: digest(req.cookies[sessionCookie]!),
        user: req.user!.id,
        alive: true,
      };
      if ([...peers].filter((p) => p.user === peer.user).length >= 4) {
        socket.close(1013, "Too many connections");
        return;
      }
      peers.add(peer);
      socket.on("close", () => peers.delete(peer));
      socket.on("error", () => socket.terminate());
      socket.on("message", () => socket.close(1008, "Read-only channel"));
      socket.on("pong", () => {
        peer.alive = true;
      });
      schedule();
    },
  );
  const poll = setInterval(schedule, db.subscribe ? 15000 : 1000);
  const heartbeat = setInterval(() => {
    for (const p of peers) {
      if (!p.alive) p.socket.terminate();
      else {
        p.alive = false;
        p.socket.ping();
      }
    }
  }, 30000);
  poll.unref();
  heartbeat.unref();
  app.addHook("onReady", async () => {
    unsubscribe = await db.subscribe?.((scope) => {
      if (scope === "inbox") schedule();
    });
  });
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    clearTimeout(scheduled);
    for (const p of peers) p.socket.terminate();
    peers.clear();
    await unsubscribe?.();
  });
}
