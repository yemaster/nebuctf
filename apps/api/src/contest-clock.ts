import type { DB, Row } from "./db.js";
import { phaseWindow } from "./competition-rules.js";
import { isContestPractice } from "./contest-practice.js";

// The practical phase owns the clock. Publication time only determines when a
// challenge joins this clock; it never moves the epoch or restarts numbering.
export function contestRoundSchedule(contest: Row) {
  const phase = phaseWindow(contest, "practical");
  const start = Date.parse(phase.opens_at),
    end = Date.parse(phase.closes_at);
  const interval = contest.round_duration ?? 300;
  return {
    opens_at: new Date(start).toISOString(),
    closes_at: new Date(end).toISOString(),
    interval,
    total: Math.max(0, Math.ceil((end - start) / (interval * 1000))),
    active_from: contest.round_clock_from
      ? new Date(contest.round_clock_from).toISOString()
      : null,
  };
}

export function roundWindow(contest: Row, number?: number, now = Date.now()) {
  const schedule = contestRoundSchedule(contest);
  const start = Date.parse(schedule.opens_at),
    end = Date.parse(schedule.closes_at);
  if (number === undefined && now >= end) return null;
  const duration = schedule.interval * 1000;
  const n = number ?? Math.floor((now - start) / duration) + 1;
  const opens = start + (n - 1) * duration;
  if (!Number.isInteger(n) || n < 1 || opens >= end || opens > now) return null;
  return {
    number: n,
    starts_at: new Date(opens),
    ends_at: new Date(Math.min(opens + duration, end)),
  };
}

export function currentContestRound(contest: Row, now = Date.now()) {
  const schedule = contestRoundSchedule(contest);
  const start = Date.parse(schedule.opens_at),
    end = Date.parse(schedule.closes_at);
  if (now < start) return null;
  const round = roundWindow(contest, undefined, Math.min(now, end - 1));
  if (!round) return null;
  return {
    ...round,
    total: schedule.total,
    status:
      now >= end
        ? "ended"
        : schedule.active_from && now < Date.parse(schedule.active_from)
          ? "transition"
          : "open",
  };
}

export function firstChallengeRound(contest: Row, link: Row) {
  const schedule = contestRoundSchedule(contest),
    start = Date.parse(schedule.opens_at);
  const first = Math.max(
    start,
    link.release_at ? new Date(link.release_at).getTime() : start,
    schedule.active_from ? Date.parse(schedule.active_from) : start,
  );
  return Math.floor((first - start) / (schedule.interval * 1000)) + 1;
}

export async function readContestClock(db: DB, contest: Row) {
  const [rounds] = await db.query(
    "SELECT EXISTS(SELECT 1 FROM contest_challenges WHERE contest_id=$1 AND scoring->>'mode'='round') enabled",
    [contest.id],
  );
  return {
    server_time: new Date().toISOString(),
    starts_at: contest.starts_at,
    ends_at: contest.ends_at,
    freeze_at: contest.freeze_at,
    practice: isContestPractice(contest),
    rounds: rounds!.enabled ? contestRoundSchedule(contest) : null,
  };
}
