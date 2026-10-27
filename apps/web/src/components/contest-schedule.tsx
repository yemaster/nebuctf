import type { Contest } from "@/lib/types";
import { contestProgress, contestTimeline } from "@/lib/contest-schedule";
import { useContestNow } from "./contest-clock";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "./ui/progress";

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const shortDate = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function ContestProgress({
  contest,
  receivedAt,
}: {
  contest: Contest;
  receivedAt: number;
}) {
  const now = useContestNow(contest.clock, receivedAt);
  const progress = contestProgress(contest, now);
  return (
    <section aria-label="比赛进度" className="space-y-3">
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-3 text-sm tabular-nums">
        {(
          [
            ["开始时间", contest.starts_at],
            ["结束时间", contest.ends_at],
          ] as const
        ).map(([label, time]) => (
          <div key={label} className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <time dateTime={time} className="font-medium">
              {dateFormat.format(new Date(time))}
            </time>
          </div>
        ))}
      </div>
      <Progress
        aria-label="比赛已进行"
        aria-valuetext={`${progress.toFixed(1)}%`}
        value={progress}
      />
    </section>
  );
}

export function ContestSchedule({
  contest,
  receivedAt,
}: {
  contest: Contest;
  receivedAt: number;
}) {
  const now = useContestNow(contest.clock, receivedAt);
  const nodes = contestTimeline(contest, now);
  return (
    <section aria-labelledby="contest-schedule-title" className="space-y-4">
      <h2 id="contest-schedule-title" className="text-base font-semibold">
        赛程
      </h2>
      <ol aria-label="比赛时间轴">
        {nodes.map((node, index) => {
          const current = node.state === "current";
          const past = node.state === "past";
          const Icon = current ? CircleDot : past ? CheckCircle2 : Circle;
          return (
            <li
              key={node.id}
              aria-current={current ? "time" : undefined}
              data-timeline-state={node.state}
              className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0"
            >
              {index < nodes.length - 1 && (
                <Separator
                  orientation="vertical"
                  className={cn(
                    "absolute left-[7.5px] top-5 -bottom-1 data-[orientation=vertical]:h-auto",
                    past ? "bg-primary/30" : "bg-border",
                  )}
                />
              )}
              <Icon
                aria-hidden="true"
                className={cn(
                  "relative z-10 mt-0.5 size-4 bg-card",
                  current ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                  {current && (
                    <span className="font-medium text-primary">现在</span>
                  )}
                  {node.at ? (
                    <time
                      dateTime={node.at}
                      title={dateFormat.format(new Date(node.at))}
                      className="tabular-nums text-muted-foreground"
                    >
                      {shortDate.format(new Date(node.at))}
                    </time>
                  ) : (
                    <span className="text-muted-foreground">发布后</span>
                  )}
                </div>
                {current ? (
                  node.events.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {node.events.map((event) => (
                        <Badge
                          key={event.id}
                          variant="secondary"
                          className="bg-primary/10 text-primary"
                        >
                          {event.title}
                        </Badge>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="space-y-1">
                    {node.events.map((event) => (
                      <div key={event.id}>
                        <p
                          className={cn(
                            "break-words text-sm",
                            past ? "text-muted-foreground" : "font-medium",
                          )}
                        >
                          {event.title}
                        </p>
                        {event.detail && (
                          <p className="text-xs leading-5 text-muted-foreground">
                            {event.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
