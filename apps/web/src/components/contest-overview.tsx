import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Contest } from "@/lib/types";
import { date } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import { ContestPoster } from "./contest-poster";
import { ContestStatusBadge } from "./contest-status-badge";
import { ContestProgress, ContestSchedule } from "./contest-schedule";
import { Markdown } from "./markdown";

export function ContestOverview({
  contest: c,
  receivedAt,
  practice,
  participation,
  actions,
  timing,
}: {
  contest: Contest;
  receivedAt: number;
  practice: boolean;
  participation: ReactNode;
  actions: ReactNode;
  timing: ReactNode;
}) {
  return (
    <div
      data-card-detail={`/contests/${c.id}`}
      className="mx-auto w-full max-w-[1600px] space-y-6"
    >
      <Card
        aria-labelledby="contest-title"
        className="gap-0 overflow-hidden border-0 py-0"
      >
        <div className="grid items-center lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6 p-6 sm:p-8">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1
                  id="contest-title"
                  className="min-w-0 break-words text-2xl font-semibold sm:text-3xl"
                >
                  {c.title}
                </h1>
                <ContestStatusBadge contest={c} />
                {c.visibility === "private" && (
                  <Badge variant="secondary">私密</Badge>
                )}
                {practice && <Badge variant="secondary">练习开放</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span>
                  <strong className="font-medium tabular-nums text-foreground">
                    {c.teams ?? 0}
                  </strong>{" "}
                  支战队已报名
                </span>
                <span>每队最多 {c.team_limit} 人</span>
                <span>
                  {
                    {
                      public: "公开报名",
                      invite: "邀请码报名",
                      teams: "指定战队",
                    }[c.registration_mode ?? "public"]
                  }
                </span>
              </div>
            </header>
            <ContestProgress contest={c} receivedAt={receivedAt} />
            <div className="space-y-3">
              {participation}
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </div>
          </div>
          <div className="order-first px-6 pt-6 sm:px-8 lg:order-none lg:py-8 lg:pl-0">
            <ContestPoster
              contest={c}
              priority
              className="max-h-56 rounded-lg"
            />
          </div>
        </div>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {timing}
          {c.writeup_access && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card px-6 py-4">
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 font-medium">
                  WriteUp{" "}
                  {c.writeup?.required && (
                    <Badge variant="secondary">必交</Badge>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  截止 {date(c.writeup?.deadline ?? null)}
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
          <Card className="border-0">
            <CardContent className="space-y-5 sm:px-8">
              <h2 className="text-lg font-semibold">比赛说明</h2>
              {c.description ? (
                <Markdown>{c.description}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">暂无比赛说明</p>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="min-w-0 border-0">
          <CardContent className="space-y-6">
            <ContestSchedule contest={c} receivedAt={receivedAt} />
            {c.freeze_at && (
              <p className="text-xs text-muted-foreground">
                封榜 {date(c.freeze_at)}
              </p>
            )}
            {practice && (
              <p className="text-xs text-muted-foreground">
                练习成绩不计入正式排名。
              </p>
            )}
            {c.groups.length > 0 && (
              <>
                <Separator />
                <section
                  className="space-y-4"
                  aria-labelledby="contest-groups-title"
                >
                  <h2
                    id="contest-groups-title"
                    className="text-base font-semibold"
                  >
                    参赛组别
                  </h2>
                  <ul className="space-y-4">
                    {c.groups.map((g) => (
                      <li key={g.id} className="space-y-1.5 text-sm">
                        <h3 className="font-medium">{g.name}</h3>
                        {(g.joinable === false || g.rank_overall === false) && (
                          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {g.joinable === false && <span>报名已关闭</span>}
                            {g.rank_overall === false && (
                              <span>仅参与组内排名</span>
                            )}
                          </p>
                        )}
                        {g.description && (
                          <p className="break-words text-xs leading-5 text-muted-foreground">
                            {g.description}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
