import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReducedMotion, m, AnimatePresence } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Radio,
  LockKeyhole,
  WifiOff,
  ArrowLeft,
  Flag,
  Swords,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useSpectatorRealtime } from "@/lib/spectator-realtime";
import {
  eventLabel,
  activeEngagements,
  SpectatorEvents,
  type SpectatorData,
  type SpectatorTeam,
  type SpectatorEvent,
} from "@/lib/spectator";
import { Button } from "@/components/ui/button";
import { BloodMark } from "@/components/blood-mark";
import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Loading, QueryState } from "@/components/shared";
import { ContestClockLine } from "@/components/contest-clock";
const ArenaScene = lazy(() => import("@/components/spectator/arena-scene"));
const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const number = new Intl.NumberFormat("zh-CN");

export function ContestSpectator() {
  const { id } = useParams();
  return <Spectator key={id} scope={id!} />;
}
function Spectator({ scope }: { scope: string }) {
  const feed = useSpectatorRealtime(scope),
    reduced = !!useReducedMotion();
  const [paused, setPaused] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === screen.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const expand = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (screen.current?.requestFullscreen)
        await screen.current.requestFullscreen();
      else toast.error("当前浏览器不支持全屏，请使用浏览器全屏快捷键");
    } catch {
      toast.error("无法进入全屏，请使用浏览器全屏快捷键");
    }
  };
  if (feed.isLoading || feed.error || !feed.data)
    return (
      <QueryState
        loading={feed.isLoading}
        error={feed.error}
        retry={feed.retry}
        fullPage
      />
    );
  const data = feed.data,
    ended = Date.parse(data.contest.ends_at) <= Date.now();
  return (
    <div
      ref={screen}
      className="flex h-full min-h-0 flex-col bg-background"
      data-spectator-screen
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {fullscreen && (
            <Button asChild variant="ghost" size="icon" aria-label="返回比赛">
              <Link to={`/contests/${scope}`}>
                <ArrowLeft />
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {data.contest.title}
            </h1>
            {data.clock && <ContestClockLine clock={data.clock} />}
          </div>
          <Badge variant="secondary">
            {!data.started
              ? "等待开赛"
              : data.frozen
                ? "已封榜"
                : ended
                  ? "比赛结束"
                  : "比赛进行中"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            {data.frozen ? (
              <LockKeyhole className="size-3.5" />
            ) : feed.status === "live" ? (
              <Radio className="size-3.5 text-success" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            {feed.status === "live"
              ? "实时连接"
              : feed.status === "connecting"
                ? "连接中"
                : "重连中"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "继续动效" : "暂停动效"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={fullscreen ? "退出全屏" : "全屏观战"}
            onClick={() => void expand()}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 overflow-y-auto border-t lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside
          className="order-2 flex min-h-0 flex-col bg-card lg:order-first lg:overflow-y-auto lg:border-r"
          aria-label="观战数据"
        >
          <Leaderboard scope={scope} groups={data.groups} reduced={reduced} />
          <EventFeed
            events={data.events}
            frozen={data.frozen}
            started={data.started}
            reduced={reduced}
          />
        </aside>
        <section
          className="relative min-h-[420px] overflow-hidden lg:min-h-0"
          aria-label="比赛三维态势"
        >
          <CityView
            data={data}
            live={feed.status === "live"}
            paused={paused}
            reduced={reduced}
          />
        </section>
      </div>
    </div>
  );
}
function Leaderboard({
  scope,
  groups,
  reduced,
}: {
  scope: string;
  groups: SpectatorData["groups"];
  reduced: boolean;
}) {
  const [page, setPage] = useState(1),
    [group, setGroup] = useState(""),
    [cycling, setCycling] = useState(!reduced),
    [hovered, setHovered] = useState(false);
  const path = `/contests/${scope}/spectate/ranking?page=${page}${group ? `&group=${group}` : ""}`;
  const ranking = useQuery({
    queryKey: [path, group],
    queryFn: ({ signal }) =>
      api<{ items: SpectatorTeam[]; total: number; page: number }>(
        path,
        "GET",
        undefined,
        signal,
      ),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === group ? previous : undefined,
  });
  const pages = Math.max(1, Math.ceil((ranking.data?.total ?? 0) / 10));
  useEffect(() => {
    if (page > pages && ranking.data && !ranking.isPlaceholderData)
      setPage(pages);
  }, [page, pages, ranking.data, ranking.isPlaceholderData]);
  useEffect(() => {
    if (!cycling || hovered || pages <= 1 || ranking.isLoading || ranking.error)
      return;
    const timer = setInterval(() => {
      if (!document.hidden) setPage((p) => (p % pages) + 1);
    }, 8000);
    return () => clearInterval(timer);
  }, [cycling, hovered, pages, ranking.isLoading, ranking.error]);
  return (
    <section
      className="shrink-0 px-4 pb-3 pt-4"
      aria-label="轮播排行榜"
      aria-busy={ranking.isFetching}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHovered(false);
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">排行榜</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={cycling ? "暂停排行轮播" : "开启排行轮播"}
          aria-pressed={cycling}
          onClick={() => setCycling(!cycling)}
        >
          {cycling ? <Pause /> : <Play />}
        </Button>
      </div>
      {!!groups.length && (
        <NativeSelect
          className="mb-2 h-8 w-full"
          aria-label="观战排名组别"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setPage(1);
          }}
        >
          {[{ id: "", name: "全局排名" }, ...groups].map((g) => (
            <NativeSelectOption key={g.id} value={g.id}>
              {g.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      {ranking.error || ranking.isLoading ? (
        <div className="flex min-h-64 items-center justify-center">
          <QueryState
            loading={ranking.isLoading}
            error={ranking.error}
            retry={() => void ranking.refetch()}
          />
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <m.ol
            key={`${group}:${ranking.data?.page ?? page}`}
            initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="min-h-64 space-y-0.5"
          >
            {ranking.data?.items.map((team) => (
              <li key={team.id}>
                <div className="flex h-8 items-center gap-3 rounded-md px-2 text-sm">
                  <span
                    className={`w-5 shrink-0 text-right tabular-nums ${team.rank <= 3 ? "text-primary font-semibold" : "text-muted-foreground"}`}
                  >
                    {team.rank}
                  </span>
                  <span className="truncate" title={team.name}>
                    {team.name}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {number.format(team.score)}
                  </span>
                </div>
              </li>
            ))}
            {!ranking.data?.items.length && (
              <li className="py-16 text-center text-sm text-muted-foreground">
                暂无参赛战队
              </li>
            )}
          </m.ol>
        </AnimatePresence>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{ranking.data?.total ?? 0} 支战队</span>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="上一页排名"
            disabled={page <= 1 || ranking.isPlaceholderData}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="下一页排名"
            disabled={page >= pages || ranking.isPlaceholderData}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </section>
  );
}
function EventFeed({
  events,
  frozen,
  started,
  reduced,
}: {
  events: SpectatorEvent[];
  frozen: boolean;
  started: boolean;
  reduced: boolean;
}) {
  return (
    <section
      className="flex min-h-56 flex-1 flex-col border-t lg:min-h-40"
      aria-label="解题与攻防动态"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-semibold">比赛动态</h2>
        {frozen && <LockKeyhole className="size-4 text-muted-foreground" />}
      </div>
      <ol
        className="min-h-0 space-y-1 overflow-y-auto px-4 pb-4"
        aria-live="off"
      >
        {events.map((event) => {
          const Icon =
            event.type === "attack"
              ? Swords
              : event.type === "solve"
                ? Flag
                : Bell;
          return (
            <m.li
              key={event.id}
              layout={!reduced}
              initial={false}
              transition={{ duration: reduced ? 0 : 0.24 }}
              className="flex items-start gap-3 py-2.5"
            >
              {event.blood_rank ? (
                <BloodMark rank={event.blood_rank} className="mt-1 size-4" />
              ) : (
                <Icon
                  className={`mt-1 size-4 shrink-0 ${event.type === "attack" ? "text-destructive" : "text-primary"}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className="text-xs font-medium">
                    {eventLabel(event)}
                  </span>
                  <time
                    dateTime={event.created_at}
                    className="text-xs tabular-nums text-muted-foreground"
                  >
                    {clock.format(new Date(event.created_at))}
                  </time>
                </div>
                <p className="mt-1 truncate text-sm font-medium">
                  {event.team_name ?? event.challenge_title}
                  {event.target_team_name ? ` → ${event.target_team_name}` : ""}
                </p>
                {event.team_name && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {event.challenge_title}
                    {event.part_title ? ` / ${event.part_title}` : ""}
                  </p>
                )}
              </div>
            </m.li>
          );
        })}
        {!events.length && (
          <li className="py-10 text-center text-sm text-muted-foreground">
            {started ? "暂无比赛动态" : "比赛尚未开始"}
          </li>
        )}
      </ol>
    </section>
  );
}

function CityView({
  data,
  live,
  paused,
  reduced,
}: {
  data: SpectatorData;
  live: boolean;
  paused: boolean;
  reduced: boolean;
}) {
  const [now, setNow] = useState(Date.now()),
    [index, setIndex] = useState(0),
    [notice, setNotice] = useState<SpectatorEvent | null>(null);
  const ledger = useRef(new SpectatorEvents()),
    expires = useRef(0);
  useEffect(() => {
    const fresh = ledger.current.ingest(data.events, live);
    if (!data.frozen && !paused) {
      const solved = fresh.find(
        (e) => e.type === "solve" || e.type === "attack",
      );
      if (solved) {
        setNotice(solved);
        expires.current = Date.now() + 6500;
      }
    }
    if (!live || data.frozen) setNotice(null);
  }, [data.events, data.frozen, live, paused]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (expires.current && Date.now() >= expires.current) {
        setNotice(null);
        expires.current = 0;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (paused || reduced) return;
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => i + 1);
    }, 7000);
    return () => clearInterval(timer);
  }, [paused, reduced]);
  const engagements = live ? activeEngagements(data, now) : [],
    engagement = engagements.length
      ? engagements[index % engagements.length]
      : null;
  const focus = notice?.challenge_id ?? engagement?.challenge_id ?? null;
  return (
    <>
      <Suspense fallback={<Loading fullPage />}>
        <ArenaScene
          data={data}
          live={live}
          paused={paused}
          reduced={reduced}
          focus={focus}
        />
      </Suspense>
      <dl className="pointer-events-none absolute inset-x-0 top-5 flex justify-center gap-6 px-4 text-slate-50 sm:gap-10 lg:top-7">
        {[
          ["战队", data.stats.teams],
          ["题目", data.stats.challenges],
          ["解题", data.stats.solves],
          ...(data.stats.attacks ? [["攻破", data.stats.attacks]] : []),
        ].map(([label, value]) => (
          <div key={label} className="text-center">
            <dd className="text-2xl font-semibold tabular-nums sm:text-3xl">
              {number.format(Number(value))}
            </dd>
            <dt className="mt-1 text-xs text-slate-300">{label}</dt>
          </div>
        ))}
      </dl>
      <div
        className="pointer-events-none absolute inset-x-5 bottom-6 flex justify-center"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence mode="wait" initial={false}>
          {notice ? (
            <m.div
              key={notice.id}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.24 }}
              className="max-w-xl rounded-lg bg-slate-950/90 px-6 py-4 text-center text-sm text-slate-100 shadow-lg"
            >
              <span className="mr-3 font-medium text-amber-300">
                {eventLabel(notice)}
              </span>
              <span>{notice.team_name}</span>
              <span className="mx-2">
                {notice.type === "attack" ? "攻破" : "解出"}
              </span>
              <span className="font-medium text-cyan-200">
                {notice.challenge_title}
                {notice.part_title ? ` / ${notice.part_title}` : ""}
              </span>
            </m.div>
          ) : engagement ? (
            <m.div
              key={engagement.challenge_id}
              initial={{ opacity: 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.24 }}
              className="max-w-xl rounded-lg bg-slate-950/90 px-6 py-3 text-center text-sm leading-6 text-slate-200 shadow-lg"
            >
              <span className="font-medium text-cyan-200">
                {engagement.challenge_title}
              </span>{" "}
              正在被{" "}
              <span className="font-medium text-white">
                {engagement.teams.map((t) => t.name).join("、")}
              </span>{" "}
              攻打
            </m.div>
          ) : data.frozen ? (
            <m.div
              key="frozen"
              className="flex items-center gap-2 text-xs text-slate-300"
            >
              <LockKeyhole className="size-3.5" />
              封榜期间显示冻结赛况
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}
