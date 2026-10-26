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
