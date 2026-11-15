import { z } from "zod";
import type { User } from "./context.js";
import type { DB } from "./db.js";
import { digest, fail } from "./security.js";
import { defaults, getSetting } from "./settings.js";

export const API_KEY_LIMIT = 20;
export interface ApiKeyEndpoint {
  method: string;
  path: string;
  summary: string;
}
export interface ApiKeyScope {
  id: string;
  name: string;
  description: string;
  endpoints: ApiKeyEndpoint[];
}
const endpoint = (
  method: string,
  path: string,
  summary: string,
): ApiKeyEndpoint => ({ method, path, summary });
const get = (path: string, summary: string) => endpoint("GET", path, summary);
const post = (path: string, summary: string) => endpoint("POST", path, summary);
const put = (path: string, summary: string) => endpoint("PUT", path, summary);
const del = (path: string, summary: string) =>
  endpoint("DELETE", path, summary);
const scope = (
  id: string,
  name: string,
  description: string,
  endpoints: ApiKeyEndpoint[],
): ApiKeyScope => ({ id, name, description, endpoints });

// This is an exact registered-template allowlist, not a URL-prefix permission map.
// Writes never implicitly grant reads; handlers retain all account/domain ACL checks.
export const apiKeyScopes: ApiKeyScope[] = [
  scope("profile:read", "个人资料：读取", "读取当前账户与个人资料、头像。", [
    get("/api/me", "当前账户"),
    get("/api/account/profile", "个人资料"),
    get("/api/avatars/:id", "读取头像"),
  ]),
  scope(
    "profile:write",
    "个人资料：修改",
    "修改个人资料与头像，不包括密码或安全设置。",
    [
      put("/api/account/profile", "修改个人资料"),
      post("/api/account/avatar", "上传头像"),
      del("/api/account/avatar", "删除头像"),
    ],
  ),
  scope(
    "challenges:read",
    "题目：读取",
    "读取有权访问的题目、题单与站点统计。",
    [
      get("/api/challenges", "题目列表"),
      get("/api/challenges/:id", "题目详情"),
      get("/api/problemsets", "题单列表"),
      get("/api/problemsets/:id", "题单详情"),
      get("/api/stats", "站点统计"),
    ],
  ),
  scope(
    "submissions:read",
    "提交：读取",
    "读取自己的提交记录、客观题作答与试卷。",
    [
      get("/api/submissions", "提交记录"),
      get("/api/challenges/:id/answer", "客观题作答"),
      get("/api/contests/:id/objective-paper", "客观题试卷"),
    ],
  ),
  scope(
    "submissions:write",
    "提交：写入",
    "提交 Flag、客观题答案或解锁提示，仍受比赛规则与次数限制。",
    [
      post("/api/challenges/:id/submit", "提交 Flag"),
      post("/api/challenges/:id/answer", "提交客观题答案"),
      post("/api/contests/:id/objective-paper", "提交客观题试卷"),
      post("/api/challenges/:id/hints/:hintId/unlock", "解锁题目提示"),
    ],
  ),
  scope(
    "resources:read",
    "资源：读取",
    "读取可访问的环境、配额、附件与生成产物。",
    [
      get("/api/instances", "环境列表"),
      get("/api/challenges/:id/instance-policy", "环境操作策略"),
      get("/api/attachments/:id", "下载题目附件"),
      get("/api/instances/:id/artifact", "下载环境产物"),
    ],
  ),
  scope(
    "resources:write",
    "资源：操作",
    "创建、停止或续期有权操作的题目环境，不含终端连接。",
    [
      post("/api/challenges/:id/instances", "创建题目环境"),
      post("/api/instances/:id/stop", "停止环境"),
      post("/api/instances/:id/renew", "续期环境"),
    ],
  ),
  scope(
    "contests:read",
    "比赛：读取",
    "读取可见比赛、日历、公告、动态与观赛快照。",
    [
      get("/api/contests", "比赛列表"),
      get("/api/contests/calendar", "比赛日历"),
      get("/api/contests/:id", "比赛详情"),
      get("/api/contests/:id/poster", "比赛海报"),
      get("/api/announcements", "公告列表"),
      get("/api/contests/:id/activity", "比赛动态"),
      get("/api/contests/:id/activity/history", "比赛历史动态"),
      get("/api/contests/:id/spectate", "观赛快照"),
      get("/api/contests/:id/spectate/ranking", "观赛排名"),
    ],
  ),
  scope(
    "contests:register",
    "比赛：报名",
    "以当前账户身份报名或取消报名，保留队长及报名审核限制。",
    [
      post("/api/contests/:id/register", "报名比赛"),
      post("/api/contests/:id/unregister", "取消报名"),
    ],
  ),
  scope(
    "scoreboard:read",
    "排行榜：读取",
    "读取有权查看的排行榜与参赛者成绩。",
    [
      get("/api/scoreboard", "排行榜"),
      get("/api/scoreboard/:participant", "参赛者成绩"),
    ],
  ),
  scope("teams:read", "队伍：读取", "读取自己的队伍、成员与队徽。", [
    get("/api/team", "队伍详情"),
    get("/api/teams/mine", "我的队伍"),
    get("/api/team-logos/:id", "读取队徽"),
  ]),
  scope(
    "teams:write",
    "队伍：管理",
    "创建、加入或离开队伍，管理邀请、队长与队徽。",
    [
      post("/api/teams", "创建队伍"),
      post("/api/team/join", "加入队伍"),
      post("/api/team/invite", "更新队伍邀请"),
      post("/api/team/leave", "离开队伍"),
      post("/api/team/captain", "转让队长"),
      post("/api/teams/:id/logo", "上传队徽"),
      del("/api/teams/:id/logo", "删除队徽"),
    ],
  ),
  scope(
    "content:read",
    "学习内容：读取",
    "读取文章、帮助、学习树与自己的赛后题解。",
    [
      get("/api/articles/categories", "文章分类"),
      get("/api/articles", "文章列表"),
      get("/api/articles/:slug", "文章详情"),
      get("/api/learning/trees", "学习树列表"),
      get("/api/learning/trees/:id", "学习树详情与进度"),
      get("/api/help", "帮助列表"),
      get("/api/help/:slug", "帮助详情"),
      get("/api/contests/:id/writeup", "我的比赛题解"),
      get("/api/contests/:id/writeup/file", "下载我的题解"),
    ],
  ),
  scope("content:write", "学习内容：写入", "记录文章完成情况与提交比赛题解。", [
    post("/api/articles/:id/complete", "标记文章完成"),
    post("/api/contests/:id/writeup", "提交比赛题解"),
  ]),
  scope("notifications:read", "通知：读取", "读取当前账户通知及未读汇总。", [
    get("/api/notifications/summary", "通知汇总"),
    get("/api/notifications", "通知列表"),
    get("/api/notifications/:id", "通知详情"),
  ]),
  scope(
    "notifications:write",
    "通知：处理",
    "更新自己的通知状态或批量标为已读。",
    [
      put("/api/notifications/read-all", "批量标记已读"),
      put("/api/notifications/:id", "更新通知状态"),
    ],
  ),
  scope("defense:read", "攻防：读取", "读取攻防轮次、竞技场与补丁记录。", [
    get("/api/challenges/:id/rounds", "攻防轮次记录"),
    get("/api/challenges/:id/arena", "AWD 竞技场"),
    get("/api/challenges/:id/patches", "防御补丁记录"),
  ]),
  scope(
    "defense:write",
    "攻防：操作",
    "提交攻击 Flag、上传防御补丁或重启 AWD 环境。",
    [
      post("/api/challenges/:id/attack", "提交攻击 Flag"),
      post("/api/challenges/:id/patches", "上传防御补丁"),
      post("/api/challenges/:id/restart", "重启 AWD 环境"),
    ],
  ),
  scope(
    "admin:challenges:read",
    "管理题目：读取",
    "读取账户管理权限内的题目与附件，不授予额外后台权限。",
    [
      get("/api/admin/challenges", "管理题目列表"),
      post("/api/admin/challenges/search", "搜索管理题目"),
      get("/api/admin/challenges/:id", "管理题目详情"),
      get("/api/admin/attachments/:id", "下载管理附件"),
      post("/api/admin/flag-template/preview", "预览 Flag 模板"),
    ],
  ),
  scope(
    "admin:challenges:write",
    "管理题目：写入",
    "创建、修改或发布权限范围内的题目及附件。",
    [
      post("/api/admin/challenges", "创建题目"),
      put("/api/admin/challenges/:id", "修改题目"),
      post("/api/admin/challenges/:id/publication", "更新题目发布状态"),
      post("/api/admin/challenges/:id/attachments", "上传题目附件"),
      del("/api/admin/attachments/:id", "删除题目附件"),
    ],
  ),
  scope(
    "admin:contests:read",
    "管理比赛：读取",
    "读取有权管理的比赛、报名、题解与比赛监控记录。",
    [
      get("/api/admin/contests", "管理比赛列表"),
      get("/api/admin/contests/:id", "管理比赛详情"),
      get("/api/admin/teams", "报名队伍查询"),
      get("/api/admin/contests/:id/registrations", "比赛报名列表"),
      get("/api/admin/contests/:id/registrations/:team", "队伍报名详情"),
      get("/api/admin/contests/:id/activity", "比赛活动日志"),
      get("/api/admin/contests/:id/integrity", "比赛异常事件"),
      get("/api/admin/contests/:id/integrity/:event", "异常事件详情"),
      get(
        "/api/admin/contests/:id/integrity/:event/reviews",
        "异常事件复核记录",
      ),
      get("/api/admin/contests/:id/writeups", "比赛题解列表"),
      get("/api/admin/contests/:id/writeups/archive", "导出比赛题解"),
      get("/api/admin/contests/:id/writeups/:team", "队伍题解详情"),
      get("/api/admin/contests/:id/writeups/:team/file", "下载队伍题解"),
    ],
  ),
  scope(
    "admin:contests:write",
    "管理比赛：写入",
    "修改有权管理的比赛、报名审核、异常复核与题解评审。",
    [
      post("/api/admin/contests", "创建比赛"),
      put("/api/admin/contests/:id", "修改比赛"),
      put("/api/admin/contests/:id/registrations", "审核比赛报名"),
      put("/api/admin/contests/:id/integrity/:event", "复核异常事件"),
      put("/api/admin/contests/:id/writeups/:team", "评审队伍题解"),
      post("/api/admin/contests/:id/poster", "上传比赛海报"),
      del("/api/admin/contests/:id/poster", "删除比赛海报"),
    ],
  ),
  scope(
    "admin:content:read",
    "管理内容：读取",
    "读取有权管理的文章、学习树、题单与帮助文档。",
    [
      get("/api/admin/articles", "管理文章列表"),
      get("/api/admin/articles/:id", "管理文章详情"),
      get("/api/admin/learning/trees", "管理学习树列表"),
      get("/api/admin/learning/trees/:id", "管理学习树详情"),
      get("/api/admin/problemsets", "管理题单列表"),
      get("/api/admin/problemsets/:id", "管理题单详情"),
      get("/api/admin/help", "管理帮助列表"),
      get("/api/admin/help/:id", "管理帮助详情"),
    ],
  ),
  scope(
    "admin:content:write",
    "管理内容：写入",
    "创建或修改权限内的文章、学习树、题单与帮助文档。",
    [
      post("/api/admin/articles", "创建文章"),
      put("/api/admin/articles/:id", "修改文章"),
      post("/api/admin/learning/trees", "创建学习树"),
      put("/api/admin/learning/trees/:id", "修改学习树"),
      post("/api/admin/problemsets", "创建题单"),
      put("/api/admin/problemsets/:id", "修改题单"),
      post("/api/admin/help", "创建帮助文档"),
      put("/api/admin/help/:id", "修改帮助文档"),
      del("/api/admin/help/:id", "删除帮助文档"),
    ],
  ),
  scope(
    "admin:announcements:read",
    "管理公告：读取",
    "读取账户权限内的公告。",
    [
      get("/api/admin/announcements", "管理公告列表"),
      get("/api/admin/announcements/:id", "管理公告详情"),
    ],
  ),
  scope(
    "admin:announcements:write",
    "管理公告：写入",
    "创建或修改账户权限内的公告。",
    [
      post("/api/admin/announcements", "创建公告"),
      put("/api/admin/announcements/:id", "修改公告"),
    ],
  ),
  scope(
    "admin:resources:read",
    "管理资源：读取",
    "读取后台环境列表，仍需资源管理权限。",
    [get("/api/admin/resources", "后台环境列表")],
  ),
  scope(
    "admin:logs:read",
    "管理日志：读取",
    "读取审计日志与提交日志，仍需日志管理权限。",
    [
      get("/api/admin/audit", "审计日志"),
      get("/api/admin/submissions", "提交日志"),
    ],
  ),
  scope(
    "admin:notifications:read",
    "管理通知：读取",
    "读取系统通知投递历史，仍需消息管理权限。",
    [get("/api/admin/notifications", "系统通知历史")],
  ),
  scope(
    "admin:notifications:write",
    "管理通知：写入",
    "发送或撤回系统通知，仍需消息管理权限。",
    [
      post("/api/admin/notifications", "发送系统通知"),
      del("/api/admin/notifications/:id", "撤回系统通知"),
    ],
  ),
];

