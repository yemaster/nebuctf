import {
  defaultPartEnvironment,
  partEnvironmentName,
} from "./flag-environment.js";
import { effectivePoints } from "./competition-rules.js";
import type { DB, Row } from "./db.js";
import { publicChallenge } from "./context.js";
import { fail, flagHash, score } from "./security.js";
import type { z } from "zod";
import type { partInput } from "./schemas.js";
import { effectivePermissions, permissionSQL } from "./group-permissions.js";

// One batch for a page of challenges. Hashes never cross the public API boundary.
export async function challengeProgress(
  db: DB,
  challenges: Row[],
  scope: string,
  owner: string,
  cutoff: Date | string,
  practice = false,
) {
  if (!challenges.length) return [];
  const [group] =
    scope === "practice" || !owner
      ? []
      : await db.query(
          "SELECT g.permissions,g.challenge_permissions FROM accepted_registrations r LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id::text=$1 AND 't:'||r.team_id=$2",
          [scope, owner],
        );
  const counts = await db.query(
    `SELECT s.challenge_id,count(*) FILTER(WHERE ${permissionSQL("g", "s.challenge_id", "dynamic")})::int dynamic_solves FROM solves s LEFT JOIN accepted_registrations r ON r.contest_id::text=$2 AND 't:'||r.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=r.group_id WHERE s.challenge_id=ANY($1::uuid[]) AND s.scope=$2 AND s.created_at<=$3 AND NOT s.contest_practice AND ($2='practice' OR r.team_id IS NOT NULL) GROUP BY s.challenge_id`,
    [challenges.map((c) => c.id), scope, cutoff],
  );
  const links =
    scope === "practice"
      ? []
      : await db.query(
          "SELECT challenge_id,scoring FROM contest_challenges WHERE contest_id=$1 AND challenge_id=ANY($2::uuid[])",
          [scope, challenges.map((c) => c.id)],
        );
  const rows = await db.query(
    `SELECT p.*, (SELECT count(*)::int FROM part_solves s WHERE s.part_id=p.id AND s.scope=$2 AND s.created_at<=$4 AND NOT s.contest_practice) solves,
      (SELECT count(*)::int FROM part_solves s LEFT JOIN accepted_registrations r ON r.contest_id::text=$2 AND 't:'||r.team_id=s.owner_key LEFT JOIN contest_groups g ON g.id=r.group_id WHERE s.part_id=p.id AND s.scope=$2 AND s.created_at<=$4 AND NOT s.contest_practice AND ($2='practice' OR r.team_id IS NOT NULL) AND ${permissionSQL("g", "p.challenge_id", "dynamic")}) dynamic_solves,
      EXISTS(SELECT 1 FROM part_solves s WHERE s.part_id=p.id AND s.scope=$2 AND s.owner_key=$3) solved
     FROM challenge_parts p WHERE p.challenge_id=ANY($1::uuid[]) ORDER BY p.position,p.id`,
    [challenges.map((c) => c.id), scope, owner, cutoff],
  );
  return challenges.map((original) => {
    const scoring = links.find((l) => l.challenge_id === original.id)?.scoring;
    const c: Row = {
      ...effectivePoints(original, scoring),
      contest_scoring: scoring,
      contest_practice: practice,
      permissions: {
        ...effectivePermissions(group, original.id),
        ...(practice ? { score: false, blood: false, dynamic: false } : {}),
        ...(practice && original.challenge_type === "awd"
          ? { submit: false, resources: false }
          : {}),
      },
    };
    const parts = rows
      .filter((p) => p.challenge_id === c.id)
      .map((p) =>
        effectivePoints(
          {
            ...p,
            decay: original.decay,
            dynamic_score: original.dynamic_score,
          },
          scoring,
          p.id,
        ),
      )
      .map((p) => ({
        id: p.id,
        title: p.title,
        role: p.role,
        description: p.description,
        initial_points: p.initial_points,
        minimum_points: p.minimum_points,
        points: score(
          p.initial_points,
          p.minimum_points,
          p.decay,
          p.dynamic_solves,
          p.dynamic_score,
        ),
        solves: p.solves,
        solved: p.solved,
      }));
    const points = parts.length
      ? parts.reduce((n, p) => n + p.points, 0)
      : score(
          c.initial_points,
          c.minimum_points,
          c.decay,
          counts.find((row) => row.challenge_id === c.id)?.dynamic_solves ?? 0,
          c.dynamic_score,
        );
    return {
      ...publicChallenge(c),
      parts,
      points,
      solves: c.solves,
      solved: c.solved,
      total_parts: parts.length || 1,
      solved_parts: parts.length
        ? parts.filter((p) => p.solved).length
        : Number(c.solved),
      earned_points: !c.permissions.score
        ? 0
        : parts.length
          ? parts.reduce((n, p) => n + (p.solved ? p.points : 0), 0)
          : c.solved
            ? points
            : 0,
    };
  });
}

