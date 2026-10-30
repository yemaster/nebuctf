import { z } from "zod";
import { fail } from "./security.js";
import type { FastifyInstance } from "fastify";
import { notifyContest } from "./activity-events.js";
import type { DB, Row } from "./db.js";
import { requireUser } from "./auth.js";
import { contestAccess, progressOwnerFor } from "./context.js";
import { id } from "./schemas.js";
import { permissionSQL, visibleChallengeIds } from "./group-permissions.js";

// Only record observed publication changes. Historical release times cannot be
// reconstructed from challenge creation dates, so migration does not invent them.
export async function recordContestReleases(
  db: DB,
  contestId: string,
  challenges: string[],
) {
  if (!challenges.length) return;
  const rows = await db.query(
    "SELECT c.id FROM challenges c JOIN contest_challenges cc ON cc.challenge_id=c.id JOIN contests g ON g.id=cc.contest_id WHERE g.id=$1 AND g.published AND g.ends_at>now() AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND c.published AND c.id=ANY($2::uuid[])",
    [contestId, challenges],
  );
  for (const c of rows) {
    await db.query(
      "UPDATE contest_challenges SET release_announced_at=now() WHERE contest_id=$1 AND challenge_id=$2",
      [contestId, c.id],
    );
    await db.query(
      "INSERT INTO contest_releases(id,contest_id,challenge_id) VALUES($1,$2,$3)",
      [crypto.randomUUID(), contestId, c.id],
    );
    await notifyContest(db, contestId);
  }
}

