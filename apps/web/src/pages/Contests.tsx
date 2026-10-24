import { ContestTiming } from "@/components/contest-timing";
import { Scoreboard } from "./Scoreboard";
export { Scoreboard } from "./Scoreboard";
import { Link, Navigate, useParams } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useUser } from "@/App";
import { api, useAction, useAPI } from "@/lib/api";
import type { Contest, TeamSummary } from "@/lib/types";
import { contestStatus, date } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { ContestStatusBadge } from "@/components/contest-status-badge";
import {
  ContestCalendar,
  contestDayFilter,
} from "@/components/contest-calendar";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
} from "@/components/shared";
import { Challenges } from "./Challenges";
import { Announcements } from "./Announcements";
import { Instances } from "./Instances";
import { ContestCard } from "@/components/contest-card";
import { useContestCapabilities } from "@/lib/contest-access";
import { ContestPoster } from "@/components/contest-poster";
import { Markdown } from "@/components/markdown";
export function Contests() {
  const [page, setPage] = useState(1),
    [day, setDay] = useState<Date>();
  const data = useAPI<{ items: Contest[]; total: number }>(
    `/contests?page=${page}${contestDayFilter(day)}`,
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <PageTitle>比赛</PageTitle>
      <div
        data-card-detail="/contests"
        className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_288px]"
      >
        <section className="min-w-0">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-medium">
              {day ? day.toLocaleDateString("zh-CN") : "全部比赛"}
            </h2>
            {day && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDay(undefined);
                  setPage(1);
                }}
              >
                全部比赛
              </Button>
            )}
          </div>
          <QueryState
            loading={data.isLoading}
            error={data.error}
            retry={() => void data.refetch()}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-5">
            {data.data?.items.map((c) => (
              <ContestCard key={c.id} contest={c} />
            ))}
          </div>
          {data.data?.items.length === 0 && <Empty>暂无比赛</Empty>}
          <Pagination
            page={page}
            setPage={setPage}
            total={data.data?.total}
            hasMore={page * 24 < (data.data?.total ?? 0)}
          />
        </section>
        <aside className="min-w-0 xl:sticky xl:top-0">
          <ContestCalendar
            day={day}
            onSelect={(value) => {
              setDay(value);
              setPage(1);
            }}
          />
        </aside>
      </div>
    </>
  );
}
const contestDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function ContestDetail() {
  const { id } = useParams(),
    user = useUser(),
    [open, setOpen] = useState(false),
    [team, setTeam] = useState(""),
    [group, setGroup] = useState("");
  const data = useAPI<Contest>(`/contests/${id}`),
    teams = useAPI<{ items: TeamSummary[] }>("/teams/mine", !!user);
  const access = useContestCapabilities(data.data, user);
  const register = useAction(
    () =>
      api(`/contests/${id}/register`, "POST", {
        team_id: team,
        group_id: group || null,
      }),
    () => setOpen(false),
  );
  const unregister = useAction(() => api(`/contests/${id}/unregister`, "POST"));
  const c = data.data,
    captained =
      teams.data?.items.filter((t) => t.captain_id === user?.id) ?? [];
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {c && (
        <>
          <div
            data-card-detail={`/contests/${id}`}
            className="mx-auto w-full max-w-[1600px] space-y-10"
          >
            <Card
              aria-labelledby="contest-title"
              className="gap-0 overflow-hidden border-0 py-0 dark:shadow-black/20"
            >
              <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="flex min-w-0 flex-col gap-6 py-6 sm:py-8">
                  <CardHeader className="block px-6 sm:px-8">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <h1
                        id="contest-title"
                        className="min-w-0 break-words text-2xl font-semibold sm:text-3xl"
                      >
                        {c.title}
                      </h1>
                      <ContestStatusBadge contest={c} />
                    </div>
                  </CardHeader>
                  <CardContent className="px-6 sm:px-8">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-sm sm:gap-x-6">
                      <dt className="text-muted-foreground">比赛时间</dt>
                      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium tabular-nums">
                        <time
                          dateTime={c.starts_at}
                          className="whitespace-nowrap"
                        >
                          <span className="sr-only">开始时间 </span>
                          {contestDate.format(new Date(c.starts_at))}
                        </time>
                        <span className="inline-flex items-center gap-3">
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <time
                            dateTime={c.ends_at}
                            className="whitespace-nowrap"
                          >
                            <span className="sr-only">结束时间 </span>
                            {contestDate.format(new Date(c.ends_at))}
                          </time>
                        </span>
                      </dd>
                      {c.freeze_at && (
                        <>
                          <dt className="text-muted-foreground">封榜时间</dt>
                          <dd className="tabular-nums">
                            <time dateTime={c.freeze_at}>
                              {contestDate.format(new Date(c.freeze_at))}
                            </time>
                          </dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">参赛规模</dt>
                      <dd className="flex flex-wrap items-center gap-x-5 gap-y-1">
                        <span>每队最多 {c.team_limit} 人</span>
                        <span>
                          <span className="font-medium tabular-nums">
                            {c.teams}
                          </span>{" "}
                          支战队已报名
                        </span>
                      </dd>
                    </dl>
                  </CardContent>
                </div>
                <div className="order-first h-40 overflow-hidden lg:order-none lg:h-full [&_img]:h-full">
                  <ContestPoster contest={c} priority />
                </div>
              </div>
              <CardFooter className="flex flex-col items-stretch gap-4 bg-muted/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="min-w-0 space-y-1.5">
                  <p
                    className={`text-sm ${c.registered ? "text-success" : "text-muted-foreground"}`}
                  >
                    {c.registered
                      ? "已报名"
                      : c.registration?.status &&
                          c.registration.status !== "accepted"
                        ? (
                            {
                              pending: "等待审核",
                              rejected: "未通过审核",
                              suspended: "参赛资格已暂停",
                            } as const
                          )[c.registration.status]
                        : access.challenges
                          ? "管理员预览"
                          : !user
                            ? "未登录"
                            : "未报名"}
                  </p>
                  {c.registration && (
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="min-w-0 break-words font-medium">
                        {c.registration.team_name}
                      </span>
                      <Badge className="max-w-full whitespace-normal break-words">
                        {c.registration.group_name ?? "公开组"}
                      </Badge>
                    </div>
                  )}
                  {c.registration?.review_note && (
                    <p className="max-w-xl text-sm text-muted-foreground">
                      {c.registration.review_note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                  {access.challenges ? (
                    <Button asChild>
                      <Link to={`/contests/${id}/challenges`}>
                        {c.registered ? "进入赛场" : "预览赛题"}
                        <ArrowRight />
                      </Link>
                    </Button>
                  ) : contestStatus(c) === "已结束" ? (
                    <Button variant="secondary" disabled>
                      比赛已结束
                    </Button>
                  ) : c.registration?.status === "pending" ||
                    c.registration?.status === "suspended" ? (
                    <>
                      <Button variant="secondary" disabled>
                        {c.registration.status === "pending"
                          ? "等待审核"
                          : "参赛已暂停"}
                      </Button>
                      {c.registration.status === "pending" &&
                        c.registration.is_captain !== false && (
                          <Button
                            variant="ghost"
                            disabled={unregister.isPending}
                            onClick={() => unregister.mutate()}
                          >
                            撤回报名
                          </Button>
                        )}
                    </>
                  ) : c.registered ? (
                    <>
                      <Button variant="secondary" disabled>
                        等待开赛
                      </Button>
                      {c.registration?.is_captain !== false && (
                        <Button
                          variant="ghost"
                          disabled={unregister.isPending}
                          onClick={() => unregister.mutate()}
                        >
                          取消报名
                        </Button>
                      )}
                    </>
                  ) : !user ? (
                    <Button asChild>
                      <Link
                        to={`/login?next=${encodeURIComponent(`/contests/${id}`)}`}
                      >
                        登录后报名
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        c.groups.length > 0 &&
                        c.groups.every((g) => g.joinable === false)
                      }
                      onClick={() => {
                        setTeam(captained[0]?.id ?? "");
                        setGroup(
                          c.groups.find((g) => g.joinable !== false)?.id ?? "",
                        );
                        setOpen(true);
                      }}
                    >
                      {c.groups.length > 0 &&
                      c.groups.every((g) => g.joinable === false)
                        ? "组别报名已关闭"
                        : c.registration?.status === "rejected"
                          ? "重新报名"
                          : "战队报名"}
                    </Button>
                  )}
                </div>
              </CardFooter>
            </Card>
            {c.registered && <ContestTiming id={c.id} />}
            {c.writeup_access && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/40 px-5 py-4">
                <div className="space-y-1">
                  <h2 className="font-medium">
                    WriteUp{" "}
                    {c.writeup?.required && (
                      <Badge variant="secondary">必交</Badge>
                    )}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    截止时间 {date(c.writeup?.deadline ?? null)}
                  </p>
                </div>
                <Button variant="secondary" asChild>
                  <Link to={`/contests/${c.id}/writeup`}>
                    提交 WriteUp
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            )}
            <div
              className={`grid items-start gap-10 ${c.groups.length ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}
            >
              <section className="min-w-0 px-1 sm:px-2">
                <h2 className="mb-6 text-xl font-semibold">比赛说明</h2>
                <Markdown>{c.description || "暂无比赛说明"}</Markdown>
              </section>
              {c.groups.length > 0 && (
                <aside className="space-y-6 px-1 sm:px-2">
                  <h2 className="text-xl font-semibold">参赛组别</h2>
                  {c.groups.map((g) => (
                    <div key={g.id} className="space-y-2">
                      <h3 className="font-medium">{g.name}</h3>
                      {(g.joinable === false || g.rank_overall === false) && (
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          {g.joinable === false && <span>报名已关闭</span>}
                          {g.rank_overall === false && (
                            <span>仅参与组内排名</span>
                          )}
                        </p>
                      )}
                      {g.description && (
                        <p className="text-sm leading-7 text-muted-foreground">
                          {g.description}
                        </p>
                      )}
                    </div>
                  ))}
                </aside>
              )}
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>比赛报名</DialogTitle>
              <QueryState
                loading={teams.isLoading}
                error={teams.error}
                retry={() => void teams.refetch()}
              />
              {!teams.isLoading &&
                !teams.error &&
                (captained.length ? (
                  <form
                    className="space-y-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      register.mutate();
                    }}
                  >
                    <Field label="参赛战队">
                      <NativeSelect
                        value={team}
                        onChange={(e) => setTeam(e.target.value)}
                        required
                      >
                        {captained.map((t) => (
                          <NativeSelectOption key={t.id} value={t.id}>
                            {t.name} ({t.members} 人)
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    {c.groups.length > 0 && (
                      <Field label="参赛组别">
                        <NativeSelect
                          value={group}
                          onChange={(e) => setGroup(e.target.value)}
                          required
                        >
                          {c.groups.map((g) => (
                            <NativeSelectOption
                              key={g.id}
                              value={g.id}
                              disabled={g.joinable === false}
                            >
                              {g.name}
                              {g.joinable === false ? "（报名已关闭）" : ""}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    )}
                    {c.groups.find((g) => g.id === group)?.description && (
                      <p className="text-sm text-muted-foreground">
                        {c.groups.find((g) => g.id === group)!.description}
                      </p>
                    )}
                    <Button
                      className="w-full"
                      disabled={
                        register.isPending ||
                        !team ||
                        (c.groups.length > 0 &&
                          !c.groups.some(
                            (g) => g.id === group && g.joinable !== false,
                          ))
                      }
                    >
                      {register.isPending ? "报名中" : "确认报名"}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-5 py-4">
                    <p className="text-sm text-muted-foreground">
                      {teams.data?.items.length
                        ? "请由战队队长报名"
                        : "还没有加入战队"}
                    </p>
                    <Button asChild>
                      <Link
                        to={`/team?next=${encodeURIComponent(`/contests/${id}`)}`}
                      >
                        创建或加入战队
                      </Link>
                    </Button>
                  </div>
                ))}
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
function ContestAccess({
  section,
  children,
}: {
  section: "challenges" | "instances";
  children: ReactNode;
}) {
  const { id } = useParams(),
    user = useUser();
  const contest = useAPI<Contest>(`/contests/${id}`);
  const access = useContestCapabilities(contest.data, user);
  if (contest.isLoading || contest.error)
    return (
      <QueryState
        loading={contest.isLoading}
        error={contest.error}
        retry={() => void contest.refetch()}
        fullPage
      />
    );
  if (!access[section]) return <Navigate to={`/contests/${id}`} replace />;
  return children;
}
export function ContestArena() {
  const { id } = useParams();
  return (
    <ContestAccess section="challenges">
      <Challenges key={id} scope={id!} />
    </ContestAccess>
  );
}
export function ContestBoard() {
  const { id } = useParams();
  return <Scoreboard scope={id} />;
}
export function ContestAnnouncements() {
  const { id } = useParams();
  return <Announcements scope={id} />;
}
export function ContestResources() {
  const { id } = useParams();
  return (
    <ContestAccess section="instances">
      <Instances scope={id} />
    </ContestAccess>
  );
}
