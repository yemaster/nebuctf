import type { Contest } from "@/lib/types";
import { contestProgress, contestStages } from "@/lib/contest-schedule";
import { useContestNow } from "./contest-clock";
import { Badge } from "./ui/badge";
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
  const stages = contestStages(contest, now);
  return (
    <section aria-labelledby="contest-schedule-title" className="space-y-4">
      <h2 id="contest-schedule-title" className="text-base font-semibold">
        赛程
      </h2>
      <ol className="space-y-5">
        {stages.map((stage) => (
          <li key={stage.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{stage.title}</h3>
              <Badge
                variant="secondary"
                className={
                  stage.state === "active"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground"
                }
              >
                {stage.label}
              </Badge>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
              {stage.start ? (
                <time
                  dateTime={stage.start}
                  title={dateFormat.format(new Date(stage.start))}
                >
                  {shortDate.format(new Date(stage.start))}
                </time>
              ) : (
                <span>发布后</span>
              )}
              <span>至</span>
              {stage.end ? (
                <time
                  dateTime={stage.end}
                  title={dateFormat.format(new Date(stage.end))}
                >
                  {shortDate.format(new Date(stage.end))}
                </time>
              ) : (
                <span>持续开放</span>
              )}
            </p>
            {stage.id === "contest" && (
              <ul className="space-y-2">
                {(
                  [
                    ["objective", "客观题"],
                    ["practical", "实操题"],
                  ] as const
                ).map(([key, label]) => {
                  const phase = contest.timing?.[key];
                  return phase &&
                    phase.mode !== "inherit" &&
                    phase.opens_at &&
                    phase.closes_at ? (
                    <li
                      key={key}
                      className="space-y-1 text-xs text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">
                        {label}
                      </span>
                      <p className="tabular-nums">
                        {shortDate.format(new Date(phase.opens_at))} —{" "}
                        {shortDate.format(new Date(phase.closes_at))}
                      </p>
                      {phase.mode === "flexible" && (
                        <p>
                          自由开始，限时 {(phase.duration_seconds ?? 0) / 60}{" "}
                          分钟
                        </p>
                      )}
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