export const ACTIVITY_PAGE_SIZE = 10;
const historyQuery = z.object({
  kind: z.enum(["all", "solve", "blood", "challenge"]).default("all"),
  cursor: z.string().max(256).optional(),
});
type ActivityOptions = {
  kind?: z.infer<typeof historyQuery>["kind"];
  cursor?: string;
  includeHints?: boolean;
};
function decodeCursor(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  try {
    return z
      .tuple([z.iso.datetime({ offset: true }), id])
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    fail(400, "动态翻页位置无效，请返回最新动态");
    return null;
  }
}
function bloodCount(table: "solves" | "part_solves", outer: string) {
  return `(SELECT count(*)::int FROM (SELECT 1 FROM ${table} prior
    JOIN ranked_registrations br ON br.contest_id=$1 AND 't:'||br.team_id=prior.owner_key
    LEFT JOIN contest_groups bg ON bg.id=br.group_id
    WHERE ${permissionSQL("bg", "prior.challenge_id", "blood")} AND prior.scope=$1::text AND NOT prior.contest_practice
      AND prior.${table === "solves" ? "challenge_id" : "part_id"}=${outer}.${table === "solves" ? "challenge_id" : "part_id"}
      AND (prior.created_at,prior.id)<=(${outer}.created_at,${outer === "v" ? "v.event_id" : outer + ".id"})
    ORDER BY prior.created_at,prior.id LIMIT 4) first_solves)`;
}
export function contestActivityRoutes(app: FastifyInstance, db: DB) {
  for (const history of [false, true])
    app.get(
      `/api/contests/:id/activity${history ? "/history" : ""}`,
      async (req) => {
        const user = requireUser(req),
          scope = id.parse((req.params as any).id);
        const options = history ? historyQuery.parse(req.query) : {};
        const contest = (await contestAccess(db, scope, user, false))!;
        await progressOwnerFor(db, scope, user);
        return readContestActivity(
          db,
          scope,
          contest,
          await visibleChallengeIds(db, scope, user),
          {
            ...options,
            includeHints: !history,
          },
        );
      },
    );
}
export async function readContestActivity(
  db: DB,
  scope: string,
  contest: Row,
  visible: string[] | null = null,
  options: ActivityOptions = {},
) {
  const limit = ACTIVITY_PAGE_SIZE;
  const cursor = decodeCursor(options.cursor);
  const now = Date.now();
  if (new Date(contest.starts_at).getTime() > now)
    return { items: [], frozen: false, has_more: false, next_cursor: null };
  const end = new Date(Math.min(now, new Date(contest.ends_at).getTime()));
  const frozen =
    !!contest.freeze_at &&
    new Date(contest.freeze_at).getTime() <= now &&
    new Date(contest.ends_at).getTime() > now;
  const cutoff = frozen ? contest.freeze_at : end;
  const rows = await db.query(
    `WITH recent AS (
        (SELECT s.id event_id,'solve'::text type,s.challenge_id,NULL::uuid part_id,s.owner_key,s.created_at
         FROM solves s JOIN challenges c ON c.id=s.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=$1
         JOIN ranked_registrations reg ON reg.contest_id=$1 AND 't:'||reg.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=reg.group_id
         WHERE $7 IN ('all','solve','blood') AND s.scope=$1::text AND NOT s.contest_practice AND ($5::uuid[] IS NULL OR c.id=ANY($5::uuid[])) AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND s.created_at<=$2 AND NOT EXISTS(SELECT 1 FROM challenge_parts p WHERE p.challenge_id=c.id)
           AND ($8::timestamptz IS NULL OR (s.created_at,s.id)<($8,$9::uuid))
           AND ($7<>'blood' OR (${permissionSQL("g", "s.challenge_id", "blood")} AND ${bloodCount("solves", "s")}<=3))
         ORDER BY s.created_at DESC,s.id DESC LIMIT $6)
        UNION ALL
        (SELECT s.id,'solve',s.challenge_id,s.part_id,s.owner_key,s.created_at
         FROM part_solves s JOIN challenges c ON c.id=s.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=$1
         JOIN ranked_registrations reg ON reg.contest_id=$1 AND 't:'||reg.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=reg.group_id
         WHERE $7 IN ('all','solve','blood') AND s.scope=$1::text AND NOT s.contest_practice AND ($5::uuid[] IS NULL OR c.id=ANY($5::uuid[])) AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND s.created_at<=$2
           AND ($8::timestamptz IS NULL OR (s.created_at,s.id)<($8,$9::uuid))
           AND ($7<>'blood' OR (${permissionSQL("g", "s.challenge_id", "blood")} AND ${bloodCount("part_solves", "s")}<=3))
         ORDER BY s.created_at DESC,s.id DESC LIMIT $6)
        UNION ALL
        (SELECT r.id,'release',r.challenge_id,NULL::uuid,NULL::text,GREATEST(r.created_at,$3::timestamptz)
         FROM contest_releases r JOIN challenges c ON c.id=r.challenge_id JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id=r.contest_id
         WHERE $7 IN ('all','challenge') AND r.contest_id=$1 AND ($5::uuid[] IS NULL OR c.id=ANY($5::uuid[])) AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND GREATEST(r.created_at,$3::timestamptz)<=$4
           AND ($8::timestamptz IS NULL OR (GREATEST(r.created_at,$3::timestamptz),r.id)<($8,$9::uuid))
         ORDER BY GREATEST(r.created_at,$3::timestamptz) DESC,r.id DESC LIMIT $6)
        UNION ALL
        (SELECT n.id,n.type,n.challenge_id,NULL::uuid,NULL::text,n.created_at FROM contest_notices n JOIN contest_challenges cc ON cc.challenge_id=n.challenge_id AND cc.contest_id=n.contest_id JOIN challenges c ON c.id=n.challenge_id
         WHERE $7 IN ('all','challenge') AND n.contest_id=$1 AND ($5::uuid[] IS NULL OR c.id=ANY($5::uuid[])) AND n.created_at<=$4 AND (n.type='withdraw' OR (cc.published AND c.published AND (cc.release_at IS NULL OR cc.release_at<=now())))
           AND ($8::timestamptz IS NULL OR (n.created_at,n.id)<($8,$9::uuid))
         ORDER BY n.created_at DESC,n.id DESC LIMIT $6)
      ), visible AS (
        SELECT r.*,c.title challenge_title,p.title part_title,t.id team_id,t.name team_name,${permissionSQL("g", "r.challenge_id", "blood")} get_blood
        FROM recent r JOIN challenges c ON c.id=r.challenge_id LEFT JOIN challenge_parts p ON p.id=r.part_id
        LEFT JOIN teams t ON r.owner_key='t:'||t.id LEFT JOIN ranked_registrations reg ON reg.team_id=t.id AND reg.contest_id=$1 LEFT JOIN contest_groups g ON g.id=reg.group_id
        ORDER BY r.created_at DESC,r.event_id DESC LIMIT $6
      ) SELECT v.*,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time,
        CASE WHEN type<>'solve' OR NOT get_blood THEN NULL WHEN part_id IS NULL THEN ${bloodCount("solves", "v")}
        ELSE ${bloodCount("part_solves", "v")} END blood_rank
        FROM visible v ORDER BY created_at DESC,event_id DESC`,
    [
      scope,
      cutoff,
      contest.starts_at,
      end,
      visible,
      limit + 1,
      options.kind ?? "all",
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
    ],
  );
  const page = rows.slice(0, limit),
    last = page.at(-1),
    hasMore = rows.length > limit;
  return {
    items: page.map(
      ({
        event_id,
        owner_key: _owner,
        get_blood: _blood,
        cursor_time: _cursor,
        blood_rank,
        ...row
      }) => ({
        ...row,
        id: event_id,
        blood_rank: blood_rank >= 1 && blood_rank <= 3 ? blood_rank : null,
      }),
    ),
    frozen,
    has_more: hasMore,
    next_cursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify([last.cursor_time, last.event_id]),
          ).toString("base64url")
        : null,
    ...(options.includeHints === false
      ? {}
      : {
          hint_updates: await db.query(
            "SELECT DISTINCT ON(n.challenge_id) n.id,n.challenge_id,c.title challenge_title,n.created_at FROM contest_notices n JOIN contest_challenges cc ON cc.challenge_id=n.challenge_id AND cc.contest_id=n.contest_id JOIN challenges c ON c.id=n.challenge_id WHERE n.contest_id=$1 AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[])) AND n.type='hint' AND n.created_at<=$2 AND cc.published AND c.published AND (cc.release_at IS NULL OR cc.release_at<=now()) ORDER BY n.challenge_id,n.created_at DESC,n.id DESC",
            [scope, end, visible],
          ),
        }),
  };
}
