import { useEffect, useState } from "react";
import type { Contest, User } from "./types";

// Mirror the existing API rules; hiding navigation never replaces server checks.
export function contestCapabilities(
  contest: Contest | undefined,
  user: User | null,
  now = Date.now(),
) {
  const registered = !!user && !!contest?.registered;
  const preview = user?.role === "admin" && !contest?.registration;
  const active =
    !!contest &&
    Date.parse(contest.starts_at) <= now &&
    now < Date.parse(contest.ends_at);
  return {
    challenges: active && (registered || preview),
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
) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const current = Date.now();
    if (!contest) return;
    const next = [
      Date.parse(contest.starts_at),
      Date.parse(contest.ends_at),
    ].find((time) => time > current);
    if (!next) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - current + 30, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [contest?.starts_at, contest?.ends_at, now]);
  return contestCapabilities(contest, user);
}
