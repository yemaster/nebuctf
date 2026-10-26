import { useLocation, useSearchParams } from "react-router-dom";
import { useAPI } from "@/lib/api";
import type { Phase } from "@/lib/competition";
import { Clock3, LockKeyhole } from "lucide-react";
import type { Contest } from "@/lib/types";
import { remainingTime, roundAt } from "@/lib/contest-clock";
import { useContestNow } from "./contest-clock";

export function ContestFooterStatus({
  contest,
  receivedAt,
}: {
  contest: Contest;
  receivedAt: number;
}) {
  const location = useLocation(),
    [params] = useSearchParams();
  const timing = useAPI<{ phases: Phase[]; server_time: string }>(
    `/contests/${contest.id}/timing`,
    !!contest.registered &&
      Object.values(contest.timing ?? {}).some((p) => p.mode !== "inherit"),
    15000,
  );
  const section =
    params.get("challenge") === "objective" ? "objective" : "practical";
  const phase =
    location.pathname.endsWith("/challenges") && !timing.error
      ? timing.data?.phases?.find(
          (p) =>
            p.section === section &&
            p.mode !== "inherit" &&
            p.status === "active",
        )
      : undefined;
  const now = useContestNow(contest.clock, receivedAt),
    clock = contest.clock;
  const before = now < Date.parse(contest.starts_at),
    ended = now >= Date.parse(contest.ends_at);
  const round = clock ? roundAt(clock, now) : null;
  const showRound =
    (section !== "objective" || !phase) &&
    round &&
    round.state !== "scheduled" &&
    round.state !== "ended";
  const practice = clock?.practice || (contest.practice_mode && ended);
  const frozen =
    !ended && contest.freeze_at && Date.parse(contest.freeze_at) <= now;
  return (
    <div
      className="flex shrink-0 items-center gap-3 whitespace-nowrap tabular-nums"
      aria-label="比赛进度"
    >
      <span
        className={`${showRound || phase ? "hidden sm:flex" : "flex"} items-center gap-1.5`}
        aria-label={
          practice
            ? "赛后练习"
            : ended
              ? "比赛已结束"
              : `${before ? "距开赛" : "赛程剩余"} ${remainingTime(Date.parse(before ? contest.starts_at : contest.ends_at) - now)}`
        }
      >
        <Clock3 className="size-3.5" />
        {practice ? (
          "赛后练习"
        ) : ended ? (
          "比赛已结束"
        ) : (
          <>
            <span className="hidden lg:inline">
              {before ? "距开赛" : "赛程剩余"}
            </span>
            <time>
              {remainingTime(
                Date.parse(before ? contest.starts_at : contest.ends_at) - now,
              )}
            </time>
          </>
        )}
      </span>
      {phase && (
        <span
          className="flex items-center gap-2"
          aria-label={`${section === "objective" ? "客观题" : "实操题"}剩余时间`}
        >
          <span>{section === "objective" ? "客观题" : "实操题"}</span>
          <time className="font-medium text-foreground">
            {remainingTime(
              Date.parse(phase.deadline_at ?? phase.closes_at!) - now,
            )}
          </time>
        </span>
      )}
      {showRound && (
        <span
          className={`${phase ? "hidden lg:flex" : "flex"} items-center gap-2`}
          aria-label="当前比赛轮次"
        >
          <span>
            第 {round.number}/{round.total} 轮
          </span>
          <time className="font-medium text-foreground">
            {round.state === "transition"
              ? "切换中"
              : remainingTime(round.remaining)}
          </time>
        </span>
      )}
      {frozen && (
        <span className="flex items-center gap-1">
          <LockKeyhole className="size-3" />
          <span className="hidden md:inline">已封榜</span>
        </span>
      )}
    </div>
  );
}
