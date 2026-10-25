import { Link, useLocation } from "react-router-dom";
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
import { ThemeSettings } from "./theme-provider";
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
const navigationClass = (selected = false) =>
  cn(
    "h-11 rounded-lg px-4 text-base has-[>svg]:px-4 transition-[background-color,color,box-shadow] duration-150 data-[state=open]:bg-accent data-[state=open]:text-foreground data-[state=open]:shadow-md",
    selected
      ? "bg-accent text-foreground shadow-md shadow-black/10 hover:bg-accent dark:shadow-black/25 dark:hover:bg-accent"
      : "text-muted-foreground hover:text-foreground",
  );

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
      <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-2 px-3 sm:px-6 lg:gap-4 lg:px-10">
        {contestId && (
          <Button
            variant="ghost"
            asChild
            className="size-11 shrink-0 rounded-lg p-0 2xl:w-auto 2xl:px-4"
          >
            <Link to="/contests">
              <ArrowLeft />
              <span className="hidden 2xl:inline">返回大厅</span>
              <span className="sr-only 2xl:hidden">返回大厅</span>
            </Link>
          </Button>
        )}
        <Sheet key={pathname}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-11 rounded-lg",
                contestId ? "xl:hidden" : "lg:hidden",
              )}
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
            <nav aria-label="移动端导航" className="grid gap-2 px-4 pb-6">
              {(contestId
                ? [...items, ...management]
                : [...items, ...learning, secondary[0]!]
              ).map((item) => (
                <SheetClose asChild key={item.to}>
                  <Button
                    variant="ghost"
                    asChild
                    className={cn(
                      navigationClass(active(item.to)),
                      "h-12 justify-start",
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
              ? "flex-1 text-base xl:flex-none xl:max-w-40 2xl:max-w-64"
              : "text-lg sm:text-xl lg:mr-2 xl:mr-6",
          )}
        >
          {title}
        </Link>
        <nav
          aria-label={contestId ? "比赛导航" : "主导航"}
          className={cn(
            "shrink-0 items-center gap-1 xl:gap-2",
            contestId ? "hidden xl:flex" : "hidden lg:flex",
          )}
        >
          {items.map((item) => (
            <Button
              key={item.to}
              variant="ghost"
              asChild
              className={navigationClass(active(item.to))}
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
                  variant="ghost"
                  className={navigationClass(
                    management.some((m) => active(m.to)),
                  )}
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
                  className={navigationClass(
                    learning.some((item) => active(item.to)),
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
          <ThemeSettings />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-11 rounded-lg px-3 text-base has-[>svg]:px-3 data-[state=open]:bg-accent data-[state=open]:shadow-md"
                  aria-label="账户菜单"
                >
                  <UserRound className="size-5" />
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
              <Button
                variant="ghost"
                className={cn(
                  navigationClass(pathname === "/login"),
                  "px-2 text-sm sm:px-4 sm:text-base",
                )}
                asChild
              >
                <Link
                  aria-current={pathname === "/login" ? "page" : undefined}
                  to={
                    contestId
                      ? `/login?next=${encodeURIComponent(pathname + search)}`
                      : "/login"
                  }
                >
                  登录
                </Link>
              </Button>
              <Button
                variant="ghost"
                className={cn(
                  navigationClass(pathname === "/register"),
                  "px-2 text-sm sm:px-4 sm:text-base",
                )}
                asChild
              >
                <Link
                  aria-current={pathname === "/register" ? "page" : undefined}
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
