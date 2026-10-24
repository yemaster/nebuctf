import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  GitBranch,
  LogOut,
  Menu,
  Server,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAPI } from "@/lib/api";
import type { Contest, User } from "@/lib/types";
import { useContestCapabilities } from "@/lib/contest-access";
import { cn } from "@/lib/utils";
import { ThemeMenu } from "./theme-provider";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

const primary = [
  { to: "/challenges", name: "练习" },
  { to: "/contests", name: "比赛" },
  { to: "/problemsets", name: "题单" },
  { to: "/scoreboard", name: "排行" },
];
const learning = [
  { to: "/library", name: "知识库", icon: BookOpen },
  { to: "/learning", name: "技能树", icon: GitBranch },
];
const secondary = [
  { to: "/announcements", name: "公告" },
  { to: "/library", name: "知识库" },
];
const account = [
  { to: "/team", name: "我的战队", icon: Users },
  { to: "/instances", name: "我的靶机", icon: Server },
  { to: "/account", name: "账户设置", icon: UserRound },
];

export function SiteHeader({
  user,
  onLogout,
  loggingOut,
  contestId,
}: {
  user: User | null;
  onLogout: () => void;
  loggingOut: boolean;
  contestId?: string;
}) {
  const { pathname, search } = useLocation();
  const contest = useAPI<Contest>(`/contests/${contestId}`, !!contestId);
  const base = `/contests/${contestId}`;
  const access = useContestCapabilities(contest.data, user);
  const [arenaPaths, setArenaPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!contestId || pathname !== `${base}/challenges`) return;
    setArenaPaths((previous) =>
      previous[contestId] === pathname + search
        ? previous
        : { ...previous, [contestId]: pathname + search },
    );
  }, [contestId, base, pathname, search]);
  const items = contestId
    ? [
        { to: base, name: "概览" },
        { to: `${base}/announcements`, name: "公告" },
        ...(access.challenges
          ? [
              {
                to: arenaPaths[contestId] ?? `${base}/challenges`,
                name: "赛题",
              },
            ]
          : []),
        { to: `${base}/scoreboard`, name: "排行榜" },
        ...(contest.data?.writeup_access
          ? [{ to: `${base}/writeup`, name: "WriteUp" }]
          : []),

        ...(access.instances
          ? [{ to: `${base}/instances`, name: "靶机" }]
          : []),
      ]
    : primary;
  const management =
    contestId && user?.role === "admin"
      ? [
          { to: `${base}/manage/teams`, name: "报名战队" },
          { to: `${base}/manage/activity`, name: "比赛动态" },
          { to: `${base}/manage/integrity`, name: "作弊线索" },
          { to: `${base}/manage/writeups`, name: "WriteUp 管理" },
          {
            to: `/admin/contests/${contestId}/edit?return=${encodeURIComponent(pathname + search)}`,
            name: "比赛设置",
          },
        ]
      : [];
  const title = contestId ? (contest.data?.title ?? "比赛") : "NebuCTF";
  const active = (to: string) => {
    const path = to.split("?")[0];
    return (
      pathname === path || (path !== base && pathname.startsWith(`${path}/`))
    );
  };
  return (
    <header
      className="relative z-40 shrink-0 bg-card"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        {contestId && (
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link to="/contests">
              <ArrowLeft />
              <span className="hidden xl:inline">返回大厅</span>
              <span className="sr-only xl:hidden">返回大厅</span>
            </Link>
          </Button>
        )}
        <Sheet key={pathname}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={contestId ? "lg:hidden" : "md:hidden"}
              aria-label="打开导航"
            >
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            aria-describedby={undefined}
            className="overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
            <nav aria-label="移动端导航" className="grid gap-1 px-4 pb-6">
              {(contestId
                ? [...items, ...management]
                : [...items, ...learning, secondary[0]!]
              ).map((item) => (
                <SheetClose asChild key={item.to}>
                  <Button
                    variant="ghost"
                    asChild
                    className={cn(
                      "h-11 justify-start",
                      active(item.to) && "bg-accent",
                    )}
                  >
                    <Link
                      to={item.to}
                      aria-current={active(item.to) ? "page" : undefined}
                    >
                      {item.name}
                    </Link>
                  </Button>
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
        <Link
          to={contestId ? base : "/"}
          title={title}
          className={cn(
            "min-w-0 truncate rounded-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            contestId
              ? "flex-1 text-base lg:flex-none lg:max-w-40 xl:max-w-64"
              : "mr-4 shrink-0 text-xl",
          )}
        >
          {title}
        </Link>
        <nav
          aria-label={contestId ? "比赛导航" : "主导航"}
          className={cn(
            "items-center gap-1",
            contestId ? "hidden lg:flex" : "hidden md:flex",
          )}
        >
          {items.map((item) => (
            <Button
              key={item.to}
              variant={active(item.to) ? "secondary" : "ghost"}
              size="sm"
              asChild
              className="px-3"
            >
              <Link
                to={item.to}
                aria-current={active(item.to) ? "page" : undefined}
              >
                {item.name}
              </Link>
            </Button>
          ))}
          {management.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={
                    management.some((m) => active(m.to)) ? "secondary" : "ghost"
                  }
                  size="sm"
                >
                  管理
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {management.map((m) => (
                  <DropdownMenuItem key={m.to} asChild>
                    <Link to={m.to}>{m.name}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!contestId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    learning.some((item) => active(item.to)) && "bg-accent",
                  )}
                  aria-label="学习菜单"
                >
                  学习
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {learning.map((item) => (
                  <DropdownMenuItem asChild key={item.to}>
                    <Link
                      to={item.to}
                      aria-current={active(item.to) ? "page" : undefined}
                    >
                      <item.icon />
                      {item.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeMenu />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="账户菜单">
                  <UserRound />
                  <span className="hidden max-w-28 truncate md:block">
                    {user.username}
                  </span>
                  <ChevronDown className="hidden md:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="truncate">
                  {user.username}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {account.map((item) => (
                  <DropdownMenuItem asChild key={item.to}>
                    <Link to={item.to}>
                      <item.icon />
                      {item.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {user.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin">
                      <Settings />
                      管理中心
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={loggingOut} onSelect={onLogout}>
                  <LogOut />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to={
                    contestId
                      ? `/login?next=${encodeURIComponent(pathname + search)}`
                      : "/login"
                  }
                >
                  登录
                </Link>
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link
                  to={
                    contestId
                      ? `/register?next=${encodeURIComponent(pathname + search)}`
                      : "/register"
                  }
                >
                  注册
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ contestId }: { contestId?: string }) {
  const links = contestId
    ? [
        { to: `/contests/${contestId}/announcements`, name: "公告" },
        { to: `/contests/${contestId}`, name: "规则" },
      ]
    : secondary;
  return (
    <footer className="flex min-h-10 shrink-0 items-center justify-between gap-4 px-4 text-xs text-muted-foreground sm:px-6">
      <span className="whitespace-nowrap">
        © {new Date().getFullYear()} NebuCTF
      </span>
      <nav aria-label="页脚导航" className="flex items-center gap-1">
        {links.map((item) => (
          <Button
            key={item.to}
            variant="ghost"
            size="sm"
            className="text-xs font-normal"
            asChild
          >
            <NavLink to={item.to}>{item.name}</NavLink>
          </Button>
        ))}
      </nav>
    </footer>
  );
}
