import { useSiteSettings, defaultSite } from "@/lib/site-settings";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAPI } from "@/lib/api";
import type { Announcement, Contest } from "@/lib/types";
import { contestStatus, date } from "@/lib/utils";
import {
  ContestCalendar,
  contestDayFilter,
} from "@/components/contest-calendar";
import { ContestCard } from "@/components/contest-card";
import { Button } from "@/components/ui/button";
import { Empty, QueryState } from "@/components/shared";
export function Home() {
  const site = useSiteSettings().data ?? defaultSite;
  const [day, setDay] = useState<Date>();
  const [recentWindow] = useState(() => {
    const today = Math.floor(Date.now() / 86400000) * 86400000;
    return `&from=${encodeURIComponent(new Date(today - 7 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(today + 35 * 86400000).toISOString())}`;
  });
  const announcements = useAPI<{ items: Announcement[] }>("/announcements");
  const contests = useAPI<{ items: Contest[] }>(
    `/contests?page=1${day ? contestDayFilter(day) : recentWindow}`,
  );
  const stats = useAPI<{
    challenges: number;
    contests: number;
    teams: number;
    solves: number;
    activity: { username: string; title: string; created_at: string }[];
  }>("/stats");
  const recent = contests.data?.items
    .slice()
    .sort((a, b) => {
      const ongoing = (c: Contest) =>
        contestStatus(c) === "进行中"
          ? 0
          : contestStatus(c) === "即将开始"
            ? 1
            : 2;
      return (
        ongoing(a) - ongoing(b) ||
        (ongoing(a) === 1
          ? Date.parse(a.starts_at) - Date.parse(b.starts_at)
          : Date.parse(b.starts_at) - Date.parse(a.starts_at))
      );
    })
    .slice(0, 4);
  if (announcements.error || announcements.isLoading)
    return (
      <QueryState
        loading={announcements.isLoading}
        error={announcements.error}
        retry={() => void announcements.refetch()}
        fullPage
      />
    );
  const pageError = announcements.error || contests.error || stats.error;
  if (pageError)
    return (
      <QueryState
        loading={false}
        error={pageError}
        retry={() => {
          void announcements.refetch();
          void contests.refetch();
          void stats.refetch();
        }}
        fullPage
      />
    );
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <h1 className="text-3xl font-semibold">{site.name}</h1>
        <div className="flex gap-7 text-sm text-muted-foreground">
          {stats.data && (
            <>
              <Link to="/challenges" className="hover:text-foreground">
                <span className="mr-2 font-medium text-foreground">
                  {stats.data.challenges}
                </span>
                道练习题
              </Link>
              <Link to="/contests" className="hover:text-foreground">
                <span className="mr-2 font-medium text-foreground">
                  {stats.data.contests}
                </span>
                场赛事
              </Link>
            </>
          )}
        </div>
      </header>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">公告栏</h2>
            <QueryState
              loading={announcements.isLoading}
              error={announcements.error}
              retry={() => void announcements.refetch()}
            />
            <div className="space-y-3">
              {announcements.data?.items.slice(0, 3).map((a) => (
                <Link
                  key={a.id}
                  to={`/announcements#announcement-${a.id}`}
                  className="group block rounded-xl bg-card p-5 shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring dark:shadow-black/20 sm:p-6"
                >
                  <h3 className="text-base font-medium leading-7">{a.title}</h3>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {a.body}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <time>{date(a.created_at)}</time>
                    <span className="flex items-center gap-2">
                      查看公告
                      <ArrowRight className="size-4" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            {announcements.data?.items.length === 0 && <Empty>暂无公告</Empty>}
            <Button variant="ghost" asChild className="w-full">
              <Link to="/announcements">
                全部公告
                <ArrowRight />
              </Link>
            </Button>
          </section>
          <section className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">
                {day ? day.toLocaleDateString("zh-CN") : "近期比赛"}
              </h2>
              {day ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDay(undefined)}
                >
                  全部日期
                </Button>
              ) : (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/contests">
                    比赛大厅
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
            <QueryState
              loading={contests.isLoading}
              error={contests.error}
              retry={() => void contests.refetch()}
            />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-5">
              {recent?.map((c) => (
                <ContestCard key={c.id} contest={c} />
              ))}
            </div>
            {recent?.length === 0 && <Empty>暂无比赛</Empty>}
          </section>
        </div>
        <aside className="min-w-0 space-y-8">
          <ContestCalendar day={day} onSelect={setDay} />
          <section className="space-y-5 px-2">
            <h2 className="text-lg font-medium">解题动态</h2>
            <QueryState
              loading={stats.isLoading}
              error={stats.error}
              retry={() => void stats.refetch()}
            />
            {stats.data?.activity.map((a, i) => (
              <div className="space-y-1 text-sm" key={`${a.created_at}-${i}`}>
                <p className="break-words">
                  <span className="font-medium">{a.username}</span>
                  <span className="ml-2 text-muted-foreground">
                    解出了 {a.title}
                  </span>
                </p>
                <time className="text-xs text-muted-foreground">
                  {date(a.created_at)}
                </time>
              </div>
            ))}
            {stats.data?.activity.length === 0 && <Empty>暂无解题记录</Empty>}
          </section>
        </aside>
      </div>
    </div>
  );
}