const scopeIds = new Set(apiKeyScopes.map((entry) => entry.id));
export const apiKeyScopesInput = z
  .array(z.string().refine((id) => scopeIds.has(id), "未知的 API 权限"))
  .max(apiKeyScopes.length)
  .refine((ids) => new Set(ids).size === ids.length, "API 权限不能重复");
const legacyIdentityIds = new Set(
  defaults.api_keys.identities.map((entry) => entry.id),
);
const uuidInput = z.uuid();
export const apiKeyIdentityIdInput = z
  .string()
  .refine(
    (id) => legacyIdentityIds.has(id) || uuidInput.safeParse(id).success,
    "API 身份 ID 必须为 UUID 或受支持的旧版身份 ID",
  );
const identitiesInput = z
  .array(
    z
      .object({
        id: apiKeyIdentityIdInput,
        name: z
          .string()
          .trim()
          .min(1)
          .max(48)
          .refine(
            (value) => !/[\x00-\x1f\x7f]/.test(value),
            "名称不能包含控制字符",
          ),
        enabled: z.boolean(),
        scopes: apiKeyScopesInput,
      })
      .strict(),
  )
  .max(50)
  .refine(
    (identities) =>
      new Set(identities.map((entry) => entry.id)).size === identities.length,
    "API 身份不能重复",
  );
