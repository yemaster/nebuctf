import { can } from "./access-control.js";
import { z } from "zod";
import type { DB, Row } from "./db.js";
import { fail } from "./security.js";

export const challengePermissionInput = z
  .object({
    view: z.boolean(),
    submit: z.boolean(),
    resources: z.boolean(),
    score: z.boolean(),
    blood: z.boolean(),
    dynamic: z.boolean(),
  })
  .partial()
  .strict();
export const groupPermissionInput = challengePermissionInput
  .extend({
    join: z.boolean().optional(),
    rank_overall: z.boolean().optional(),
    require_review: z.boolean().optional(),
  })
  .strict();
export const groupOverridesInput = z
  .record(z.string().uuid(), challengePermissionInput)
  .refine((v) => Object.keys(v).length <= 200, "单题权限最多 200 项");
export const allPermissions = {
  join: true,
  rank_overall: true,
  require_review: false,
  view: true,
  submit: true,
  resources: true,
  score: true,
  blood: true,
  dynamic: true,
};
export type GroupPermissions = typeof allPermissions;
export type ChallengePermission = keyof z.infer<
  typeof challengePermissionInput
>;
export function effectivePermissions(
  group?: Row | null,
  challenge?: string,
): GroupPermissions {
  return {
    ...allPermissions,
    ...group?.permissions,
    ...(challenge ? group?.challenge_permissions?.[challenge] : {}),
  };
}
// Arguments are internal SQL identifiers, never request text. JSON overrides
// inherit individual omitted permissions from the group's defaults.
export function permissionSQL(
  group: string,
  challenge: string,
  key: ChallengePermission,
) {
  return `coalesce((${group}.challenge_permissions->(${challenge})::text->>'${key}')::boolean,(${group}.permissions->>'${key}')::boolean,true)`;
}
export async function ownerPermissions(
  db: DB,
  scope: string,
  owner: string,
  challenge?: string,
) {
  if (scope === "practice") return { ...allPermissions };
  const [row] = await db.query(
    "SELECT r.status,g.permissions,g.challenge_permissions FROM registrations r LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id::text=$1 AND 't:'||r.team_id=$2",
    [scope, owner],
  );
  if (!row || row.status !== "accepted")
    return Object.fromEntries(
      Object.keys(allPermissions).map((k) => [k, false]),
    ) as GroupPermissions;
  return effectivePermissions(row, challenge);
}
export function requirePermission(
  permissions: GroupPermissions,
  permission: "view" | "submit" | "resources",
) {
  if (!permissions[permission])
    fail(
      permission === "view" ? 404 : 403,
      permission === "view"
        ? "比赛中没有此题"
        : permission === "submit"
          ? "当前组别没有此题的作答权限"
          : "当前组别没有此题的靶机与附件使用权限",
    );
}

// Registered administrators use their team's permissions; only an unregistered
// administrator previews everything. Public scoreboards disclose common titles.
export async function visibleChallengeIds(
  db: DB,
  scope: string,
  user?: {
    id: string;
    role: string;
    access?: import("./access-control.js").AccessProfile;
  },
): Promise<string[] | null> {
  if (scope === "practice") return null;
  const [registered] = user
    ? await db.query(
        "SELECT r.status,g.permissions,g.challenge_permissions FROM registrations r JOIN memberships m ON m.team_id=r.team_id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id=$1 AND m.user_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1",
        [scope, user.id],
      )
    : [];
  if (!registered && can(user, "contests.read", scope)) return null;
  if (registered && registered.status !== "accepted") return [];
  const groups = registered
    ? [registered]
    : await db.query(
        "SELECT permissions,challenge_permissions FROM contest_groups WHERE contest_id=$1",
        [scope],
      );
  const ids = await db.query(
    "SELECT challenge_id FROM contest_challenges WHERE contest_id=$1",
    [scope],
  );
  return ids
    .filter((c) =>
      groups.every((g) => effectivePermissions(g, c.challenge_id).view),
    )
    .map((c) => c.challenge_id);
}
