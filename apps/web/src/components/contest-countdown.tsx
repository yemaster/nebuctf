import {
  contestCountdown,
  countdownTone,
  remainingTime,
  type ContestClock,
} from "@/lib/contest-clock";
import { useContestNow } from "./contest-clock";
import { Card } from "./ui/card";

export function ContestCountdown({
  clock,
  receivedAt,
}: {
  clock: ContestClock;
  receivedAt: number;
}) {
  const now = useContestNow(clock, receivedAt);
  const { label, remaining } = contestCountdown(clock, now);
  const tone = countdownTone(clock, now);
  const color = {
    scheduled: "text-primary",
    running: "text-success",
    warning: "text-warning",
    urgent: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <Card
      role="timer"
      aria-label="比赛倒计时"
      className="absolute top-full right-0 mt-3 hidden w-60 items-center gap-1 px-5 py-3 text-center shadow-md md:flex"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <time
        className={`text-4xl leading-10 font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${color}`}
      >
        {remainingTime(remaining)}
      </time>
    </Card>
  );
}
