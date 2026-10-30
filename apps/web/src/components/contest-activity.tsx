import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity,
  BellRing,
  FlagOff,
  CheckCircle2,
  ChevronUp,
  Flag,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { useContestRealtime } from "@/lib/contest-realtime";
import { useAPI } from "@/lib/api";
import type { Contest, User } from "@/lib/types";
import { useContestCapabilities } from "@/lib/contest-access";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { BloodMark } from "./blood-mark";
import { Card } from "./ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { Loading, Pagination } from "./shared";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

export interface ContestEvent {
  id: string;
  type: "release" | "solve" | "withdraw" | "hint";
  challenge_id: string;
  challenge_title: string;
  part_title: string | null;
  team_name: string | null;
  blood_rank: number | null;
  created_at: string;
}
export interface ContestActivityData {
  permissions_version?: string;
  items: ContestEvent[];
  frozen: boolean;
  has_more?: boolean;
  next_cursor?: string | null;
  hint_updates?: {
    id: string;
    challenge_id: string;
    challenge_title: string;
    created_at: string;
  }[];
}
type ActivityKind = "all" | "solve" | "blood" | "challenge";
const time = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function ContestActivity({
  scope,
  user,
  hidden = false,
}: {
  scope: string;
  user: User | null;
  hidden?: boolean;
}) {
  const location = useLocation(),
    [params] = useSearchParams();
  const paper =
    location.pathname.endsWith("/challenges") &&
    params.get("challenge") === "objective";
  const contest = useAPI<Contest>(`/contests/${scope}`);
  const access = useContestCapabilities(
    contest.data,
    user,
    contest.dataUpdatedAt,
  );
  if (!access.activity || !user) return null;
  return (
    <ActivityPanel
      key={`${scope}:${user.id}`}
      scope={scope}
      userId={user.id}
      canOpen={access.challenges}
      hidden={hidden}
      paper={paper}
    />
  );
}
function ActivityPanel({
  scope,
  userId,
  canOpen,
  hidden,
  paper,
}: {
  scope: string;
  userId: string;
  canOpen: boolean;
  hidden: boolean;
  paper: boolean;
}) {
  const key = `nebuctf-activity:${userId}:${scope}`;
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(() => {
    if (paper) return false;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored === "open";
    } catch {}
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
    );
  });
  useEffect(() => {
    if (paper) setOpen(false);
  }, [paper]);
  const data = useContestRealtime(scope);
  const [kind, setKind] = useState<ActivityKind>("all");
  const [paging, setPaging] = useState({ page: 1, cursors: [""] });
  const scroll = useRef<HTMLDivElement>(null);
  const latest = kind === "all" && paging.page === 1;
  const historyParams = new URLSearchParams({ kind });
  const cursor = paging.cursors[paging.page - 1];
  if (cursor) historyParams.set("cursor", cursor);
  const history = useAPI<ContestActivityData>(
    `/contests/${scope}/activity/history?${historyParams}`,
    open && !hidden && !latest,
  );
  const feed = latest ? data : history;
  const feedKey = `${kind}:${cursor ?? ""}`;
  const previous = useRef<{ key: string; data: ContestActivityData } | null>(
    null,
  );
  // Keep the last category during a short switch, never after an access reset
  // of the same query or a failed request.
  const retained =
    feed.isLoading && previous.current?.key !== feedKey
      ? previous.current?.data
      : undefined;
  const items = (feed.data ?? retained)?.items ?? [];
  const previousIds =
    previous.current?.key === feedKey
      ? new Set(previous.current.data.items.map((event) => event.id))
      : null;
  useEffect(() => {
    if (feed.data && !feed.error)
      previous.current = { key: feedKey, data: feed.data };
    else if (feed.error || previous.current?.key === feedKey)
      previous.current = null;
  }, [feed.data, feed.error, feedKey]);
  function scrollTop() {
    scroll.current
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
      ?.scrollTo?.({ top: 0, behavior: "instant" });
  }
  function firstPage() {
    setPaging({ page: 1, cursors: [""] });
    setUnread(0);
    scrollTop();
  }
  function changePage(page: number) {
    if (page === paging.page) return;
    if (page > paging.page) {
      if (!feed.data?.next_cursor) return;
      setPaging({
        page,
        cursors: [
          ...paging.cursors.slice(0, paging.page),
          feed.data.next_cursor,
        ],
      });
    } else {
      setPaging({ ...paging, page });
    }
    scrollTop();
  }
  const seen = useRef<Set<string> | null>(null);
  const [unread, setUnread] = useState(0);
  const [newHints, setNewHints] = useState(0);
  const hintSeen = useRef<string | null>(null);
  const knownHints = useRef(new Set<string>());
  useEffect(() => {
    if (!data.data) return;
    const updates =
      data.data.hint_updates ??
      data.data.items.filter((e) => e.type === "hint");
    if (hintSeen.current === null) {
      try {
        hintSeen.current = localStorage.getItem(key + ":hints");
      } catch {}
      if (!hintSeen.current) {
        hintSeen.current =
          updates.reduce(
            (latest, h) => (h.created_at > latest ? h.created_at : latest),
            "",
          ) || "1970-01-01T00:00:00.000Z";
      }
    }
    try {
      if (!localStorage.getItem(key + ":hints"))
        localStorage.setItem(key + ":hints", hintSeen.current!);
    } catch {}
    const fresh = updates.filter(
      (h) => h.created_at > hintSeen.current! && !knownHints.current.has(h.id),
    );
    for (const hint of updates) knownHints.current.add(hint.id);
    if (open && paging.page === 1) {
      setNewHints(0);
      hintSeen.current = updates.reduce(
        (latest, h) => (h.created_at > latest ? h.created_at : latest),
        hintSeen.current!,
      );
      try {
        localStorage.setItem(key + ":hints", hintSeen.current);
      } catch {}
    } else if (fresh.length) setNewHints((n) => Math.min(99, n + fresh.length));
  }, [data.data, open, key, paging.page]);
  useEffect(() => {
    if (!data.data) return;
    const ids = new Set(data.data.items.map((item) => item.id));
    const added = seen.current
      ? [...ids].filter((id) => !seen.current!.has(id)).length
      : 0;
    if (open && paging.page === 1) setUnread(0);
    else if (added) setUnread((value) => Math.min(99, value + added));
    seen.current = new Set([...(seen.current ?? []), ...ids].slice(-1000));
  }, [data.data, open, paging.page]);
  function toggle(value: boolean) {
    setOpen(value);
    if (value && paging.page === 1) {
      setUnread(0);
      setNewHints(0);
    }
    try {
      localStorage.setItem(key, value ? "open" : "closed");
    } catch {}
  }
  return (
    <Collapsible open={open} onOpenChange={toggle} asChild>
      <m.div
        aria-label="比赛动态"
        initial={false}
        animate={{ width: open ? 384 : paper ? 48 : newHints ? 288 : 224 }}
        transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed right-2 bottom-12 z-30 max-w-[calc(100vw-1rem)] ${hidden ? "invisible" : ""}`}
      >
        <Card className="gap-0 overflow-hidden py-0 shadow-lg">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className={`relative h-12 w-full gap-3 rounded-xl ${paper && !open ? "justify-center px-0" : "justify-start px-4"}`}
              aria-label={open ? "收起比赛动态" : "展开比赛动态"}
              title={paper && !open ? "比赛动态" : undefined}
            >
              {newHints && !open ? (
                <BellRing className="text-warning motion-safe:animate-pulse" />
              ) : (
                <Activity className="text-muted-foreground" />
              )}
              <span className={paper && !open ? "sr-only" : undefined}>
                比赛动态
              </span>
              {data.data?.frozen && !(paper && !open) && (
                <LockKeyhole
                  className="size-3.5 text-muted-foreground"
                  aria-label="已封榜"
                />
              )}
              {newHints > 0 && !open && !paper && (
                <Badge
                  variant="secondary"
                  className="text-warning"
                  aria-label={`${newHints} 条新提示`}
                >
                  新提示 {newHints}
                </Badge>
              )}
              {unread > 0 && !(paper && !open) && (
                <Badge
                  aria-label={`${unread} 条新动态`}
                  className="motion-safe:animate-in motion-safe:zoom-in-75"
                >
                  {unread === 99 ? "99+" : unread}
                </Badge>
              )}
              {paper && !open ? (
                (newHints > 0 || unread > 0) && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 size-2 rounded-full bg-primary"
                  />
                )
              ) : (
                <ChevronUp
                  className={`ml-auto shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-300 ${open ? "rotate-180" : ""}`}
                />
              )}
            </Button>
          </CollapsibleTrigger>
          <span role="status" className="sr-only">
            {newHints > 0
              ? `${newHints} 条新题目提示，请展开比赛动态查看`
              : unread > 0
                ? `${unread} 条新比赛动态`
                : ""}
          </span>
          <CollapsibleContent forceMount asChild>
            <m.div
              initial={false}
              animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
              transition={{
                height: {
                  duration: reduced ? 0 : 0.28,
                  ease: [0.22, 1, 0.36, 1],
                },
                opacity: {
                  duration: reduced ? 0 : 0.16,
                  delay: open && !reduced ? 0.08 : 0,
                },
              }}
              inert={!open || undefined}
              aria-hidden={!open || undefined}
              className="overflow-hidden"
            >
              <Tabs
                value={kind}
                onValueChange={(value) => {
                  setKind(value as ActivityKind);
                  firstPage();
                }}
                className="gap-0"
              >
                <div className="px-4 pt-1">
                  <TabsList
                    variant="line"
                    className="w-full"
                    aria-label="动态分类"
                  >
                    {(
                      [
                        ["all", "全部"],
                        ["solve", "解题"],
                        ["blood", "三血"],
                        ["challenge", "题目"],
                      ] as const
                    ).map(([value, label]) => (
                      <TabsTrigger key={value} value={value} className="flex-1">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <TabsContent
                  value={kind}
                  className="mt-0 motion-safe:data-[state=active]:animate-none"
                >
                  <ActivityLoading pending={feed.isLoading}>
                    <ScrollArea ref={scroll} className="h-full">
                      {data.status === "retrying" && (
                        <p
                          role="status"
                          className="px-4 pt-3 text-xs text-muted-foreground"
                        >
                          连接中断，正在重连
                        </p>
                      )}
                      {feed.error && (
                        <div
                          role="alert"
                          className="flex h-80 max-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-sm text-muted-foreground"
                        >
                          <span>动态更新失败</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void feed.refetch()}
                          >
                            重试
                          </Button>
                        </div>
                      )}
                      <ul aria-label="近期比赛动态" className="px-4 pb-3">
                        {!feed.error &&
                          items.map((event) => {
                            const blood = event.blood_rank
                              ? ["一血", "二血", "三血"][event.blood_rank - 1]
                              : null;
                            const Icon =
                              event.type === "hint"
                                ? BellRing
                                : event.type === "withdraw"
                                  ? FlagOff
                                  : event.type === "release"
                                    ? Flag
                                    : CheckCircle2;
                            return (
                              <li
                                key={event.id}
                                className={`relative flex gap-3 py-3 ${!feed.isLoading && previousIds && !previousIds.has(event.id) ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-300" : ""}`}
                              >
                                {blood ? (
                                  <BloodMark
                                    rank={event.blood_rank!}
                                    className="mt-1 size-4"
                                  />
                                ) : (
                                  <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                                )}
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                    <span>
                                      {blood ? (
                                        <Badge variant="secondary">
                                          {blood}
                                        </Badge>
                                      ) : (
                                        {
                                          release: "题目上线",
                                          withdraw: "题目下线",
                                          hint: "新增提示",
                                          solve: "新解出",
                                        }[event.type]
                                      )}
                                    </span>
                                    <time
                                      dateTime={event.created_at}
                                      title={new Date(
                                        event.created_at,
                                      ).toLocaleString("zh-CN")}
                                      className="tabular-nums"
                                    >
                                      {time.format(new Date(event.created_at))}
                                    </time>
                                  </div>
                                  <p className="break-words text-sm leading-6">
                                    {event.type === "solve" && (
                                      <>
                                        <span className="font-medium">
                                          {event.team_name}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {" "}
                                          解出{" "}
                                        </span>
                                      </>
                                    )}
                                    {canOpen && event.type !== "withdraw" ? (
                                      <Link
                                        className="rounded-sm underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                                        to={`/contests/${scope}/challenges?challenge=${event.challenge_id}`}
                                      >
                                        {event.challenge_title}
                                        {event.part_title
                                          ? ` / ${event.part_title}`
                                          : ""}
                                      </Link>
                                    ) : (
                                      <span>
                                        {event.challenge_title}
                                        {event.part_title
                                          ? ` / ${event.part_title}`
                                          : ""}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                      </ul>
                      {!feed.isLoading && !feed.error && !items.length && (
                        <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                          暂无比赛动态
                        </p>
                      )}
                    </ScrollArea>
                  </ActivityLoading>
                  <div className="flex items-center gap-2 border-t px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label="查看最新动态"
                      title="查看最新动态"
                      disabled={paging.page === 1 && !unread}
                      onClick={firstPage}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                    <div className="min-w-0 flex-1 [&>div]:mt-0">
                      <Pagination
                        page={paging.page}
                        setPage={changePage}
                        hasMore={!!feed.data?.has_more}
                        disabled={feed.isFetching || !!feed.error}
                        compact
                        alwaysShow
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </m.div>
          </CollapsibleContent>
        </Card>
      </m.div>
    </Collapsible>
  );
}

// A fixed viewport and one overlay avoid shrinking the panel or remounting its
// scroll area between cached, fast, slow and failed reads.
function ActivityLoading({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [indicator, setIndicator] = useState(false);
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    if (pending && shownAt.current !== null) return;
    const timer = setTimeout(
      () => {
        shownAt.current = pending ? Date.now() : null;
        setIndicator(pending);
      },
      pending ? 120 : Math.max(0, 240 - (Date.now() - (shownAt.current ?? 0))),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  const waiting = pending || indicator;
  return (
    <div
      className="relative h-80 max-h-[50dvh] overflow-hidden"
      aria-busy={waiting}
      data-activity-viewport
    >
      <div
        className="h-full motion-safe:transition-opacity motion-safe:duration-150"
        inert={waiting || undefined}
        aria-hidden={waiting || undefined}
        style={{ opacity: pending && !indicator ? 0.6 : 1 }}
      >
        {children}
      </div>
      <AnimatePresence initial={false}>
        {indicator && (
          <m.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 bg-card"
            data-activity-loading
          >
            <Loading variant="activity" immediate />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
