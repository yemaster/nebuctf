import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function endpointURL(endpoint: string) {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(endpoint) ? endpoint : `http://${endpoint}`,
    );
    if (
      ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    )
      return parsed.href;
  } catch {
    // Invalid endpoints remain copyable, never executable.
  }
  return undefined;
}
export const date = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(s))
    : "—";
export const kindNames: Record<string, string> = {
  static_attachment: "静态附件",
  dynamic_attachment: "动态附件",
  static_container: "公共环境",
  dynamic_container: "独立环境",
};
export const statusNames: Record<string, string> = {
  queued: "排队中",
  starting: "创建中",
  running: "运行中",
  ready: "附件就绪",
  stopping: "回收中",
  stopped: "已停止",
  failed: "创建失败",
};
export const contestStatus = (c: { starts_at: string; ends_at: string }) =>
  Date.now() < Date.parse(c.starts_at)
    ? "即将开始"
    : Date.now() >= Date.parse(c.ends_at)
      ? "已结束"
      : "进行中";

export function safeLocalPath(
  value: string | null | undefined,
  fallback = "/",
) {
  if (!value || !/^\/(?![\/\\])[^\\\u0000-\u0020]*$/.test(value))
    return fallback;
  return value;
}
export function contextualActionPath(href: string) {
  const parsed = new URL(href, "https://nebuctf.invalid");
  const scope = parsed.searchParams.get("scope");
  return parsed.pathname === "/instances" &&
    scope &&
    /^[0-9a-f-]{36}$/i.test(scope)
    ? `/contests/${scope}/instances`
    : href;
}
