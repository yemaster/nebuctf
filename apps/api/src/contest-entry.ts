import { can } from "./access-control.js";
import { createHmac } from "node:crypto";
import type { DB, Row } from "./db.js";
import type { User } from "./context.js";
import { config } from "./config.js";
import { equal, fail } from "./security.js";
import { isContestPractice } from "./contest-practice.js";

export function validateRegistrationWindow(contest: Row) {
  const start = contest.registration_opens_at
    ? new Date(contest.registration_opens_at).getTime()
    : null;
  const end = new Date(
    contest.registration_closes_at ?? contest.ends_at,
  ).getTime();
  if (start !== null && start >= end)
    fail(400, "报名开放时间必须早于报名截止时间");
  if (end > new Date(contest.ends_at).getTime())
    fail(400, "报名截止时间不能晚于比赛结束时间");
}

export function checkRegistrationWindow(contest: Row, now = Date.now()) {
  if (isContestPractice(contest, now)) return;
  const action = { label: "查看赛程", href: `/contests/${contest.id}` };
  if (
    contest.registration_opens_at &&
    now < new Date(contest.registration_opens_at).getTime()
  )
    fail(403, "报名尚未开放", action);
  if (
    now >= new Date(contest.registration_closes_at ?? contest.ends_at).getTime()
  )
    fail(403, "报名已截止", action);
}

export const registrationCodeHash = (value: string) =>
  createHmac("sha256", config.APP_SECRET)
    .update(`contest-invite:${value}`)
    .digest("hex");

export function publicContest(contest: Row, admin = false) {
  const { registration_code_hash, registration_team_ids, ...safe } = contest;
  return {
    ...safe,
    ...(admin
      ? {
          registration_code_set: !!registration_code_hash,
          registration_team_ids,
        }
      : {}),
  };
}

export function checkRegistrationScope(contest: Row, team: string, code = "") {
  if (
    contest.registration_mode === "teams" &&
    !contest.registration_team_ids.includes(team)
  )
    fail(403, "本场比赛仅限指定战队报名", {
      label: "查看比赛说明",
      href: `/contests/${contest.id}`,
    });
  if (
    contest.registration_mode === "invite" &&
    (!contest.registration_code_hash ||
      !equal(registrationCodeHash(code.trim()), contest.registration_code_hash))
  )
    fail(403, "报名邀请码不正确");
}

export async function requireScoreboardAccess(
  db: DB,
  contest: Row | null,
  user?: User,
) {
  if (
    !contest ||
    contest.spectator_scoreboard !== false ||
    can(user, "contests.read", contest.id)
  )
    return;
  if (
    user &&
    (
      await db.query(
        "SELECT 1 FROM registrations r JOIN memberships m ON m.team_id=r.team_id WHERE r.contest_id=$1 AND r.status='accepted' AND m.user_id=$2 LIMIT 1",
        [contest.id, user.id],
      )
    ).length
  )
    return;
  fail(403, "本场比赛的排行榜仅向参赛者开放", {
    label: "查看比赛",
    href: `/contests/${contest.id}`,
  });
}

// Arguments are internal SQL identifiers/placeholders, never request values.
export function contestVisibilitySQL(
  alias: string,
  user: string,
  admin: string,
) {
  return `(${alias}.visibility='public' OR ${admin} OR (${user} IS NOT NULL AND EXISTS(
    SELECT 1 FROM memberships visibility_members WHERE visibility_members.user_id=${user}
      AND (visibility_members.team_id=ANY(${alias}.registration_team_ids) OR EXISTS(
        SELECT 1 FROM registrations visibility_registration WHERE visibility_registration.contest_id=${alias}.id
          AND visibility_registration.team_id=visibility_members.team_id AND visibility_registration.status IN ('pending','accepted','suspended')
      )))))`;
}
export async function canViewContest(db: DB, contest: Row, user?: User) {
  if (
    contest.visibility !== "private" ||
    can(user, "contests.read", contest.id)
  )
    return true;
  if (!user) return false;
  return !!(
    await db.query(
      `SELECT 1 FROM contests c WHERE c.id=$1 AND ${contestVisibilitySQL("c", "$2::uuid", "false")}`,
      [contest.id, user.id],
    )
  ).length;
}
