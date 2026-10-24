import { permissionSQL, visibleChallengeIds } from "./group-permissions.js";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "./db.js";
import { contestAccess } from "./context.js";
import { id, page } from "./schemas.js";
import { fail } from "./security.js";

const query = page.extend({
  group: id.optional(),
  participant: id.optional(),
  page_size: z.coerce.number().int().min(10).max(100).default(30),
});

export function scoreboardRoutes(app: FastifyInstance, db: DB) {
  const read = async (req: FastifyRequest, detail = false) => {
    const p = query.parse(
      detail
        ? {
            ...(req.query as object),
            participant: id.parse(
              (req.params as { participant: string }).participant,
            ),
            page: 1,
            q: "",
          }
        : req.query,
    );
    const contest = await contestAccess(
      db,
      p.scope,
      req.user ?? undefined,
      false,
    );
    const now = Date.now();
    const started = !contest || new Date(contest.starts_at).getTime() <= now;
    const frozen =
      !!contest?.freeze_at &&
      new Date(contest.freeze_at).getTime() <= now &&
      new Date(contest.ends_at).getTime() > now;
    const cutoff = new Date(
      frozen ? new Date(contest!.freeze_at).getTime() : now,
    ).toISOString();
    if (
      p.group &&
      !(
        await db.query(
          "SELECT 1 FROM contest_groups WHERE id=$1 AND contest_id::text=$2",
          [p.group, p.scope],
        )
      ).length
    )
      fail(400, "组别不存在");
    // One statement gives totals, cells and timelines the same MVCC snapshot.
    // Score units are flags: legacy whole-challenge solves and multi-part solves
    // are mutually exclusive, so finishing a multi-part challenge never doubles its score.
    const [result] = await db.query(
      `WITH eligible AS (
      SELECT c.*,coalesce(cc.scoring,'{"mode":"inherit"}'::jsonb) scoring
      FROM challenges c LEFT JOIN contest_challenges cc ON cc.challenge_id=c.id AND cc.contest_id::text=$1
      WHERE c.published AND $7::boolean
      AND (($1='practice' AND c.practice) OR (cc.contest_id IS NOT NULL AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=$2)))
    ), raw_units AS (
      SELECT c.id unit_id,c.id challenge_id,c.title,c.category,NULL::text part_title,0 position,c.created_at,c.initial_points,c.minimum_points,c.decay,c.dynamic_score,c.scoring,c.scoring->'points' override
      FROM eligible c WHERE NOT EXISTS(SELECT 1 FROM challenge_parts p WHERE p.challenge_id=c.id)
      UNION ALL
      SELECT p.id,c.id,c.title,c.category,p.title,p.position,c.created_at,p.initial_points,p.minimum_points,c.decay,c.dynamic_score,c.scoring,
      (SELECT o->'points' FROM jsonb_array_elements(coalesce(c.scoring->'parts','[]'::jsonb)) o WHERE o->>'id'=p.id::text)
      FROM eligible c JOIN challenge_parts p ON p.challenge_id=c.id
    ), units AS (
      SELECT u.unit_id,u.challenge_id,u.title,u.category,u.part_title,u.position,u.created_at,
        CASE WHEN scoring->>'mode'='inherit' THEN initial_points ELSE coalesce((override->>'initial_points')::int,initial_points) END initial_points,
        CASE WHEN scoring->>'mode'='inherit' THEN minimum_points ELSE coalesce((override->>'minimum_points')::int,minimum_points) END minimum_points,
        CASE WHEN scoring->>'mode'='inherit' THEN decay ELSE coalesce((override->>'decay')::int,decay) END decay,
        CASE WHEN scoring->>'mode'='inherit' THEN dynamic_score ELSE scoring->>'mode'='dynamic' END dynamic_score,
        scoring->>'mode' mode FROM raw_units u
    ), events AS (
      SELECT s.id,s.owner_key,s.challenge_id unit_id,s.created_at,s.user_id,${permissionSQL("g", "s.challenge_id", "score")} get_score,${permissionSQL("g", "s.challenge_id", "blood")} get_blood,${permissionSQL("g", "s.challenge_id", "dynamic")} affect_dynamic FROM solves s JOIN units u ON u.unit_id=s.challenge_id AND u.mode<>'round' LEFT JOIN accepted_registrations r ON r.contest_id::text=$1 AND 't:'||r.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=r.group_id
      WHERE s.scope=$1 AND s.created_at<=$2 AND ($1='practice' OR r.team_id IS NOT NULL)
      UNION ALL
      SELECT s.id,s.owner_key,s.part_id,s.created_at,s.user_id,${permissionSQL("g", "s.challenge_id", "score")},${permissionSQL("g", "s.challenge_id", "blood")},${permissionSQL("g", "s.challenge_id", "dynamic")} FROM part_solves s JOIN units u ON u.unit_id=s.part_id AND u.mode<>'round' LEFT JOIN accepted_registrations r ON r.contest_id::text=$1 AND 't:'||r.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=r.group_id WHERE s.scope=$1 AND s.created_at<=$2 AND ($1='practice' OR r.team_id IS NOT NULL)
    ), counts AS (
      SELECT unit_id,count(*) FILTER(WHERE affect_dynamic)::numeric n FROM events GROUP BY unit_id
    ), unit_scores AS (
      SELECT u.*,coalesce(n,0)::int solve_count,
      CASE WHEN u.dynamic_score THEN GREATEST(u.minimum_points,ceil(u.initial_points+(u.minimum_points-u.initial_points)*power(coalesce(n,0)/u.decay,2)))::int ELSE u.initial_points END points
      FROM units u LEFT JOIN counts c ON c.unit_id=u.unit_id
    ), scored AS (
      SELECT e.*,CASE WHEN e.get_score THEN u.points ELSE 0 END points,CASE WHEN e.get_blood THEN count(*) FILTER(WHERE e.get_blood) OVER(PARTITION BY e.unit_id ORDER BY e.created_at,e.id)::int END blood_rank,NULL::int round_number,NULL::jsonb round_details
      FROM events e JOIN unit_scores u ON u.unit_id=e.unit_id
      UNION ALL
      SELECT r.id,r.owner_key,r.unit_id,r.created_at,r.user_id,true,false,false,r.points,NULL::int,g.number,r.details FROM round_results r JOIN contest_rounds g ON g.id=r.round_id JOIN units u ON u.unit_id=r.unit_id AND u.mode='round' WHERE g.contest_id::text=$1 AND g.status='settled' AND r.created_at<=$2
    ), totals AS (
      SELECT owner_key,sum(points)::int score,count(DISTINCT unit_id) FILTER(WHERE points>0)::int flags,max(created_at) FILTER(WHERE points>0) last_solve FROM scored GROUP BY owner_key
    ), completed AS (
      SELECT s.owner_key,count(*)::int solves FROM solves s JOIN eligible c ON c.id=s.challenge_id WHERE s.scope=$1 AND s.created_at<=$2 GROUP BY s.owner_key
    ), participants AS (
      SELECT u.id,'u:'||u.id owner_key,u.username name,NULL::uuid group_id,NULL::text group_name,true rank_overall FROM users u WHERE $1='practice' AND NOT u.disabled
      UNION ALL
      SELECT t.id,'t:'||t.id,t.name,r.group_id,g.name,coalesce((g.permissions->>'rank_overall')::boolean,true) FROM teams t JOIN accepted_registrations r ON r.team_id=t.id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id::text=$1
    ), ranked AS (
      SELECT CASE WHEN p.rank_overall THEN count(*) FILTER(WHERE p.rank_overall) OVER(ORDER BY coalesce(t.score,0) DESC,t.last_solve ASC NULLS LAST,p.name,p.id)::int END overall_rank,
        p.*,coalesce(t.score,0) score,coalesce(c.solves,0) solves,coalesce(t.flags,0) flags,t.last_solve
      FROM participants p LEFT JOIN totals t ON t.owner_key=p.owner_key LEFT JOIN completed c ON c.owner_key=p.owner_key
    ), group_ranks AS (
      SELECT r.*,CASE WHEN group_id IS NOT NULL THEN row_number() OVER(PARTITION BY group_id ORDER BY score DESC,last_solve ASC NULLS LAST,name,id)::int ELSE NULL END group_rank FROM ranked r
    ), division AS (
      SELECT r.*,row_number() OVER(ORDER BY score DESC,last_solve ASC NULLS LAST,name,id)::int rank FROM group_ranks r WHERE (($4::uuid IS NULL AND rank_overall) OR group_id=$4)
    ), filtered AS (
      SELECT * FROM division WHERE strpos(lower(name),lower($5::text))>0 AND ($8::uuid IS NULL OR id=$8)
    ), paged AS (
      SELECT * FROM filtered ORDER BY rank LIMIT $6 OFFSET $3
    ), display_scores AS (
      SELECT s.owner_key,s.unit_id,min(s.id::text) id,sum(s.points)::int points,max(s.created_at) created_at,
        CASE WHEN bool_or(s.round_number IS NOT NULL) THEN NULL ELSE min(s.blood_rank) END blood_rank,
        CASE WHEN $9::boolean THEN s.user_id ELSE NULL END user_id,
        CASE WHEN $9::boolean THEN max(s.round_number) ELSE NULL END round_number,
        CASE WHEN $9::boolean THEN jsonb_agg(s.round_details)->0 ELSE NULL END round_details
      FROM scored s JOIN paged p ON p.owner_key=s.owner_key JOIN units u ON u.unit_id=s.unit_id WHERE ($10::uuid[] IS NULL OR u.challenge_id=ANY($10::uuid[]))
      GROUP BY s.owner_key,s.unit_id,CASE WHEN $9::boolean THEN s.id ELSE NULL END,CASE WHEN $9::boolean THEN s.user_id ELSE NULL END
    ), page_solves AS (
      SELECT s.owner_key,jsonb_agg(jsonb_build_object('unit_id',s.unit_id,'score',s.points,'solved_at',s.created_at,'blood_rank',CASE WHEN blood_rank<=3 THEN blood_rank ELSE NULL END,'round_number',s.round_number,'round_details',s.round_details) || CASE WHEN $9::boolean THEN jsonb_build_object('solver_id',s.user_id,'solver_name',u.username) ELSE '{}'::jsonb END ORDER BY s.created_at,s.id) cells
      FROM display_scores s LEFT JOIN users u ON $9::boolean AND u.id=s.user_id GROUP BY s.owner_key
    ), member_ids AS (
      SELECT m.user_id,true current_member FROM memberships m JOIN paged p ON p.id=m.team_id WHERE $1<>'practice'
      UNION ALL SELECT p.id,true FROM paged p WHERE $1='practice'
      UNION ALL SELECT s.user_id,false FROM scored s JOIN paged p ON p.owner_key=s.owner_key
      UNION ALL SELECT (m->>'user_id')::uuid,false FROM scored s JOIN paged p ON p.owner_key=s.owner_key CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.round_details->'members','[]'::jsonb)) m
    ), roster AS (
      SELECT u.id,u.username name,bool_or(m.current_member) current_member FROM member_ids m JOIN users u ON u.id=m.user_id GROUP BY u.id
    ), top_teams AS (
      SELECT * FROM division WHERE $1<>'practice' AND NOT $9::boolean AND score>0 ORDER BY rank LIMIT 5
    ), steps AS (
      SELECT s.*,sum(s.points) OVER(PARTITION BY s.owner_key ORDER BY s.created_at,s.id)::int total,
        row_number() OVER(PARTITION BY s.owner_key ORDER BY s.created_at,s.id) sequence,
        count(*) OVER(PARTITION BY s.owner_key) length
      FROM scored s JOIN top_teams t ON t.owner_key=s.owner_key
    ), series AS (
      SELECT owner_key,jsonb_agg(jsonb_build_object('time',created_at,'score',total) ORDER BY created_at,id) points
      FROM steps WHERE sequence=1 OR sequence=length OR sequence%greatest(1,ceil(length/300.0)::int)=0 GROUP BY owner_key
    ) SELECT
      (SELECT count(*)::int FROM filtered) total,
      (SELECT count(*)::int FROM division) participants,
      (SELECT count(*)::int FROM eligible WHERE $10::uuid[] IS NULL OR id=ANY($10::uuid[])) challenge_count,
      (SELECT count(*)::int FROM units WHERE $10::uuid[] IS NULL OR challenge_id=ANY($10::uuid[])) flag_count,
      EXISTS(SELECT 1 FROM units WHERE $10::uuid[] IS NOT NULL AND NOT(challenge_id=ANY($10::uuid[]))) details_limited,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'rank',p.rank,'overall_rank',p.overall_rank,'group_rank',p.group_rank,'name',p.name,'group_id',p.group_id,'group_name',p.group_name,'score',p.score,'solves',p.solves,'flags',p.flags,'last_solve',p.last_solve,'cells',coalesce(s.cells,'[]'::jsonb)) ORDER BY p.rank) FROM paged p LEFT JOIN page_solves s ON s.owner_key=p.owner_key),'[]'::jsonb) items,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.unit_id,'challenge_id',u.challenge_id,'title',u.title,'part_title',u.part_title,'category',u.category,'points',u.points,'solves',u.solve_count,'scoring_mode',u.mode) ORDER BY u.category,u.created_at,u.challenge_id,u.position) FROM unit_scores u WHERE ($10::uuid[] IS NULL OR u.challenge_id=ANY($10::uuid[])) AND (($1<>'practice' AND NOT $9::boolean) OR EXISTS(SELECT 1 FROM scored s JOIN paged p ON p.owner_key=s.owner_key WHERE s.unit_id=u.unit_id))),'[]'::jsonb) columns,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'score',t.score,'points',s.points) ORDER BY t.rank) FROM top_teams t JOIN series s ON s.owner_key=t.owner_key),'[]'::jsonb) timeline,
      CASE WHEN $9::boolean THEN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name,r.id) FROM roster r),'[]'::jsonb) ELSE NULL END members`,
      [
        p.scope,
        cutoff,
        (p.page - 1) * p.page_size,
        p.group ?? null,
        p.q.trim(),
        p.page_size,
        started,
        p.participant ?? null,
        detail,
        await visibleChallengeIds(db, p.scope, req.user ?? undefined),
      ],
    );
    const metadata = {
      scope: p.scope,
      frozen,
      started,
      cutoff,
      starts_at: contest?.starts_at ?? null,
      ends_at: contest?.ends_at ?? null,
    };
    if (detail) {
      const row = result!.items[0];
      if (!row) fail(404, "排名不存在");
      return {
        ...metadata,
        ...row,
        columns: result!.columns,
        details_limited: result!.details_limited,
        ...contributions(row.cells, result!.columns, result!.members),
      };
    }
    const { members: _members, ...board } = result!;
    return {
      ...board,
      ...metadata,
      page: p.page,
      page_size: p.page_size,
    };
  };
  app.get("/api/scoreboard", (req) => read(req));
  app.get("/api/scoreboard/:participant", (req) => read(req, true));
}

