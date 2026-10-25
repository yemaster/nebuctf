import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { DB, Row } from "./db.js";
import { contestAccess, type User } from "./context.js";
import { readContestActivity } from "./contest-activity.js";
import { visibleChallengeIds } from "./group-permissions.js";
import { readScoreboard } from "./scoreboard.js";
import { contestCutoff } from "./contest-practice.js";
import { sessionCookie } from "./auth.js";
import { config } from "./config.js";
import { id, page } from "./schemas.js";
import { digest, fail, rate } from "./security.js";

async function spectatorAccess(db: DB, scope: string, user?: User) {
  const contest = (await contestAccess(db, scope, user, false))!;
  if (!contest.spectator_enabled && user?.role !== "admin")
    fail(403, "本场比赛未开放观战大屏", {
      label: "返回比赛",
      href: `/contests/${scope}`,
    });
  return contest;
}

// Deliberately independent from the privileged monitor feed. Even staff see the
// public projection here, so projecting a screen cannot expose private records.
export async function readSpectatorSnapshot(db: DB, contest: Row, user?: User) {
  const scope = contest.id;
  const visible = await visibleChallengeIds(db, scope);
  const board = await readScoreboard(db, { scope, page_size: 100 }, user, {
    spectator: true,
  });
  const activity = await readContestActivity(db, scope, contest, visible);
  const cutoff = contestCutoff(contest);
  const attacks = board.started
    ? await db.query(
        `SELECT a.id,'attack'::text type,r.challenge_id,c.title challenge_title,NULL::text part_title,
      t.id team_id,t.name team_name,v.id target_team_id,v.name target_team_name,NULL::int blood_rank,a.created_at
     FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN contest_rounds r ON r.id=f.round_id
     JOIN challenges c ON c.id=r.challenge_id JOIN contest_challenges cc ON cc.contest_id=r.contest_id AND cc.challenge_id=c.id
     JOIN ranked_registrations ar ON ar.contest_id=r.contest_id AND 't:'||ar.team_id=a.attacker_key
     JOIN ranked_registrations vr ON vr.contest_id=r.contest_id AND 't:'||vr.team_id=f.owner_key
     JOIN teams t ON t.id=ar.team_id JOIN teams v ON v.id=vr.team_id
     WHERE r.contest_id=$1 AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2)
       AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[])) AND a.created_at<=$2
     ORDER BY a.created_at DESC,a.id DESC LIMIT 40`,
        [scope, cutoff, visible],
      )
    : [];
  const [stats] = await db.query(
    `SELECT
      (SELECT count(*)::int FROM solves s JOIN challenges c ON c.id=s.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=$1 JOIN ranked_registrations r ON r.contest_id=$1 AND 't:'||r.team_id=s.owner_key WHERE $4::boolean AND s.scope=$1::text AND NOT s.contest_practice AND s.created_at<=$2 AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2) AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[]))) solves,
      (SELECT count(*)::int FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN contest_rounds r ON r.id=f.round_id JOIN challenges c ON c.id=r.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=r.contest_id JOIN ranked_registrations ar ON ar.contest_id=r.contest_id AND 't:'||ar.team_id=a.attacker_key JOIN ranked_registrations vr ON vr.contest_id=r.contest_id AND 't:'||vr.team_id=f.owner_key WHERE $4::boolean AND r.contest_id=$1 AND a.created_at<=$2 AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2) AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[]))) attacks`,
    [scope, cutoff, visible, board.started],
  );
  const events = ([...activity.items, ...attacks] as Row[])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
        b.id.localeCompare(a.id),
    )
    .slice(0, 40);
  return {
    contest: {
      id: scope,
      title: contest.title,
      starts_at: contest.starts_at,
      ends_at: contest.ends_at,
    },
    started: board.started,
    frozen: board.frozen,
    cutoff: board.cutoff,
    stats: {
      teams: board.participants,
      challenges: board.challenge_count,
      solves: stats!.solves,
      attacks: stats!.attacks,
    },
    leaders: board.items.map((t: Row) => ({
      id: t.id,
      name: t.name,
      rank: t.rank,
      score: t.score,
      solves: t.solves,
      group_name: t.group_name,
    })),
    challenges: board.columns.map((c: Row) => ({
      id: c.id,
      challenge_id: c.challenge_id,
      title: c.title,
      part_title: c.part_title,
      category: c.category,
      solves: c.solves,
    })),
    events,
    groups: await db.query(
      "SELECT id,name FROM contest_groups WHERE contest_id=$1 ORDER BY position",
      [scope],
    ),
  };
}

