import { z } from "zod";
import type { DB, Row } from "./db.js";
import { fail } from "./security.js";
const maximum = z.number().int().min(1).max(100000).nullable();
export const submissionLimitsInput = z.object({
  flag: maximum.default(null),
  defense: maximum.default(null),
});
export const submissionOverridesInput = z
  .array(
    z.object({
      challenge_id: z.string().uuid(),
      flag: maximum.optional(),
      defense: maximum.optional(),
    }),
  )
  .max(200)
  .refine(
    (v) => new Set(v.map((c) => c.challenge_id)).size === v.length,
    "提交限制不能重复",
  );
export type SubmissionKind = "flag" | "defense";
export async function submissionUsage(
  db: DB,
  c: Row,
  scope: string,
  owner: string,
) {
  if (scope === "practice" || c.contest_practice || !owner)
    return {
      flag: { limit: null, used: 0, remaining: null },
      defense: { limit: null, used: 0, remaining: null },
    };
  const [contest] = await db.query(
    "SELECT submission_limits,submission_overrides FROM contests WHERE id=$1",
    [scope],
  );
  const overrides =
    contest?.submission_overrides?.find((v: any) => v.challenge_id === c.id) ??
    {};
  const [counts] = await db.query(
    "SELECT (SELECT count(*)::int FROM submissions WHERE scope=$1 AND challenge_id=$2 AND owner_key=$3 AND NOT contest_practice) flag,(SELECT count(*)::int FROM judge_jobs WHERE scope=$1 AND challenge_id=$2 AND owner_key=$3 AND NOT coalesce((spec->>'contest_practice')::boolean,false)) defense",
    [scope, c.id, owner],
  );
  const entry = (kind: SubmissionKind) => {
    const limit = Object.hasOwn(overrides, kind)
      ? overrides[kind]
      : (contest?.submission_limits?.[kind] ?? null);
    const used = counts?.[kind] ?? 0;
    return {
      limit: limit as number | null,
      used: used as number,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  };
  return { flag: entry("flag"), defense: entry("defense") };
}
export async function requireSubmissionSlot(
  db: DB,
  c: Row,
  scope: string,
  owner: string,
  kind: SubmissionKind,
) {
  if (scope === "practice" || c.contest_practice) return;
  await db.query("SELECT id FROM contests WHERE id=$1 FOR SHARE", [scope]);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify(["submission-quota", scope, c.id, owner]),
  ]);
  const usage = (await submissionUsage(db, c, scope, owner))[kind];
  if (usage.remaining === 0)
    fail(
      409,
      `${kind === "flag" ? "Flag 提交" : "防御申请"}次数已用完（${usage.used}/${usage.limit}）`,
    );
}
