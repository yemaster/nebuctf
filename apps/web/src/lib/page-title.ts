import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

type Lookup = (
  path: string,
  prefix?: boolean,
) => { title?: string; name?: string } | undefined;
const pages: Record<string, string> = {
  "/": "首页",
  "/challenges": "题库",
  "/contests": "比赛",
  "/problemsets": "题单",
  "/announcements": "公告",
  "/scoreboard": "排行榜",
  "/library": "知识库",
  "/learning": "技能树",
  "/team": "我的战队",
  "/team/new": "创建或加入战队",
  "/instances": "我的靶机",
  "/terminal": "终端",
  "/login": "登录",
  "/register": "注册",
  "/account": "我的账户",
};
const admin: Record<string, string> = {
  overview: "概览",
  settings: "系统配置",
  containers: "容器策略",
  mail: "邮件策略",
  ai: "AI 转发",
  challenges: "题目",
  contests: "比赛",
  problemsets: "题单",
  articles: "文档",
  learning: "技能树",
  announcements: "公告",
  resources: "资源",
  images: "Docker 镜像",
  users: "用户",
  submissions: "提交",
  audit: "审计",
};
const competition: Record<string, string> = {
  challenges: "赛题",
  scoreboard: "排行榜",
  announcements: "公告",
  instances: "我的靶机",
  spectate: "观战",
  writeup: "WriteUp",
};
const management: Record<string, string> = {
  teams: "报名战队",
  writeups: "WriteUp 管理",
  activity: "比赛动态",
  integrity: "作弊审查",
  settings: "比赛设置",
};
export function pageTitle(
  pathname: string,
  search: string,
  lookup: Lookup,
): string {
  const path = pathname.replace(/\/$/, "") || "/",
    params = new URLSearchParams(search);
  const [, area, id, section, sub] = path.split("/");
  const challenge = params.get("challenge");
  if (area === "challenges" && challenge)
    return lookup(`/challenges/${challenge}?scope=practice`)?.title ?? "题目";
  if (area === "contests" && id) {
    const name =
      lookup(`/contests/${id}`)?.title ??
      lookup(`/admin/contests/${id}`)?.title;
    const label =
      section === "challenges" && challenge
        ? (lookup(`/challenges/${challenge}?scope=${id}`)?.title ?? "赛题")
        : section === "manage"
          ? (management[sub ?? "teams"] ?? "比赛管理")
          : (competition[section ?? ""] ?? "比赛概览");
    return name ? (section ? `${label} - ${name}` : name) : label;
  }
  if (area === "admin") {
    if (!id) return "管理中心";
    const label = admin[id];
    if (!label) return "页面不存在";
    if (section === "new") return `新建${label}`;
    if (sub === "edit") {
      const resource =
        id === "ai" ? "ai-routes" : id === "learning" ? "learning/trees" : id;
      const item = lookup(`/admin/${resource}/${section}`);
      return item?.title || item?.name
        ? `编辑${label} - ${item.title ?? item.name}`
        : `编辑${label}`;
    }
    if (id === "contests" && sub === "manage")
      return `比赛管理${lookup(`/admin/contests/${section}`)?.title ? ` - ${lookup(`/admin/contests/${section}`)!.title}` : ""}`;
    return `${label}管理`.replace(/(配置|策略|转发|概览|审计)管理$/, "$1");
  }
  if (area === "problemsets" && id)
    return lookup(`/problemsets/${id}?`, true)?.title ?? "题单";
  if (area === "library" && id)
    return lookup(`/articles/${id}`)?.title ?? "文档";
  if (area === "learning" && id)
    return lookup(`/learning/trees/${id}`)?.title ?? "技能树";
  if (area === "terminal" && params.get("target"))
    return `${lookup(`/terminal/targets/${params.get("target")}`)?.title ?? "靶机"} - 终端`;
  if (area === "account")
    return (
      (
        {
          profile: "账户资料",
          security: "账户安全",
          submissions: "提交记录",
        } as Record<string, string>
      )[params.get("section") ?? ""] ?? "我的账户"
    );
  return pages[path] ?? "页面不存在";
}

export function useDocumentTitle(siteName: string) {
  const { pathname, search } = useLocation();
  const cache = useQueryClient();
  const subscribe = useCallback(
    (callback: () => void) => cache.getQueryCache().subscribe(callback),
    [cache],
  );
  const snapshot = useCallback(
    () =>
      pageTitle(pathname, search, (key, prefix) =>
        prefix
          ? (cache.getQueryCache().findAll({
              predicate: (q) => String(q.queryKey[0]).startsWith(key),
            })[0]?.state.data as ReturnType<Lookup>)
          : cache.getQueryData([key]),
      ),
    [cache, pathname, search],
  );
  const title = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    document.title = `${title} - ${siteName}`;
  }, [title, siteName]);
}
