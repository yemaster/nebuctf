export type ContestClock = {
  server_time: string;
  starts_at: string;
  ends_at: string;
  freeze_at: string | null;
  practice: boolean;
  rounds: {
    opens_at: string;
    closes_at: string;
    interval: number;
    total: number;
    active_from: string | null;
  } | null;
};

export function remainingTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function roundAt(clock: ContestClock, now: number) {
  const r = clock.rounds;
  if (!r || clock.practice) return null;
  const start = Date.parse(r.opens_at),
    end = Date.parse(r.closes_at),
    duration = r.interval * 1000;
  const number = Math.min(
    r.total,
    Math.max(1, Math.floor((now - start) / duration) + 1),
  );
  const opens = start + (number - 1) * duration,
    closes = Math.min(end, opens + duration);
  return {
    number,
    total: r.total,
    opens,
    closes,
    remaining: Math.max(0, closes - now),
    progress: Math.max(
      0,
      Math.min(100, ((closes - now) / (closes - opens)) * 100),
    ),
    state:
      now < start
        ? "scheduled"
        : now >= end
          ? "ended"
          : r.active_from && now < Date.parse(r.active_from)
            ? "transition"
            : "active",
  } as const;
}

export function contestCountdown(clock: ContestClock, now: number) {
  const starts = Date.parse(clock.starts_at),
    ends = Date.parse(clock.ends_at);
  if (clock.practice) return { label: "赛后练习", remaining: 0 };
  if (now >= ends) return { label: "比赛已结束", remaining: 0 };
  if (now < starts) return { label: "距离开赛", remaining: starts - now };
  const round = roundAt(clock, now);
  if (round?.state === "scheduled")
    return { label: "轮次开始", remaining: round.opens - now };
  if (round && round.state !== "ended")
    return {
      label: `第 ${round.number} / ${round.total} 轮`,
      remaining: Math.max(0, Math.min(round.closes, ends) - now),
    };
  return { label: "比赛剩余", remaining: ends - now };
}

export function countdownTone(clock: ContestClock, now: number) {
  const starts = Date.parse(clock.starts_at),
    ends = Date.parse(clock.ends_at);
  if (clock.practice || now >= ends) return "muted";
  if (now < starts) return "scheduled";
  const round = roundAt(clock, now);
  if (round?.state === "scheduled" || round?.state === "transition")
    return "scheduled";
  const deadline =
      round?.state === "active" ? Math.min(round.closes, ends) : ends,
    opens = round?.state === "active" ? round.opens : starts;
  return timeWindowTone(opens, deadline, now);
}

export function timeWindowTone(starts: number, ends: number, now: number) {
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
    return "muted";
  if (now >= ends) return "muted";
  if (now < starts) return "scheduled";
  const duration = ends - starts,
    remaining = ends - now;
  // Scale short rounds and contests so a new period begins without an alert.
  if (remaining <= Math.min(60_000, duration * 0.1)) return "urgent";
  if (remaining <= Math.min(600_000, duration * 0.2)) return "warning";
  return "running";
}