type CategoryScore = { category: string; score: number; flags: number };
function contributions(
  cells: {
    unit_id: string;
    solver_id: string;
    score: number;
    round_details?: {
      members?: { user_id: string; points: number }[];
      team_points?: number;
    };
  }[],
  columns: { id: string; category: string }[],
  roster: { id: string; name: string; current_member: boolean }[],
) {
  const empty = (): CategoryScore[] =>
    ["Web", "Pwn", "Reverse", "Crypto", "Misc", "Forensics"].map(
      (category) => ({ category, score: 0, flags: 0 }),
    );
  const categories = empty();
  const members = new Map(
    roster.map((member) => [
      member.id,
      { ...member, score: 0, flags: 0, categories: empty() },
    ]),
  );
  const units = new Map(columns.map((column) => [column.id, column.category]));
  let teamPoints = 0;
  for (const cell of cells) {
    const category = units.get(cell.unit_id),
      total = categories.find((v) => v.category === category);
    if (total) {
      total.score += cell.score;
      if (cell.score > 0) total.flags++;
    }
    const attribution =
      cell.round_details?.members ??
      (cell.solver_id ? [{ user_id: cell.solver_id, points: cell.score }] : []);
    teamPoints +=
      cell.round_details?.team_points ?? (!cell.solver_id ? cell.score : 0);
    for (const credit of attribution) {
      const member = members.get(credit.user_id);
      if (!member) continue;
      member.score += credit.points;
      if (credit.points > 0) member.flags++;
      const entry = member.categories.find((v) => v.category === category);
      if (entry) {
        entry.score += credit.points;
        if (credit.points > 0) entry.flags++;
      }
    }
  }
  return {
    categories,
    team_points: teamPoints,
    members: [...members.values()].sort(
      (a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    ),
  };
}
