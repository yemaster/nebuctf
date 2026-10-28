import { useEffect, useMemo, useState } from "react";
import { Clock3, LockKeyhole } from "lucide-react";
import { remainingTime, roundAt, type ContestClock } from "@/lib/contest-clock";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";

export function useContestNow(
  clock: Pick<ContestClock, "server_time"> | null | undefined,
  receivedAt?: number,
  refreshInterval = 1000,
) {
  const offset = useMemo(
    () =>
      clock ? Date.parse(clock.server_time) - (receivedAt || Date.now()) : 0,
    [clock?.server_time, receivedAt],
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval]);
  return now + offset;
}

export function ContestClockSummary({
  clock,
  receivedAt,
  compact = false,
}: {
  clock: ContestClock;
  receivedAt?: number;
  compact?: boolean;
}) {
  const now = useContestNow(clock, receivedAt),
    round = roundAt(clock, now);
  const before = now < Date.parse(clock.starts_at),
    ended = now >= Date.parse(clock.ends_at);
  const frozen =
    !!clock.freeze_at && now >= Date.parse(clock.freeze_at) && !ended;
  return (
    <section
      aria-label="比赛进度"
      className={
        compact
          ? "flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
          : "space-y-3"
      }
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Clock3 className="size-4" />
          {clock.practice
            ? "赛后练习"
            : before
              ? "距离开赛"
              : ended
                ? "比赛已结束"
                : "比赛剩余"}
        </span>
        {!clock.practice && !ended && (
          <time className="font-medium tabular-nums">
            {remainingTime(
              Date.parse(before ? clock.starts_at : clock.ends_at) - now,
            )}
          </time>
        )}
      </div>
      {round && (
        <div className={compact ? "flex items-center gap-3" : "space-y-2"}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              第 {round.number}{" "}
              <span className="font-normal text-muted-foreground">
                / {round.total} 轮
              </span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {round.state === "ended"
                ? "已结束"
                : round.state === "transition"
                  ? "轮次切换中"
                  : round.state === "scheduled"
                    ? "等待实操开放"
                    : remainingTime(round.remaining)}
            </span>
          </div>
          {!compact && round.state === "active" && (
            <Progress
              className="h-1.5"
              value={round.progress}
              aria-label="本轮剩余时间"
            />
          )}
        </div>
      )}
      {frozen && (
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <LockKeyhole className="size-3" />
          已封榜
        </Badge>
      )}
    </section>
  );
}

export function ContestClockLine({
  clock,
  receivedAt,
}: {
  clock: ContestClock;
  receivedAt?: number;
}) {
  const now = useContestNow(clock, receivedAt),
    round = roundAt(clock, now);
  const ended = now >= Date.parse(clock.ends_at),
    before = now < Date.parse(clock.starts_at);
  return (
    <span
      className="block text-xs font-normal tabular-nums text-muted-foreground"
      aria-label="比赛计时"
    >
      {clock.practice
        ? "赛后练习"
        : ended
          ? "比赛已结束"
          : round?.state === "active"
            ? `第 ${round.number} / ${round.total} 轮　${remainingTime(round.remaining)}`
            : `${before ? "开赛倒计时" : "比赛剩余"} ${remainingTime(Date.parse(before ? clock.starts_at : clock.ends_at) - now)}`}
    </span>
  );
}