export const apiKeyPolicyInput = z
  .object({
    enabled: z.boolean(),
    allowed_scopes: apiKeyScopesInput,
    max_lifetime_days: z.number().int().min(1).max(365),
    identities: identitiesInput,
  })
  .strict();
export type ApiKeyPolicy = z.infer<typeof apiKeyPolicyInput>;

export async function getApiKeyPolicy(db: DB): Promise<ApiKeyPolicy> {
  const stored = await getSetting(db, "api_keys");
  return apiKeyPolicyInput.parse({
    ...stored,
    identities: stored.identities.map((identity) => ({
      ...identity,
      ...(identity.name === undefined && legacyIdentityIds.has(identity.id)
        ? {
            name: defaults.api_keys.identities.find(
              (entry) => entry.id === identity.id,
            )!.name,
          }
        : {}),
    })),
  });
}
export function availableApiKeyIdentities(policy: ApiKeyPolicy) {
  if (!policy.enabled) return [];
  const allowed = new Set(policy.allowed_scopes);
  return policy.identities.flatMap((identity) => {
    if (!identity.enabled) return [];
    const scopes = identity.scopes.filter((id) => allowed.has(id));
    return scopes.length
      ? [{ id: identity.id, name: identity.name, scopes }]
      : [];
  });
}
export function allowedApiKeyScopes(policy: ApiKeyPolicy): ApiKeyScope[] {
  if (!policy.enabled) return [];
  const allowed = new Set(policy.allowed_scopes);
  return apiKeyScopes.filter((entry) => allowed.has(entry.id));
}