type Peer = {
  socket: WebSocket;
  request: FastifyRequest;
  alive: boolean;
  signature?: string;
};
type Room = {
  peers: Set<Peer>;
  pending: boolean;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
export function contestSpectatorRoutes(app: FastifyInstance, db: DB) {
  const rooms = new Map<string, Room>();
  const snapshots = new Map<
    string,
    { until: number; pending: ReturnType<typeof readSpectatorSnapshot> }
  >();
  const rankings = new Map<
    string,
    {
      until: number;
      pending: Promise<{ total: number; page: number; items: Row[] }>;
    }
  >();
  let closing = false,
    unsubscribe: (() => Promise<void>) | undefined;
  const snapshot = (contest: Row, user?: User) => {
    const old = snapshots.get(contest.id);
    if (old && old.until > Date.now()) return old.pending;
    const pending = readSpectatorSnapshot(db, contest, user);
    snapshots.set(contest.id, { until: Date.now() + 2000, pending });
    void pending.catch(() => {
      if (snapshots.get(contest.id)?.pending === pending)
        snapshots.delete(contest.id);
    });
    if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!);
    return pending;
  };
  app.get("/api/contests/:id/spectate", async (req) => {
    const scope = id.parse((req.params as { id: string }).id);
    const contest = await spectatorAccess(db, scope, req.user ?? undefined);
    return snapshot(contest, req.user ?? undefined);
  });
  app.get("/api/contests/:id/spectate/ranking", async (req) => {
    const scope = id.parse((req.params as { id: string }).id);
    await spectatorAccess(db, scope, req.user ?? undefined);
    const q = page.extend({ group: id.optional() }).parse(req.query);
    const key = `${scope}:${q.group ?? ""}:${q.page}`;
    const cached = rankings.get(key);
    if (cached && cached.until > Date.now()) return cached.pending;
    const pending = (async () => {
      const board = await readScoreboard(
        db,
        { scope, page: q.page, group: q.group, page_size: 10 },
        req.user ?? undefined,
        { spectator: true },
      );
      return {
        total: board.total,
        page: board.page,
        items: board.items.map((t: Row) => ({
          id: t.id,
          name: t.name,
          rank: t.rank,
          score: t.score,
          solves: t.solves,
          group_name: t.group_name,
        })),
      };
    })();
    rankings.set(key, { until: Date.now() + 2000, pending });
    void pending.catch(() => {
      if (rankings.get(key)?.pending === pending) rankings.delete(key);
    });
    if (rankings.size > 128) rankings.delete(rankings.keys().next().value!);
    return pending;
  });
  const count = (ip?: string) =>
    [...rooms.values()].reduce(
      (n, r) =>
        n + [...r.peers].filter((p) => !ip || p.request.ip === ip).length,
      0,
    );
  const send = (peer: Peer, message: string) => {
    if (peer.socket.readyState !== 1) return;
    if (peer.socket.bufferedAmount > 256 * 1024) {
      peer.socket.close(1013, "Connection too slow");
      return;
    }
    peer.socket.send(message, (error) => {
      if (error) peer.socket.terminate();
    });
  };
  async function publish(scope: string) {
    const room = rooms.get(scope);
    if (!room || closing) return;
    room.dirty = true;
    if (room.pending) return;
    room.pending = true;
    try {
      do {
        room.dirty = false;
        const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
          scope,
        ]);
        if (!contest) {
          for (const p of room.peers)
            p.socket.close(1008, "Contest unavailable");
          break;
        }
        // Public availability is checked for every push, including already-open sockets.
        const peers = [...room.peers];
        let staff: Row[] = [];
        if (!contest.published || !contest.spectator_enabled)
          staff = await db.query(
            "SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled AND u.role='admin'",
            [peers.map((p) => digest(p.request.cookies[sessionCookie] ?? ""))],
          );
        const allowed = peers.filter(
          (p) =>
            (contest.published && contest.spectator_enabled) ||
            staff.some(
              (s) =>
                s.token_hash === digest(p.request.cookies[sessionCookie] ?? ""),
            ),
        );
        for (const p of peers)
          if (!allowed.includes(p))
            p.socket.close(1008, "Spectating unavailable");
        if (!allowed.length) break;
        const data = await snapshot(
          contest,
          allowed.find((p) => p.request.user?.role === "admin")?.request.user ??
            undefined,
        );
        const message = JSON.stringify({ type: "spectator", data });
        const signature = digest(message);
        for (const peer of allowed)
          if (signature !== peer.signature) {
            send(peer, message);
            peer.signature = signature;
          }
      } while (room.dirty && room.peers.size && !closing);
    } catch {
      for (const p of room.peers) send(p, JSON.stringify({ type: "retry" }));
    } finally {
      room.pending = false;
    }
  }
  const schedule = (scope: string) => {
    snapshots.delete(scope);
    for (const key of rankings.keys())
      if (key.startsWith(`${scope}:`)) rankings.delete(key);
    const room = rooms.get(scope);
    if (!room || room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = undefined;
      void publish(scope);
    }, 250);
    room.timer.unref();
  };
  app.get(
    "/api/contests/:id/spectate/ws",
    {
      websocket: true,
      preValidation: async (req) => {
        if (req.headers.origin !== config.APP_ORIGIN)
          fail(403, "请求来源验证失败");
        await rate(db, `spectator-connect:${req.ip}`, 30, 60);
        await spectatorAccess(
          db,
          id.parse((req.params as { id: string }).id),
          req.user ?? undefined,
        );
        if (count(req.ip) >= 8 || count() >= 512)
          fail(429, "观战连接数量已达上限");
      },
    },
    (socket, request) => {
      if (closing || count(request.ip) >= 8 || count() >= 512) {
        socket.close(1013, "Try again later");
        return;
      }
      const scope = (request.params as { id: string }).id;
      const room: Room = rooms.get(scope) ?? {
        peers: new Set(),
        pending: false,
        dirty: false,
      };
      rooms.set(scope, room);
      const peer: Peer = { socket, request, alive: true };
      room.peers.add(peer);
      socket.on("pong", () => {
        peer.alive = true;
      });
      socket.on("error", () => socket.terminate());
      socket.on("message", () => socket.close(1008, "Read-only channel"));
      socket.on("close", () => {
        room.peers.delete(peer);
        if (!room.peers.size) {
          if (room.timer) clearTimeout(room.timer);
          rooms.delete(scope);
        }
      });
      void publish(scope);
    },
  );
  app.addHook("onReady", async () => {
    unsubscribe = await db.subscribe?.(schedule);
  });
  const refresh = setInterval(
    () => {
      for (const scope of rooms.keys()) schedule(scope);
    },
    db.subscribe ? 5000 : 1000,
  );
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const p of room.peers) {
        if (!p.alive) p.socket.terminate();
        else {
          p.alive = false;
          p.socket.ping();
        }
      }
  }, 20000);
  refresh.unref();
  heartbeat.unref();
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(refresh);
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      for (const p of room.peers) p.socket.terminate();
    }
    rooms.clear();
    snapshots.clear();
    rankings.clear();
    await unsubscribe?.();
  });
}