export function prepareParts(
  input: z.infer<typeof partInput>[] | undefined,
  old: Row[],
  dynamic: boolean,
  frozen: boolean,
) {
  let oldFlagIndex = 0;
  old = old.map((p) => {
    const index = oldFlagIndex;
    if (p.role !== "defense") oldFlagIndex++;
    return {
      ...p,
      flag_env:
        p.role === "defense"
          ? null
          : (p.flag_env ?? defaultPartEnvironment(index)),
    };
  });
  let newFlagIndex = 0;
  const prepared =
    input === undefined
      ? old
      : input.map((p, position) => {
          const flagIndex = newFlagIndex;
          if (p.role !== "defense") newFlagIndex++;
          const existing = p.id ? old.find((o) => o.id === p.id) : undefined;
          if (p.id && !existing) fail(400, "小题 ID 不属于此题目");
          const hash = p.flag ? flagHash(p.flag) : (existing?.flag_hash ?? "");
          if (!dynamic && p.role !== "defense" && !hash)
            fail(400, "每个小题都需要配置 Flag");
          return {
            id: p.id ?? crypto.randomUUID(),
            role: p.role,
            flag_env:
              p.role === "defense"
                ? null
                : (p.flag_env ??
                  existing?.flag_env ??
                  defaultPartEnvironment(flagIndex)),
            title: p.title,
            description: p.description,
            position,
            initial_points: p.initial_points,
            minimum_points: p.minimum_points,
            flag_hash: dynamic ? "" : hash,
          };
        });
  const parts: Row[] = prepared.map((p) => ({
    ...p,
    flag_hash: dynamic ? "" : p.flag_hash,
  }));
  const variables = parts
    .filter((p) => p.role !== "defense")
    .map((p) => partEnvironmentName.parse(p.flag_env));
  if (new Set(variables).size !== variables.length)
    fail(400, "小题环境变量名不能重复");
  if (!dynamic && parts.some((p) => p.role !== "defense" && !p.flag_hash))
    fail(400, "每个小题都需要配置 Flag");
  if (new Set(parts.map((p) => p.id)).size !== parts.length)
    fail(400, "小题 ID 不能重复");
  if (
    !dynamic &&
    new Set(parts.filter((p) => p.role !== "defense").map((p) => p.flag_hash))
      .size !== parts.filter((p) => p.role !== "defense").length
  )
    fail(400, "同一题的小题 Flag 不能重复");
  if (
    frozen &&
    (parts.length !== old.length ||
      parts.some(
        (p, i) =>
          !old[i] ||
          [
            "id",
            "role",
            "position",
            "initial_points",
            "minimum_points",
            "flag_hash",
            "flag_env",
          ].some((k) => p[k] !== old[i]![k]),
      ))
  )
    fail(409, "已有解题或活跃环境，不能改变小题、Flag 或分值");
  return parts;
}

export async function saveParts(db: DB, challenge: string, parts: Row[]) {
  await db.query(
    "DELETE FROM challenge_parts WHERE challenge_id=$1 AND NOT(id=ANY($2::uuid[]))",
    [challenge, parts.map((p) => p.id)],
  );
  for (const p of parts)
    await db.query(
      `INSERT INTO challenge_parts(id,challenge_id,title,description,position,flag_hash,initial_points,minimum_points,role,flag_env)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET title=$3,description=$4,position=$5,flag_hash=$6,initial_points=$7,minimum_points=$8,role=$9,flag_env=$10`,
      [
        p.id,
        challenge,
        p.title,
        p.description,
        p.position,
        p.flag_hash,
        p.initial_points,
        p.minimum_points,
        p.role ?? "flag",
        p.flag_env ?? null,
      ],
    );
}
