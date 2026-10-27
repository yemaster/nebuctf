import { useEffect, useMemo, useState } from "react";
import type { Contest, User } from "./types";

// Mirror the existing API rules; hiding navigation never replaces server checks.
export function contestCapabilities(
  contest: Contest | undefined,
  user: User | null,
  now = Date.now(),
) {
  const registered = !!user && !!contest?.registered;
  const staff = user?.role === "admin";
  const preview = user?.role === "admin" && !contest?.registration;
  const active =
    !!contest &&
    Date.parse(contest.starts_at) <= now &&
    now < Date.parse(contest.ends_at);
  const practice =
    !!contest?.practice_mode && now >= Date.parse(contest.ends_at);
  const registrationWindow = practice
    ? "open"
    : contest?.registration_opens_at &&
        now < Date.parse(contest.registration_opens_at)
      ? "upcoming"
      : contest &&
          now >= Date.parse(contest.registration_closes_at ?? contest.ends_at)
        ? "closed"
        : "open";
  return {
    registrationWindow,
    role: staff
      ? ("staff" as const)
      : registered
        ? ("participant" as const)
        : ("spectator" as const),
    practice,
    scoreboard:
      !!contest &&
      (staff || registered || contest.spectator_scoreboard !== false),
    spectate:
      !!contest &&
      (staff || (contest.published && contest.spectator_enabled !== false)),
    challenges: (active || practice) && (registered || preview),
    instances: registered,
    activity:
      !!contest &&
      !!user &&
      (registered || preview) &&
      now >= Date.parse(contest.starts_at),
  };
}

export function useContestCapabilities(
  contest: Contest | undefined,
  user: User | null,
  receivedAt?: number,
) {
  const [now, setNow] = useState(Date.now);
  const offset = useMemo(
    () =>
      contest?.clock && receivedAt
        ? Date.parse(contest.clock.server_time) - receivedAt
        : 0,
    [contest?.clock?.server_time, receivedAt],
  );
  useEffect(() => {
    const current = Date.now() + offset;
    if (!contest) return;
    const next = [
      Date.parse(contest.starts_at),
      Date.parse(contest.ends_at),
      Date.parse(contest.registration_opens_at ?? ""),
      Date.parse(contest.registration_closes_at ?? ""),
    ]
      .filter((time) => time > current)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - current + 30, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [
    contest?.starts_at,
    contest?.ends_at,
    contest?.registration_opens_at,
    contest?.registration_closes_at,
    now,
    offset,
  ]);
  return contestCapabilities(contest, user, Date.now() + offset);
}
