import type { Row } from "./db.js";

export function isContestPractice(
  contest: Row | null | undefined,
  now = Date.now(),
) {
  return !!contest?.practice_mode && new Date(contest.ends_at).getTime() <= now;
}

export function contestCutoff(
  contest: Row | null | undefined,
  now = Date.now(),
) {
  if (!contest) return new Date(now);
  const end = new Date(contest.ends_at).getTime();
  const frozen =
    contest.freeze_at &&
    new Date(contest.freeze_at).getTime() <= now &&
    now < end;
  return new Date(
    frozen ? new Date(contest.freeze_at).getTime() : Math.min(now, end),
  );
}
