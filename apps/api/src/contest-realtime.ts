import { monitorRevision } from "./contest-monitor.js";
import { visibleChallengeIds } from "./group-permissions.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { DB } from "./db.js";
import { requireUser, requireAdmin, sessionCookie } from "./auth.js";
import { contestAccess, progressOwnerFor } from "./context.js";
import { readContestActivity } from "./contest-activity.js";
import { config } from "./config.js";
import { id } from "./schemas.js";
import { digest, fail, rate } from "./security.js";
type Peer = {
  socket: WebSocket;
  request: FastifyRequest;
  alive: boolean;
  checked: number;
};
type Room = {
  scope: string;
  admin: boolean;
  peers: Set<Peer>;
  pending: boolean;
  dirty: boolean;
  force: boolean;
  signatures: Map<string, string>;
};
export function contestRealtimeRoutes(app: FastifyInstance, db: DB) {
  const rooms = new Map<string, Room>();
  let unsubscribe: (() => Promise<void>) | undefined,
    closing = false;
  async function authorize(
    req: FastifyRequest,
    scope: string,
    refresh = false,
  ) {
    if (refresh) {
      const [user] = await db.query(
        "SELECT u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled",
        [digest(req.cookies[sessionCookie] ?? "")],
      );
      req.user = (user as typeof req.user) ?? null;
    }
    const user = requireUser(req),
      contest = (await contestAccess(db, scope, user, false))!;
    await progressOwnerFor(db, scope, user);
    return contest;
  }
  function send(peer: Peer, data: string) {
    if (peer.socket.readyState !== 1) return;
    if (peer.socket.bufferedAmount > 256 * 1024) {
      peer.socket.close(1013, "Connection too slow");
      return;
    }
    peer.socket.send(data, (error) => {
      if (error) peer.socket.terminate();
    });
  }
  async function publish(scope: string, force = false) {
    const room = rooms.get(scope);
    if (!room || closing) return;
    scope = room.scope;
    room.dirty = true;
    room.force ||= force;
    if (room.pending) return;
    room.pending = true;
    try {
      do {
        room.dirty = false;
        const forced = room.force;
        room.force = false;
        const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
          scope,
        ]);
        if (!contest) {
          for (const p of room.peers)
            p.socket.close(1008, "Contest unavailable");
          return;
        }
        // Re-check permissions before every publication. A disabled account or revoked session is not a subscriber.
        // A peer joining while this query runs belongs to the next publication;
        // it must not be rejected using a snapshot that did not include it.
        const peers = [...room.peers];
        const valid = await db.query(
          `SELECT s.token_hash,u.id,u.role,reg.group_id,reg.team_id,reg.status,reg.permissions,reg.challenge_permissions FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN LATERAL (SELECT r.group_id,r.team_id,r.status,g.permissions,g.challenge_permissions FROM memberships m JOIN registrations r ON r.team_id=m.team_id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE m.user_id=u.id AND r.contest_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1) reg ON true WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled AND (($4::boolean AND u.role='admin') OR (NOT $4::boolean AND ((u.role='admin' AND reg.team_id IS NULL) OR ((u.role='admin' OR $3::boolean) AND reg.status='accepted'))))`,
          [
            peers.map((p) => digest(p.request.cookies[sessionCookie] ?? "")),
            scope,
            contest.published,
            room.admin,
          ],
        );
        for (const peer of peers)
          if (
            !valid.some(
              (v) =>
                v.token_hash ===
                digest(peer.request.cookies[sessionCookie] ?? ""),
            )
          )
            peer.socket.close(1008, "Authentication expired");
        if (room.admin) {
          const revision = await monitorRevision(db, scope);
          const signature = JSON.stringify(revision);
          if (forced || room.signatures.get("admin") !== signature) {
            room.signatures.set("admin", signature);
            for (const peer of peers)
              if (
                valid.some(
                  (u) =>
                    u.token_hash ===
                    digest(peer.request.cookies[sessionCookie] ?? ""),
                )
              )
                send(peer, JSON.stringify({ type: "monitor", data: revision }));
          }
          continue;
        }
        // Private team revisions invalidate patch results without broadcasting patch contents or results to other teams.
        const owners = [
          ...new Set(
            valid.filter((u) => u.team_id).map((u) => `t:${u.team_id}`),
          ),
        ];
        if (owners.length) {
          const revisions = await db.query(
            "SELECT k.owner_key,j.id,j.updated_at::text FROM unnest($2::text[]) k(owner_key) JOIN LATERAL(SELECT id,updated_at FROM judge_jobs WHERE scope=$1 AND owner_key=k.owner_key ORDER BY updated_at DESC,id DESC LIMIT 1) j ON true",
            [scope, owners],
          );
          for (const revision of revisions) {
            const key = `judges:${revision.owner_key}`,
              signature = digest(JSON.stringify(revision));
            if (forced || room.signatures.get(key) !== signature) {
              room.signatures.set(key, signature);
              for (const peer of peers)
                if (
                  valid.some(
                    (u) =>
                      `t:${u.team_id}` === revision.owner_key &&
                      u.token_hash ===
                        digest(peer.request.cookies[sessionCookie] ?? ""),
                  )
                )
                  send(
                    peer,
                    JSON.stringify({ type: "judges", revision: signature }),
                  );
            }
          }
        }
        const audiences = new Map<string, typeof valid>();
        for (const user of valid) {
          const key = user.team_id
            ? `group:${user.group_id ?? "default"}`
            : "preview";
          audiences.set(key, [...(audiences.get(key) ?? []), user]);
        }
        for (const [key, users] of audiences) {
          const user = users[0]!;
          const visible = await visibleChallengeIds(db, scope, {
            id: user.id,
            role: user.role,
          });
          const payload = await readContestActivity(
            db,
            scope,
            contest,
            visible,
          );
          const scoped = {
            ...payload,
            permissions_version: digest(
              JSON.stringify([
                user.group_id ?? null,
                user.permissions ?? {},
                user.challenge_permissions ?? {},
              ]),
            ),
          };
          const signature = JSON.stringify(scoped);
          if (forced || room.signatures.get(key) !== signature) {
            room.signatures.set(key, signature);
            const message = JSON.stringify({ type: "activity", data: scoped });
            for (const peer of peers)
              if (
                users.some(
                  (u) =>
                    u.token_hash ===
                    digest(peer.request.cookies[sessionCookie] ?? ""),
                )
              )
                send(peer, message);
          }
        }
      } while (room.dirty && room.peers.size && !closing);
    } catch {
      for (const p of room.peers) send(p, JSON.stringify({ type: "retry" }));
    } finally {
      room.pending = false;
    }
  }
  for (const admin of [false, true])
    app.get(
      admin
        ? "/api/admin/contests/:id/activity/ws"
        : "/api/contests/:id/activity/ws",
      {
        websocket: true,
        preValidation: async (req) => {
          if (req.headers.origin !== config.APP_ORIGIN)
            fail(403, "请求来源验证失败");
          const scope = id.parse((req.params as any).id),
            user = requireUser(req);
          await rate(db, `activity-connect:${user.id}`, 20, 60);
          if (admin) {
            requireAdmin(req);
            await contestAccess(db, scope, user, false);
          } else await authorize(req, scope);
          const userCount = [...rooms.values()].reduce(
            (n, r) =>
              n +
              [...r.peers].filter((p) => p.request.user?.id === user.id).length,
            0,
          );
          if (userCount >= 4) fail(429, "已达到动态连接数量上限");
        },
      },
      (socket, request) => {
        const scope = (request.params as any).id as string;
        if (closing) {
          socket.close(1012, "Restarting");
          return;
        }
        const key = admin ? `${scope}:admin` : scope;
        const room = rooms.get(key) ?? {
          scope,
          admin,
          peers: new Set<Peer>(),
          pending: false,
          dirty: false,
          force: false,
          signatures: new Map<string, string>(),
        };
        rooms.set(key, room);
        const peer: Peer = {
          socket,
          request,
          alive: true,
          checked: Date.now(),
        };
        if (
          [...rooms.values()].reduce(
            (n, r) =>
              n +
              [...r.peers].filter(
                (p) => p.request.user?.id === request.user?.id,
              ).length,
            0,
          ) >= 4
        ) {
          socket.close(1013, "Too many connections");
          return;
        }
        room.peers.add(peer);
        socket.on("pong", () => {
          peer.alive = true;
        });
        socket.on("error", () => socket.terminate());
        socket.on("message", () => socket.close(1008, "Read-only channel"));
        socket.on("close", () => {
          room.peers.delete(peer);
          if (!room.peers.size) rooms.delete(key);
        });
        void publish(key, true);
      },
    );
  app.addHook("onReady", async () => {
    unsubscribe = await db.subscribe?.((scope) => {
      if (id.safeParse(scope).success) {
        void publish(scope);
        void publish(`${scope}:admin`);
      }
    });
  });
  // Time boundaries and reconnect recovery need a small periodic refresh, shared per contest.
  const refresh = setInterval(
    () => {
      for (const scope of rooms.keys()) void publish(scope);
    },
    db.subscribe ? 5000 : 1000,
  );
  refresh.unref();
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const peer of room.peers) {
        if (!peer.alive) {
          peer.socket.terminate();
          continue;
        }
        peer.alive = false;
        peer.socket.ping();
      }
  }, 20000);
  heartbeat.unref();
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(refresh);
    clearInterval(heartbeat);
    for (const r of rooms.values())
      for (const p of r.peers) p.socket.terminate();
    rooms.clear();
    await unsubscribe?.();
  });
}