const routeScopes = new Map<string, string>();
for (const entry of apiKeyScopes)
  for (const route of entry.endpoints) {
    const key = `${route.method} ${route.path}`;
    if (routeScopes.has(key))
      throw new Error(`Duplicate API-key endpoint: ${key}`);
    routeScopes.set(key, entry.id);
  }

export async function authenticateApiKey(
  db: DB,
  authorization: string,
  method: string,
  route: string,
): Promise<{ user: User; id: string }> {
  const match = /^Bearer (nebu_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match || !match[1]!.startsWith("nebu_"))
    fail(401, "API KEY 无效或已过期");
  const [principal] = await db.query<
    User & {
      api_key_id: string;
      scopes: string[];
      identity_id: string | null;
      last_used_at: Date | string | null;
    }
  >(
    `SELECT u.id,u.username,u.email,u.role,u.avatar_id,u.access_profile access,
      k.id api_key_id,k.scopes,k.identity_id,k.last_used_at
     FROM api_keys k JOIN users u ON u.id=k.user_id
     WHERE k.token_hash=$1 AND k.revoked_at IS NULL AND k.expires_at>now() AND NOT u.disabled`,
    [digest(match![1]!)],
  );
  if (!principal) fail(401, "API KEY 无效或已过期");
  const policy = await getApiKeyPolicy(db);
  const required = routeScopes.get(
    `${method === "HEAD" ? "GET" : method} ${route}`,
  );
  const identity =
    principal!.identity_id === null
      ? null
      : policy.identities.find((entry) => entry.id === principal!.identity_id);
  if (
    !policy.enabled ||
    !required ||
    !policy.allowed_scopes.includes(required) ||
    (principal!.identity_id !== null &&
      (!identity?.enabled || !identity.scopes.includes(required))) ||
    !Array.isArray(principal!.scopes) ||
    !principal!.scopes.includes(required)
  )
    fail(403, "API KEY 未获授权访问此接口");
  if (
    !principal!.last_used_at ||
    new Date(principal!.last_used_at).getTime() <= Date.now() - 60_000
  )
    await db.query(
      "UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<=now()-interval '1 minute')",
      [principal!.api_key_id],
    );
  const { id, username, email, role, avatar_id, access } = principal!;
  return {
    user: { id, username, email, role, avatar_id, access },
    id: principal!.api_key_id,
  };
}
