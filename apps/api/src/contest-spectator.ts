import { contestVisibilitySQL } from "./contest-entry.js";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DB, Row } from "./db.js";
import { contestAccess, type User } from "./context.js";
import { ACTIVITY_PAGE_SIZE, readContestActivity } from "./contest-activity.js";
import { visibleChallengeIds } from "./group-permissions.js";
import { readScoreboard } from "./scoreboard.js";
import { contestCutoff } from "./contest-practice.js";
import { readContestClock } from "./contest-clock.js";
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

// An attack broadcast means recent, observed submissions, never inferred traffic
// or a fabricated team. Limit the source scan and exclude frozen/practice data.
export async function readSpectatorEngagements(
  db: DB,
  contest: Row,
  visible: string[] | null,
  now = Date.now(),
) {
  if (
    new Date(contest.starts_at).getTime() > now ||
    new Date(contest.ends_at).getTime() <= now ||
    (contest.freeze_at && new Date(contest.freeze_at).getTime() <= now)
  )
    return [];
  return db.query(
    `WITH submissions_recent AS (
    SELECT s.challenge_id,s.owner_key,s.created_at FROM submissions s
    WHERE s.scope=$1::text AND NOT s.contest_practice AND s.created_at>$2 AND s.created_at<=$3
    ORDER BY s.created_at DESC LIMIT 1000
  ), attacks_recent AS (
    SELECT r.challenge_id,a.attacker_key owner_key,a.created_at
    FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN contest_rounds r ON r.id=f.round_id
    JOIN ranked_registrations defender ON defender.contest_id=r.contest_id AND 't:'||defender.team_id=f.owner_key
    WHERE r.contest_id=$1::uuid AND a.created_at>$2 AND a.created_at<=$3
    ORDER BY a.created_at DESC LIMIT 1000
  ), recent AS (SELECT * FROM submissions_recent UNION ALL SELECT * FROM attacks_recent), eligible AS (
    SELECT s.challenge_id,c.title challenge_title,t.id team_id,t.name team_name,max(s.created_at) last_seen
    FROM recent s JOIN challenges c ON c.id=s.challenge_id
    JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=$1::uuid
    JOIN ranked_registrations r ON r.contest_id=$1::uuid AND 't:'||r.team_id=s.owner_key JOIN teams t ON t.id=r.team_id
    WHERE c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$3)
      AND c.challenge_type<>'objective' AND ($4::uuid[] IS NULL OR c.id=ANY($4::uuid[]))
      AND NOT EXISTS(SELECT 1 FROM solves solved WHERE solved.scope=$1::text AND solved.challenge_id=c.id AND solved.owner_key=s.owner_key AND NOT solved.contest_practice)
    GROUP BY s.challenge_id,c.title,t.id,t.name
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY challenge_id ORDER BY last_seen DESC,team_id) n FROM eligible)
  SELECT challenge_id,challenge_title,max(last_seen) last_seen,
    json_agg(json_build_object('id',team_id,'name',team_name,'last_seen',last_seen) ORDER BY last_seen DESC,team_id) teams
  FROM ranked WHERE n<=3 GROUP BY challenge_id,challenge_title ORDER BY max(last_seen) DESC,challenge_id LIMIT 12`,
    [contest.id, new Date(now - 90000), new Date(now), visible],
  );
}

// Deliberately independent from the privileged monitor feed. Even staff see the
// public projection here, so projecting a screen cannot expose private records.
export async function readSpectatorSnapshot(db: DB, contest: Row, user?: User) {
  const scope = contest.id;
  const visible = await visibleChallengeIds(db, scope);
  const board = await readScoreboard(db, { scope, page_size: 100 }, user, {
    spectator: true,
    summary: true,
  });
  const activity = await readContestActivity(db, scope, contest, visible, {
    includeHints: false,
  });
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
     ORDER BY a.created_at DESC,a.id DESC LIMIT $4`,
        [scope, cutoff, visible, ACTIVITY_PAGE_SIZE],
      )
    : [];
  const [stats] = await db.query(
    `SELECT
      (SELECT count(*)::int FROM solves s JOIN challenges c ON c.id=s.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=$1 JOIN ranked_registrations r ON r.contest_id=$1 AND 't:'||r.team_id=s.owner_key WHERE $4::boolean AND s.scope=$1::text AND NOT s.contest_practice AND s.created_at<=$2 AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2) AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[]))) solves,
      (SELECT count(*)::int FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN contest_rounds r ON r.id=f.round_id JOIN challenges c ON c.id=r.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=r.contest_id JOIN ranked_registrations ar ON ar.contest_id=r.contest_id AND 't:'||ar.team_id=a.attacker_key JOIN ranked_registrations vr ON vr.contest_id=r.contest_id AND 't:'||vr.team_id=f.owner_key WHERE $4::boolean AND r.contest_id=$1 AND a.created_at<=$2 AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2) AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[]))) attacks`,
    [scope, cutoff, visible, board.started],
  );
  const complete =
    board.started && board.columns.length
      ? await db.query(
          `SELECT s.challenge_id,count(*)::int solves FROM solves s JOIN ranked_registrations r ON r.contest_id=$1::uuid AND 't:'||r.team_id=s.owner_key
     WHERE s.scope=$1::text AND s.challenge_id=ANY($2::uuid[]) AND s.created_at<=$3 AND NOT s.contest_practice GROUP BY s.challenge_id`,
          [
            scope,
            [...new Set(board.columns.map((c: Row) => c.challenge_id))],
            cutoff,
          ],
        )
      : [];
  const completed = new Map(complete.map((c) => [c.challenge_id, c.solves]));
  const events = ([...activity.items, ...attacks] as Row[])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
        b.id.localeCompare(a.id),
    )
    .slice(0, ACTIVITY_PAGE_SIZE);
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
    clock: await readContestClock(db, contest),
    engagements: await readSpectatorEngagements(db, contest, visible),
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
      points: c.points,
      challenge_solves: completed.get(c.challenge_id) ?? 0,
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
  tokenHash: string;
  ip: string;
  user?: User;
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
        { spectator: true, summary: true },
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
      (n, r) => n + [...r.peers].filter((p) => !ip || p.ip === ip).length,
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
        let authorized: Row[] = [];
        const publicAccess =
          contest.published &&
          contest.spectator_enabled &&
          contest.visibility !== "private";
        if (!publicAccess)
          authorized = await db.query(
            `SELECT s.token_hash,u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
              JOIN contests c ON c.id=$2 WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND NOT u.disabled
              AND (u.role='admin' OR (c.published AND c.spectator_enabled AND ${contestVisibilitySQL("c", "u.id", "false")}))`,
            [[...new Set(peers.map((p) => p.tokenHash))], scope],
          );
        const byToken = new Map(
          authorized.map((user) => [user.token_hash, user]),
        );
        const allowed: Peer[] = [];
        for (const peer of peers) {
          if (!publicAccess) {
            const user = byToken.get(peer.tokenHash);
            if (!user) {
              peer.socket.close(1008, "Spectating unavailable");
              continue;
            }
            peer.user = {
              id: user.id,
              username: user.username,
              email: user.email,
              role: user.role,
            };
          }
          allowed.push(peer);
        }
        if (!allowed.length) break;
        const data = await snapshot(
          contest,
          (allowed.find((p) => p.user?.role === "admin") ?? allowed[0])?.user,
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
      const peer: Peer = {
        socket,
        tokenHash: digest(request.cookies[sessionCookie] ?? ""),
        ip: request.ip,
        user: request.user ?? undefined,
        alive: true,
      };
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
