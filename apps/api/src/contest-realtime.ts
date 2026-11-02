import { can } from "./access-control.js";
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
  tokenHash: string;
  userId: string;
  alive: boolean;
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
  async function authorize(req: FastifyRequest, scope: string) {
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
          `SELECT s.token_hash,u.id,u.role,u.access_profile access,reg.group_id,reg.team_id,reg.status,reg.permissions,reg.challenge_permissions FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN LATERAL (SELECT r.group_id,r.team_id,r.status,g.permissions,g.challenge_permissions FROM memberships m JOIN registrations r ON r.team_id=m.team_id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE m.user_id=u.id AND r.contest_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1) reg ON true WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled `,
          [[...new Set(peers.map((p) => p.tokenHash))], scope],
        );
        const byToken = new Map(
          valid
            .filter((user) =>
              room.admin
                ? can(user as any, "contests.read", scope)
                : (can(user as any, "contests.read", scope) && !user.team_id) ||
                  ((can(user as any, "contests.read", scope) ||
                    contest.published) &&
                    user.status === "accepted"),
            )
            .map((user) => [user.token_hash, user]),
        );
        const allowed: Peer[] = [];
        const ownerPeers = new Map<string, Peer[]>();
        const audiences = new Map<
          string,
          { user: (typeof valid)[number]; peers: Peer[] }
        >();
        for (const peer of peers) {
          const user = byToken.get(peer.tokenHash);
          if (!user) {
            peer.socket.close(1008, "Authentication expired");
            continue;
          }
          allowed.push(peer);
          if (room.admin) continue;
          if (user.team_id) {
            const owner = `t:${user.team_id}`;
            const recipients = ownerPeers.get(owner);
            if (recipients) recipients.push(peer);
            else ownerPeers.set(owner, [peer]);
          }
          const key = user.team_id
            ? `group:${user.group_id ?? "default"}`
            : "preview";
          const audience = audiences.get(key);
          if (audience) audience.peers.push(peer);
          else audiences.set(key, { user, peers: [peer] });
        }
        // Retain only compact revisions for audiences that are still connected.
        for (const key of room.signatures.keys()) {
          if (key === "admin" && room.admin) continue;
          if (
            key.startsWith("judges:")
              ? ownerPeers.has(key.slice(7))
              : audiences.has(key)
          )
            continue;
          room.signatures.delete(key);
        }
        if (room.admin) {
          const revision = await monitorRevision(db, scope);
          const message = JSON.stringify({ type: "monitor", data: revision });
          const signature = digest(message);
          if (forced || room.signatures.get("admin") !== signature) {
            room.signatures.set("admin", signature);
            for (const peer of allowed) send(peer, message);
          }
          continue;
        }
        // Private team revisions invalidate patch results without broadcasting patch contents or results to other teams.
        const owners = [...ownerPeers.keys()];
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
              const message = JSON.stringify({
                type: "judges",
                revision: signature,
              });
              for (const peer of ownerPeers.get(revision.owner_key) ?? [])
                send(peer, message);
            }
          }
        }
        for (const [key, { user, peers: recipients }] of audiences) {
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
          const signature = digest(JSON.stringify(scoped));
          if (forced || room.signatures.get(key) !== signature) {
            room.signatures.set(key, signature);
            const message = JSON.stringify({ type: "activity", data: scoped });
            for (const peer of recipients) send(peer, message);
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
              n + [...r.peers].filter((p) => p.userId === user.id).length,
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
          tokenHash: digest(request.cookies[sessionCookie] ?? ""),
          userId: request.user!.id,
          alive: true,
        };
        if (
          [...rooms.values()].reduce(
            (n, r) =>
              n +
              [...r.peers].filter((p) => p.userId === request.user?.id).length,
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
