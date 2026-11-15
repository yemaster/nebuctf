import { z } from "zod";
import type { DB } from "./db.js";
import { fail } from "./security.js";

const count = z.number().int().min(0).max(10000).nullable().default(null);
export const contestResourceLimitsInput = z
  .object({
    containers_per_team: count,
    container_starts_per_team: count,
    attachments_per_team: count,
    containers_total: count,
    attachments_total: count,
  })
  .strict();

// Called inside the same transaction lock as resource creation and contest edits.
// Queued and stopping instances reserve slots; a ready attachment retains its slot until deleted/expired.
export async function contestResourcePolicy(
  db: DB,
  scope: string,
  owner: string,
  type: "container" | "attachment",
  replacing?: string,
) {
  if (scope === "practice" || scope === "test") return null;
  const [contest] = await db.query(
    "SELECT resource_limits FROM contests WHERE id=$1",
    [scope],
  );
  if (!contest) return null;
  const limits = contest.resource_limits ?? {};
  const prefix = type === "container" ? "containers" : "attachments";
  const teamLimit: number | null =
    owner === "shared" ? null : (limits[`${prefix}_per_team`] ?? null);
  const totalLimit: number | null = limits[`${prefix}_total`] ?? null;
  const [usage] = await db.query(
    `SELECT count(*)::int total,count(*) FILTER(WHERE owner_key=$2)::int owned FROM instances
      WHERE scope=$1 AND resource_type=$3 AND ($4::uuid IS NULL OR id<>$4) AND status IN ('queued','starting','running','ready','stopping')`,
    [scope, owner, type, replacing ?? null],
  );
  const name = type === "container" ? "靶机" : "动态附件";
  const blocked =
    teamLimit !== null && usage!.owned >= teamLimit
      ? {
          message:
            teamLimit === 0
              ? `本场比赛未开放${name}创建`
              : `本队${name}已达上限（${teamLimit}）`,
          action: {
            label: type === "container" ? "管理靶机" : "管理附件",
            href: `/contests/${scope}/instances`,
          },
        }
      : totalLimit !== null && usage!.total >= totalLimit
        ? {
            message:
              totalLimit === 0
                ? `本场比赛未开放${name}创建`
                : `本场比赛${name}已达上限（${totalLimit}），请稍后重试`,
            action: {
              label: "查看本队资源",
              href: `/contests/${scope}/instances`,
            },
          }
        : null;
  return {
    team_limit: teamLimit,
    total_limit: totalLimit,
    team_used: usage!.owned as number,
    total_used: usage!.total as number,
    blocked,
  };
}
export async function requireContestResourceSlot(
  db: DB,
  scope: string,
  owner: string,
  type: "container" | "attachment",
  replacing?: string,
) {
  const policy = await contestResourcePolicy(db, scope, owner, type, replacing);
  if (policy?.blocked) fail(409, policy.blocked.message, policy.blocked.action);
  return policy;
}
