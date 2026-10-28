import { useSiteSettings, defaultSite } from "@/lib/site-settings";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Clock3,
  Code2,
  Flag,
  GitBranch,
  ChevronDown,
  Menu,
  Terminal,
  Server,
  Trophy,
  Users,
} from "lucide-react";
import { useAPI } from "@/lib/api";
import { useContestCapabilities } from "@/lib/contest-access";
import type { Contest, Instance, User } from "@/lib/types";
import { date } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ContestFooterStatus } from "./contest-footer-status";
import { PhaseCards } from "./contest-timing";
import type { Phase } from "@/lib/competition";
import { QueryState } from "./shared";

const control =
  "h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent";
function FooterPanel({
  label,
  trigger,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={control} aria-label={label}>
          {trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label={label}
        className="w-72 max-w-[calc(100vw-1.5rem)] rounded-lg p-4 shadow-lg"
      >
        <h2 className="mb-3 text-sm font-medium">{label}</h2>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function PlatformSummary() {
  const [open, setOpen] = useState(false);
  // Reuse home-page data; an unopened status panel never starts extra requests.
  const stats = useAPI<{
    challenges: number;
    contests: number;
    teams: number;
    solves: number;
  }>("/stats", open, open ? 60000 : undefined);
  return (
    <FooterPanel
      label="平台概况"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <Activity className="size-3.5" />
          <span className="hidden sm:inline">
            {stats.data && !stats.error
              ? `${stats.data.challenges} 道练习题`
              : "平台概况"}
          </span>
        </>
      }
    >
      {stats.error || !stats.data ? (
        <QueryState
          loading={stats.isLoading}
          error={stats.error}
          retry={() => void stats.refetch()}
        />
      ) : (
        <nav aria-label="平台数据" className="grid gap-1">
          {[
            {
              label: "练习题目",
              value: stats.data.challenges,
              href: "/challenges",
            },
            {
              label: "当前赛事",
              value: stats.data.contests,
              href: "/contests",
            },
            { label: "战队", value: stats.data.teams, href: "/team" },
            {
              label: "练习解题记录",
              value: stats.data.solves,
              href: "/scoreboard",
            },
          ].map((row) => (
            <Link
              key={row.href}
              to={row.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium tabular-nums">{row.value}</span>
            </Link>
          ))}
        </nav>
      )}
    </FooterPanel>
  );
}

function ResourceSummary({ scope, href }: { scope: string; href: string }) {
  const [open, setOpen] = useState(false);
  const resources = useAPI<{ items: Instance[] }>(
    `/instances?scope=${scope}&owned=true`,
    open,
    open ? 10000 : undefined,
  );
  const rows = resources.data?.items.filter((row) => !row.shared) ?? [];
  const running = rows.filter(
    (row) =>
      row.status === "running" &&
      row.kind !== "dynamic_attachment" &&
      row.kind !== "terminal",
  ).length;
  const terminals = rows.filter(
    (row) => row.kind === "terminal" && row.status === "running",
  ).length;
  const ready = rows.filter(
    (row) => row.status === "ready" && row.kind === "dynamic_attachment",
  ).length;
  const pending = rows.filter((row) =>
    ["queued", "starting", "stopping"].includes(row.status),
  ).length;
  const failed = rows.filter((row) => row.status === "failed").length;
  return (
    <FooterPanel
      label="我的环境"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <>
          <Server className="size-3.5" />
          <span className="hidden sm:inline">
            {resources.data && !resources.error
              ? `靶机 ${running}`
              : "我的环境"}
          </span>
        </>
      }
    >
      {resources.error || !resources.data ? (
        <QueryState
          loading={resources.isLoading}
          error={resources.error}
          retry={() => void resources.refetch()}
        />
      ) : (
        <dl className="grid gap-3 text-sm">
          {[
            ["运行靶机", running],
            ...(terminals ? [["终端", terminals]] : []),
            ["就绪附件", ready],
            ["处理中", pending],
            ["创建失败", failed],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Button variant="secondary" className="mt-4 w-full" asChild>
        <Link to={href} onClick={() => setOpen(false)}>
          管理环境
        </Link>
      </Button>
    </FooterPanel>
  );
}

function ContestSummary({
  contest,
  receivedAt,
}: {
  contest: Contest;
  receivedAt: number;
}) {
  const [open, setOpen] = useState(false);
  const timing = useAPI<{ phases: Phase[] }>(
    `/contests/${contest.id}/timing`,
    open &&
      !!contest.registered &&
      Object.values(contest.timing ?? {}).some((p) => p.mode !== "inherit"),
    open ? 15000 : undefined,
  );
  const review = contest.registration?.status;
  const registration =
    review === "pending"
      ? "待审核"
      : review === "rejected"
        ? "未通过"
        : review === "suspended"
          ? "已暂停"
          : contest.registered
            ? "已报名"
            : "未报名";
  return (
    <FooterPanel
      label="比赛信息"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <ContestFooterStatus contest={contest} receivedAt={receivedAt} />
      }
    >
      <p className="mb-4 break-words font-medium">{contest.title}</p>
      <dl className="grid gap-3 text-sm">
        {[
          ["参赛状态", registration],
          ...(contest.registration?.team_name
            ? [["战队", contest.registration.team_name]]
            : []),
          ...(contest.registration?.group_name
            ? [["组别", contest.registration.group_name]]
            : []),
          ["报名战队", String(contest.teams ?? 0)],
          ...(contest.clock?.rounds
            ? [["每轮时长", `${contest.clock.rounds.interval} 秒`]]
            : []),
          ["开始", date(contest.starts_at)],
          ["结束", date(contest.ends_at)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="break-words text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {timing.data && (
        <div className="mt-4 border-t pt-4">
          <PhaseCards scope={contest.id} phases={timing.data.phases} compact />
        </div>
      )}
      <Button variant="secondary" className="mt-4 w-full" asChild>
        <Link to={`/contests/${contest.id}`} onClick={() => setOpen(false)}>
          比赛概览
        </Link>
      </Button>
    </FooterPanel>
  );
}

function FooterClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      if (!document.hidden) setNow(Date.now());
      timer = setTimeout(refresh, 60000 - (Date.now() % 60000));
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const value = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap tabular-nums"
      aria-label={`本地时间 ${value}`}
      title="设备本地时间"
    >
      <Clock3 className="size-3.5" />
      <span className="hidden md:inline">本地时间</span>
      <time dateTime={new Date(now).toISOString()}>{value}</time>
    </span>
  );
}

export function SiteFooter({
  contestId,
  user,
}: {
  contestId?: string;
  user: User | null;
}) {
  const site = useSiteSettings(false).data ?? defaultSite;
  const { pathname, search, hash } = useLocation();
  const practiceResources = /^\/(challenges|instances|problemsets)(\/|$)/.test(
    pathname,
  );
  // The header owns this query. The footer observes it without another fetch.
  const contest = useAPI<Contest>(`/contests/${contestId}`, false);
  const current = contestId && !contest.error ? contest.data : undefined;
  const access = useContestCapabilities(current, user, contest.dataUpdatedAt);
  const announcements = contestId
    ? `/contests/${contestId}/announcements`
    : "/announcements";
  const shortcuts = contestId
    ? [
        { href: `/contests/${contestId}`, label: "比赛概览", icon: Trophy },
        {
          href: `/contests/${contestId}/scoreboard`,
          label: "排行榜",
          icon: Trophy,
        },
        ...(access.challenges
          ? [
              {
                href: `/contests/${contestId}/challenges`,
                label: "赛题",
                icon: Flag,
              },
            ]
          : []),
      ]
    : [
        { href: "/problemsets", label: "题单", icon: Flag },
        { href: "/library", label: "知识库", icon: BookOpen },
        { href: "/learning", label: "技能树", icon: GitBranch },
        ...(user ? [{ href: "/team", label: "我的战队", icon: Users }] : []),
      ];
  const navigation = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={control} aria-label="页脚导航">
          {contestId && <Menu className="size-3.5" />}
          {contestId ? "比赛菜单" : "链接"}
          {!contestId && <ChevronDown className="size-3" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-48"
      >
        <DropdownMenuItem asChild>
          <Link to={announcements}>
            <BookOpen />
            公告
          </Link>
        </DropdownMenuItem>
        {shortcuts.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link to={href}>
              <Icon />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        {!contestId && (
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/yemaster/nebuctf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Code2 />
              项目源码
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const registration = user ? current?.registration : undefined;
  const teamPath = registration?.team_id
    ? `/team?${new URLSearchParams({ team: registration.team_id, next: pathname + search + hash })}`
    : undefined;
  return (
    <footer
      aria-label="平台状态栏"
      className="h-9 shrink-0 bg-card text-xs text-muted-foreground"
    >
      <div className="mx-auto flex h-full max-w-[1680px] items-center gap-4 px-3 sm:px-6 lg:px-10">
        <nav
          aria-label="底部信息与链接"
          className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2"
        >
          {site.footer_link_url && site.footer_link_label && (
            <Button variant="ghost" className={`${control} max-w-36`} asChild>
              <a
                href={site.footer_link_url}
                target="_blank"
                rel="noopener noreferrer"
                title={site.footer_link_label}
              >
                <span className="truncate">{site.footer_link_label}</span>
              </a>
            </Button>
          )}
          {contestId ? (
            current && (
              <ContestSummary
                key={contestId}
                contest={current}
                receivedAt={contest.dataUpdatedAt}
              />
            )
          ) : (
            <PlatformSummary />
          )}
          {contestId && navigation}
          {user && (contestId ? access.instances : practiceResources) && (
            <ResourceSummary
              key={`${user.id}:${contestId ?? "practice"}`}
              scope={contestId ?? "practice"}
              href={
                contestId ? `/contests/${contestId}/instances` : "/instances"
              }
            />
          )}
          {!contestId && navigation}
          {teamPath && registration?.team_name && (
            <Button
              variant="ghost"
              className={`${control} min-w-0 max-w-64`}
              asChild
            >
              <Link
                to={teamPath}
                aria-label={`管理战队 ${registration.team_name}`}
                title={`管理战队 ${registration.team_name}${registration.group_name ? ` / ${registration.group_name}` : ""}`}
              >
                <Users className="size-3.5" />
                <span className="truncate">{registration.team_name}</span>
                {registration.group_name && (
                  <Badge
                    variant="secondary"
                    className="max-w-24 shrink-0 px-1.5 py-0 text-[10px] font-normal"
                  >
                    <span className="truncate">{registration.group_name}</span>
                  </Badge>
                )}
              </Link>
            </Button>
          )}
        </nav>
        <nav
          aria-label="常驻工具"
          className="ml-auto flex shrink-0 items-center gap-3"
        >
          {user && (
            <Button variant="ghost" className={control} asChild>
              <Link to="/terminal" target="_blank" rel="noopener noreferrer">
                <Terminal className="size-3.5" />
                终端
              </Link>
            </Button>
          )}
          <FooterClock />
          <span
            className="max-w-48 truncate"
            title={site.footer_text || site.name}
          >
            {site.footer_text || `${site.name} © ${new Date().getFullYear()}`}
          </span>
        </nav>
      </div>
    </footer>
  );
}
