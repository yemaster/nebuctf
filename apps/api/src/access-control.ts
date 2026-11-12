import type { FastifyRequest } from "fastify";
import type { User } from "./context.js";
import type { DB } from "./db.js";
import { fail } from "./security.js";

export const permissionGroups = [
  ["overview", "概览"],
  ["settings", "系统配置"],
  ["containers", "容器策略"],
  ["mail", "邮件策略"],
  ["ai", "AI 转发"],
  ["messages", "系统消息"],
  ["challenges", "题目"],
  ["contests", "比赛"],
  ["content", "题单与学习"],
  ["announcements", "公告"],
  ["resources", "资源"],
  ["images", "Docker 镜像"],
  ["traffic", "流量监测"],
  ["users", "用户"],
  ["logs", "提交与审计"],
] as const;
export const permissionKeys = permissionGroups.flatMap(([key]) =>
  key === "overview" || key === "logs"
    ? [`${key}.read`]
    : [`${key}.read`, `${key}.write`],
);
export type AccessProfile = {
  permissions: string[];
  roles: { id: string; name: string }[];
  grants: {
    kind: "challenge" | "contest";
    id: string;
    permissions: string[];
  }[];
};
const includes = (keys: string[], key: string) =>
  keys.includes(key) ||
  (key.endsWith(".read") && keys.includes(key.replace(/\.read$/, ".write")));
export function can(
  user: Pick<User, "role" | "access"> | null | undefined,
  key: string,
  scope?: string,
) {
  if (!user) return false;
  if (user.role === "admin") return true; // Existing administrators are the built-in superadministrator role.
  if (includes(user.access?.permissions ?? [], key)) return true;
  const kind = key.startsWith("challenges.") ? "challenge" : "contest";
  return (
    !!scope &&
    !!user.access?.grants.some(
      (g) => g.kind === kind && g.id === scope && includes(g.permissions, key),
    )
  );
}
export function allowedIds(user: User, key: string): string[] | null {
  if (can(user, key)) return null;
  return (user.access?.grants ?? [])
    .filter((g) => includes(g.permissions, key))
    .map((g) => g.id);
}
export function anyAccess(user: User, key: string) {
  return can(user, key) || !!allowedIds(user, key)?.length;
}
export function requireAccess(user: User, key: string, scope?: string) {
  if (!can(user, key, scope)) fail(403, "没有此操作的权限");
}
// Route names, never URL strings or user-controlled prefixes. Unmapped management routes fail closed.
export function authorizeManagement(req: FastifyRequest, user: User) {
  if (user.role === "admin") return;
  const route = req.routeOptions.url ?? "",
    params = req.params as Record<string, string>;
  const read =
    ["GET", "HEAD"].includes(req.method) ||
    route.endsWith("/search") ||
    route === "/api/admin/flag-template/preview";
  const action = read ? "read" : "write";
  if (
    route === "/api/admin/traffic/contests" &&
    anyAccess(user, "traffic.read")
  )
    return;
  if (route === "/api/admin/teams" && anyAccess(user, "contests.read")) return;
  if (
    route === "/api/admin/images/status" &&
    anyAccess(user, "challenges.read")
  )
    return;
  if (route === "/api/admin/images/pull" && anyAccess(user, "challenges.write"))
    return;
  if (
    route === "/api/admin/images/pulls/:id" &&
    anyAccess(user, "challenges.read")
  )
    return;
  let area: string | undefined,
    scope: string | undefined,
    list = false;
  if (route.startsWith("/api/admin/challenges")) {
    area = "challenges";
    scope = params.id;
    list = !scope && read;
    if (list && anyAccess(user, "contests.read")) return; // The list query additionally restricts related challenges.
  } else if (route.startsWith("/api/admin/contests")) {
    area = route.includes("/traffic") ? "traffic" : "contests";
    scope = params.id;
    list = !scope && read;
  } else if (route === "/api/admin/flag-template/preview") {
    area = "challenges";
    list = true;
  } else if (route.startsWith("/api/admin/settings/")) {
    area = (
      {
        site: "settings",
        containers: "containers",
        mail: "mail",
        welcome: "messages",
        traffic: "traffic",
      } as Record<string, string>
    )[params.section ?? "mail"];
  } else {
    const section = route.split("/")[3];
    area = (
      {
        overview: "overview",
        resources: "resources",
        images: "images",
        users: "users",
        submissions: "logs",
        audit: "logs",
        articles: "content",
        learning: "content",
        trees: "content",
        problemsets: "content",
        help: "content",
        traffic: "traffic",
        announcements: "announcements",
        notifications: "messages",
        messages: "messages",
        "ai-routes": "ai",
        ai: "ai",
      } as Record<string, string>
    )[section ?? ""];
  }
  if (
    !area ||
    !(list
      ? anyAccess(user, `${area}.${action}`)
      : can(user, `${area}.${action}`, scope))
  )
    fail(403, "没有此操作的权限");
}

// Materialized profile: ordinary authenticated requests keep a single indexed session lookup.
// Every access mutation updates profiles in the same transaction; no stale permission cache.
export async function refreshAccess(db: DB, users: string[]) {
  if (!users.length) return;
  await db.query(
    `UPDATE users u SET access_profile=jsonb_build_object(
    'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id),'[]'::jsonb),
    'permissions',coalesce((SELECT jsonb_agg(DISTINCT p.key) FROM user_roles ur JOIN roles r ON r.id=ur.role_id CROSS JOIN LATERAL jsonb_array_elements_text(r.permissions) p(key) WHERE ur.user_id=u.id),'[]'::jsonb),
    'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.target_id,'permissions',g.permissions) ORDER BY g.kind,g.target_id) FROM user_grants g WHERE g.user_id=u.id),'[]'::jsonb)
  ) WHERE u.id=ANY($1::uuid[])`,
    [users],
  );
}
