import { ContestTiming } from "@/components/contest-timing";
import { Scoreboard } from "./Scoreboard";
export { Scoreboard } from "./Scoreboard";
import { Link, Navigate, useParams } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { ArrowRight, MonitorPlay } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUser } from "@/App";
import { api, useAction, useAPI } from "@/lib/api";
import type { Contest, TeamSummary } from "@/lib/types";
import { contestStatus } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ContestOverview } from "@/components/contest-overview";
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
export function ContestDetail() {
  const { id } = useParams(),
    user = useUser(),
    [open, setOpen] = useState(false),
    [team, setTeam] = useState(""),
    [group, setGroup] = useState(""),
    [invite, setInvite] = useState("");
  const data = useAPI<Contest>(`/contests/${id}`),
    teams = useAPI<{ items: TeamSummary[] }>("/teams/mine", !!user);
  const access = useContestCapabilities(data.data, user, data.dataUpdatedAt);
  const register = useAction(
    () =>
      api(`/contests/${id}/register`, "POST", {
        team_id: team,
        group_id: group || null,
        invite_code: invite,
      }),
    () => setOpen(false),
  );
  const unregister = useAction(() => api(`/contests/${id}/unregister`, "POST"));
  const c = data.data,
    captained =
      teams.data?.items.filter(
        (t) =>
          t.captain_id === user?.id &&
          (c?.registration_mode !== "teams" ||
            c.eligible_team_ids?.includes(t.id)),
      ) ?? [];
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
          <ContestOverview
            contest={c}
            receivedAt={data.dataUpdatedAt}
            practice={access.practice}
            participation={
              (c.registered || c.registration) && (
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <p
                    className={`text-sm ${c.registered ? "text-success" : "text-muted-foreground"}`}
                  >
                    {c.registered
                      ? c.registration?.practice_only
                        ? "练习报名已通过"
                        : "已报名"
                      : c.registration?.status &&
                          c.registration.status !== "accepted"
                        ? (
                            {
                              pending: "等待审核",
                              rejected: "未通过审核",
                              suspended: "参赛资格已暂停",
                            } as const
                          )[c.registration.status]
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
              )
            }
            actions={
              <>
                {access.challenges && c.registered ? (
                  <Button asChild>
                    <Link to={`/contests/${id}/challenges`}>
                      {access.practice ? "进入练习" : "进入赛场"}
                      <ArrowRight />
                    </Link>
                  </Button>
                ) : contestStatus(c) === "已结束" && !access.practice ? (
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
                ) : access.registrationWindow !== "open" ? (
                  <Button variant="secondary" disabled>
                    {access.registrationWindow === "upcoming"
                      ? "报名尚未开放"
                      : "报名已截止"}
                  </Button>
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
                      (c.groups.length > 0 &&
                        c.groups.every((g) => g.joinable === false)) ||
                      (c.registration_mode === "teams" && !captained.length)
                    }
                    onClick={() => {
                      setTeam(captained[0]?.id ?? "");
                      setGroup(
                        c.groups.find((g) => g.joinable !== false)?.id ?? "",
                      );
                      setOpen(true);
                    }}
                  >
                    {c.registration_mode === "teams" && !captained.length
                      ? "仅限指定战队"
                      : c.groups.length > 0 &&
                          c.groups.every((g) => g.joinable === false)
                        ? "组别报名已关闭"
                        : c.registration?.status === "rejected"
                          ? "重新报名"
                          : access.practice
                            ? "报名练习"
                            : "战队报名"}
                  </Button>
                )}
                {access.scoreboard && (
                  <Button variant="secondary" asChild>
                    <Link to={`/contests/${id}/scoreboard`}>排行榜</Link>
                  </Button>
                )}
                {access.spectate && (
                  <Button variant="ghost" asChild>
                    <Link to={`/contests/${id}/spectate`}>
                      <MonitorPlay />
                      观战
                    </Link>
                  </Button>
                )}
                {access.challenges && !c.registered && (
                  <Button variant="secondary" asChild>
                    <Link to={`/contests/${id}/challenges`}>
                      预览赛题
                      <ArrowRight />
                    </Link>
                  </Button>
                )}
              </>
            }
            timing={
              c.registered && !access.practice ? (
                <ContestTiming id={c.id} />
              ) : null
            }
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>
                {access.practice ? "练习报名" : "比赛报名"}
              </DialogTitle>
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
                    {c.registration_mode === "invite" && (
                      <Field label="报名邀请码">
                        <Input
                          name="invite_code"
                          type="password"
                          autoComplete="off"
                          required
                          minLength={6}
                          maxLength={128}
                          value={invite}
                          onChange={(e) => setInvite(e.target.value)}
                        />
                      </Field>
                    )}
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
  section: "challenges" | "instances" | "scoreboard";
  children: ReactNode;
}) {
  const { id } = useParams(),
    user = useUser();
  const contest = useAPI<Contest>(`/contests/${id}`);
  const access = useContestCapabilities(
    contest.data,
    user,
    contest.dataUpdatedAt,
  );
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
  return (
    <ContestAccess section="scoreboard">
      <Scoreboard scope={id} />
    </ContestAccess>
  );
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
