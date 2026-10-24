import { z } from "zod";
import type { DB, Row } from "./db.js";
import { fail } from "./security.js";
export const writeupInput = z
  .object({
    enabled: z.boolean().default(false),
    required: z.boolean().default(false),
    submitter: z.enum(["captain", "members"]).default("members"),
    opens_at: z.iso.datetime().nullable().default(null),
    deadline: z.iso.datetime().nullable().default(null),
    max_size_mb: z.number().int().min(1).max(20).default(20),
    formats: z
      .array(z.enum(["pdf", "zip"]))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length, "文件格式不能重复")
      .default(["pdf"]),
    allow_resubmit: z.boolean().default(true),
    note: z.string().max(5000).default(""),
  })
  .strict();
export type WriteupConfig = z.infer<typeof writeupInput>;
export function validateWriteup(
  config: WriteupConfig,
  contest: { starts_at: string | Date; ends_at: string | Date },
) {
  if (!config.enabled) return;
  if (!config.deadline) fail(400, "请设置 WriteUp 截止时间");
  const start = new Date(config.opens_at ?? contest.ends_at).getTime(),
    end = new Date(config.deadline!).getTime();
  if (start < new Date(contest.starts_at).getTime())
    fail(400, "WriteUp 开始提交时间不能早于开赛时间");
  if (end <= start || end < new Date(contest.ends_at).getTime())
    fail(400, "WriteUp 截止时间必须晚于开始提交时间，且不早于比赛结束时间");
}
export function writeupWindow(
  contest: Row,
  config: WriteupConfig,
  current?: Row,
) {
  const open = new Date(config.opens_at ?? contest.ends_at).getTime(),
    deadline = config.deadline ? Date.parse(config.deadline) : 0;
  return !config.enabled
    ? "disabled"
    : Date.now() < open
      ? "upcoming"
      : Date.now() >= deadline
        ? "closed"
        : current &&
            !config.allow_resubmit &&
            current.status !== "changes_requested"
          ? "submitted"
          : "open";
}
// Accepted rosters are immutable for this contest, even if a team changes members after it ends.
export async function snapshotContestMembers(
  db: DB,
  contest: string,
  team: string,
) {
  if (
    (
      await db.query(
        "SELECT 1 FROM contest_members WHERE contest_id=$1 AND team_id=$2 LIMIT 1",
        [contest, team],
      )
    ).length
  )
    return;
  await db.query(
    "INSERT INTO contest_members(contest_id,team_id,user_id) SELECT $1,m.team_id,m.user_id FROM memberships m WHERE m.team_id=$2 ON CONFLICT DO NOTHING",
    [contest, team],
  );
}
