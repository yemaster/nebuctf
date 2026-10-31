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
  type SpectatorRanking,
  type SpectatorEvent,
} from "@/lib/spectator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Loading, QueryState } from "@/components/shared";
import { ContestClockLine } from "@/components/contest-clock";
import { SpectatorHighlightOverlay } from "@/components/spectator/highlight-overlay";
const ArenaScene = lazy(() => import("@/components/spectator/arena-scene"));
const ScoreTimeline = lazy(() =>
  import("@/components/score-timeline").then((module) => ({
    default: module.ScoreTimeline,
  })),
);
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
      className="spectator-screen dark flex h-full min-h-0 flex-col bg-background text-foreground"
      data-spectator-screen
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {fullscreen && (
            <Button asChild variant="ghost" size="icon" aria-label="返回比赛">
              <Link to={`/contests/${scope}`}>
                <ArrowLeft />
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium">
              {data.contest.title}
            </h1>
            {data.clock && <ContestClockLine clock={data.clock} />}
          </div>
          <Badge
            variant="ghost"
            className="rounded-none px-0 text-xs font-normal text-muted-foreground"
          >
            {!data.started
              ? "等待开赛"
              : data.frozen
                ? "已封榜"
                : ended
                  ? "已结束"
                  : "进行中"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="mr-1 inline-flex items-center text-muted-foreground"
            role="status"
            title={feed.status === "live" ? "实时连接" : "重新连接中"}
          >
            {data.frozen ? (
              <LockKeyhole className="size-3.5" />
            ) : feed.status === "live" ? (
              <Radio className="size-3.5 text-primary" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            <span className="sr-only">
              {feed.status === "live"
                ? "实时连接"
                : feed.status === "connecting"
                  ? "连接中"
                  : "重连中"}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={paused ? "继续动效" : "暂停动效"}
            title={paused ? "继续动效" : "暂停动效"}
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={fullscreen ? "退出全屏" : "全屏观战"}
            title={fullscreen ? "退出全屏" : "全屏观战"}
            onClick={() => void expand()}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 overflow-y-auto border-t border-primary/10 lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside
          className="order-2 flex min-h-0 flex-col bg-linear-to-r from-card to-background lg:order-first lg:overflow-hidden"
          aria-label="观战数据"
        >
          <Leaderboard scope={scope} groups={data.groups} reduced={reduced} />
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
          <span className="pointer-events-none absolute bottom-3 right-4 select-none font-mono text-xs text-slate-400/55">
            NebuCTF © {new Date().getFullYear()}
          </span>
        </section>
      </div>
      <SpectatorHighlightOverlay
        batch={feed.highlights}
        container={fullscreen ? screen.current : null}
        enabled={feed.status === "live" && !paused && !data.frozen && !ended}
        reduced={reduced}
      />
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
      api<SpectatorRanking>(path, "GET", undefined, signal),
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
    <>
      <section
        className="flex min-h-0 shrink-0 flex-col px-5 pb-3 pt-4 lg:h-[58%]"
        aria-label="轮播排行榜"
        aria-busy={ranking.isFetching}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setHovered(false);
        }}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h2 className="shrink-0 text-sm font-medium text-primary">排行榜</h2>
          <div className="flex min-w-0 items-center gap-2">
            {!!groups.length && (
              <NativeSelect
                className="h-7 max-w-36 rounded-sm border-0 bg-transparent py-0 pl-2 text-xs shadow-none dark:bg-transparent"
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
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={cycling ? "暂停排行轮播" : "开启排行轮播"}
              title={cycling ? "暂停排行轮播" : "开启排行轮播"}
              aria-pressed={cycling}
              onClick={() => setCycling(!cycling)}
            >
              {cycling ? <Pause /> : <Play />}
            </Button>
          </div>
        </div>
        {ranking.error || ranking.isLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
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
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {ranking.data?.items.map((team) => (
                <li key={team.id}>
                  <div
                    className={`flex h-9 items-center gap-3 px-2 text-sm ${team.rank <= 3 ? "bg-primary/5" : ""}`}
                  >
                    <span
                      className={`w-6 shrink-0 text-right font-mono text-xs tabular-nums ${team.rank <= 3 ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {String(team.rank).padStart(2, "0")}
                    </span>
                    <span className="truncate" title={team.name}>
                      {team.name}
                    </span>
                    <span className="ml-auto shrink-0 font-mono font-medium tabular-nums text-primary">
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
        <div className="mt-2 flex shrink-0 items-center justify-between text-xs text-muted-foreground">
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
            <span className="font-mono tabular-nums">
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
      <section
        className="mx-5 flex min-h-56 flex-1 flex-col border-t border-primary/15 pb-3 lg:min-h-0"
        aria-label="观战积分走势"
      >
        <div className="flex shrink-0 items-center justify-between py-3">
          <h2 className="text-sm font-medium text-primary">积分走势</h2>
          {ranking.data?.frozen && (
            <LockKeyhole
              className="size-3.5 text-muted-foreground"
              aria-label="积分已封榜"
            />
          )}
        </div>
        <div className="min-h-0 flex-1">
          {ranking.data ? (
            <Suspense fallback={<Loading variant="chart" className="h-full" />}>
              <ScoreTimeline key={group} board={ranking.data} compact />
            </Suspense>
          ) : ranking.error ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              积分暂不可用
            </p>
          ) : (
            <Loading variant="chart" className="h-full" />
          )}
        </div>
      </section>
    </>
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
      <Suspense fallback={<Loading variant="scene" className="h-full" />}>
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
