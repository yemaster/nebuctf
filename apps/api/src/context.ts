import { can } from "./access-control.js";
import { canViewContest } from "./contest-entry.js";
import { requireAccepted } from "./registrations.js";
import { isContestPractice } from "./contest-practice.js";
import { effectivePoints } from "./competition-rules.js";
import { questionWindow } from "./contest-timing.js";
import { publicObjective, resourceProfiles } from "./challenge-model.js";
import { fail } from "./security.js";
import type { DB, Row } from "./db.js";
import { contestLogicState } from "./contest-logic.js";
import {
  allPermissions,
  ownerPermissions,
  requirePermission,
} from "./group-permissions.js";
export interface User {
  access?: import("./access-control.js").AccessProfile;
  avatar_id?: string | null;
  id: string;
  username: string;
  email: string;
  role: string;
}
export async function getTeam(db: DB, user: string, teamId?: string) {
  const [team] = await db.query(
    "SELECT t.* FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=$1 AND ($2::uuid IS NULL OR t.id=$2) ORDER BY t.created_at,t.id LIMIT 1",
    [user, teamId ?? null],
  );
  return team;
}
export async function contestAccess(
  db: DB,
  scope: string,
  user: User | undefined,
  active = true,
) {
  if (scope === "practice") return null;
  const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
    scope,
  ]);
  if (!contest || (!contest.published && !can(user, "contests.read", scope)))
    fail(404, "比赛不存在");
  if (!(await canViewContest(db, contest!, user))) fail(404, "比赛不存在");
  if (
    active &&
    (new Date(contest!.starts_at).getTime() > Date.now() ||
      (new Date(contest!.ends_at).getTime() <= Date.now() &&
        !isContestPractice(contest)))
  )
    fail(403, "比赛尚未开始或已经结束");
  return contest!;
}
export async function ownerFor(
  db: DB,
  scope: string,
  user: User,
  requireRegistration = true,
) {
  if (scope === "practice") return `u:${user.id}`;
  const registered = await registeredTeam(db, scope, user.id);
  if (registered) {
    requireAccepted(registered.status, scope);
    return `t:${registered.id}`;
  }
  const team = await getTeam(db, user.id);
  if (!team)
    fail(403, "请先创建或加入战队", { label: "创建或加入战队", href: "/team" });
  if (requireRegistration)
    fail(403, "战队尚未报名", {
      label: "前往报名",
      href: `/contests/${scope}`,
    });
  return `t:${team!.id}`;
}
async function registeredTeam(db: DB, scope: string, userId: string) {
  const [registered] = await db.query(
    "SELECT t.id,r.status FROM teams t JOIN memberships m ON m.team_id=t.id JOIN registrations r ON r.team_id=t.id WHERE m.user_id=$1 AND r.contest_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1",
    [userId, scope],
  );
  return registered;
}
// Unregistered administrators may preview a contest. Once registered, their
// challenge progress belongs to the same team as every other participant.
export async function progressOwnerFor(db: DB, scope: string, user?: User) {
  if (!user) return "";
  if (scope === "practice" || !can(user, "contests.read", scope))
    return ownerFor(db, scope, user);
  const team = await registeredTeam(db, scope, user.id);
  if (team) requireAccepted(team.status, scope);
  return team ? `t:${team.id}` : "";
}
export async function challengeAccess(
  db: DB,
  id: string,
  scope: string,
  user: User | undefined,
  active = true,
  permission: "view" | "submit" | "resources" = "view",
): Promise<Row> {
  const contest = await contestAccess(db, scope, user, active);
  const [c] = await db.query("SELECT * FROM challenges WHERE id=$1", [id]);
  if (
    !c ||
    (!c.published &&
      !can(user, "challenges.read", id) &&
      !(scope !== "practice" && can(user, "contests.read", scope)))
  )
    fail(404, "题目不存在");
  if (scope === "practice") {
    if (!c!.practice) fail(404, "题目未开放练习");
    return { ...c!, permissions: allPermissions };
  }
  const [link] = await db.query(
    "SELECT * FROM contest_challenges WHERE contest_id=$1 AND challenge_id=$2",
    [scope, id],
  );
  if (
    !link ||
    ((!link.published ||
      (link.release_at && new Date(link.release_at).getTime() > Date.now())) &&
      !can(user, "contests.read", scope))
  )
    fail(404, "比赛中没有此题");
  if (!user) fail(401, "请先登录");
  const owner = await progressOwnerFor(db, scope, user);
  const permissions = owner
    ? await ownerPermissions(db, scope, owner, id)
    : allPermissions;
  requirePermission(permissions, "view");
  requirePermission(permissions, permission);
  const phase = await questionWindow(db, contest!, c!, owner);
  const practice = isContestPractice(contest);
  const logic = (await contestLogicState(db, scope, owner, practice)).get(id);
  if (logic === null) fail(403, "题目尚未解锁或已选择其他互斥题目");
  if (practice && c!.challenge_type === "awd" && permission !== "view")
    fail(403, "AWD 对抗已结束，可查看题面和历史轮次");
  // Only an unregistered administrator gets a preview. Registered admins play by the same clock.
  if (active && owner && phase.status !== "active")
    fail(
      403,
      phase.status === "ready"
        ? "请先开始本阶段作答"
        : phase.status === "ended"
          ? "本阶段作答已结束"
          : "本阶段尚未开始",
      { label: "查看作答时间", href: `/contests/${scope}` },
    );
  return {
    ...effectivePoints(c!, link!.scoring),
    contest_scoring: link!.scoring,
    ...(logic ? { contest_logic: logic } : {}),
    phase,
    contest_practice: practice,
    permissions,
  };
}

export const publicChallenge = (c: Row) => ({
  hints: [],
  defense_enabled:
    ["awdp", "awd"].includes(c.challenge_type) && !!c.patch_config,
  ...Object.fromEntries(
    [
      "id",
      "title",
      "description",
      "category",
      "difficulty",
      "kind",
      "challenge_type",
      "scoring_mode",
      "phase",
      "initial_points",
      "minimum_points",
      "decay",
      "dynamic_score",
      "created_at",
      "permissions",
      "contest_practice",
      "contest_logic",
    ].map((k) => [k, c[k]]),
  ),
  objective: c.objective ? publicObjective(c.objective) : null,
  resources: {
    container: resourceProfiles(c).container
      ? {
          mode: resourceProfiles(c).container!.mode,
          protocol: resourceProfiles(c).container!.protocol,
        }
      : null,
    attachment: !!resourceProfiles(c).attachment,
  },
  round:
    !c.contest_practice && c.contest_scoring?.mode === "round"
      ? c.contest_scoring.round
      : null,
});
