import {
  contestCountdown,
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
  if (remaining === null) return null;
  return (
    <Card
      role="timer"
      aria-label="比赛倒计时"
      className="absolute top-full right-0 mt-3 hidden w-52 gap-1 px-5 py-3 shadow-md lg:flex"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <time className="text-3xl leading-9 font-semibold tabular-nums">
        {remainingTime(remaining)}
      </time>
    </Card>
  );
}
