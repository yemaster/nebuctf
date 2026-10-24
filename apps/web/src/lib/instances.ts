import { useEffect, useState } from "react";
import type { Instance } from "./types";
// Keep a just-released instance briefly so the completion transition can finish.
export function useVisibleInstances(
  items: Instance[] | undefined,
  scope: string,
) {
  const [snapshot, setSnapshot] = useState({ scope, rows: items ?? [] });
  useEffect(() => {
    if (!items) return;
    setSnapshot((previous) => ({
      scope,
      rows: [
        ...items,
        ...(previous.scope === scope
          ? previous.rows
              .filter(
                (row) =>
                  row.status === "stopping" &&
                  !items.some((i) => i.id === row.id),
              )
              .map((row) => ({ ...row, status: "stopped", endpoint: null }))
          : []),
      ],
    }));
    const timer = setTimeout(
      () =>
        setSnapshot((current) => ({
          ...current,
          rows: current.rows.filter((row) => row.status !== "stopped"),
        })),
      1100,
    );
    return () => clearTimeout(timer);
  }, [items, scope]);
  return snapshot.scope === scope ? snapshot.rows : (items ?? []);
}

export function useResourceCooldown(
  until?: string | null,
  retryAfter?: number,
) {
  const [now, setNow] = useState(Date.now());
  const [retryUntil, setRetryUntil] = useState(0);
  useEffect(() => {
    setRetryUntil(retryAfter ? Date.now() + retryAfter * 1000 : 0);
  }, [retryAfter]);
  const deadline = Math.max(until ? Date.parse(until) || 0 : 0, retryUntil);
  useEffect(() => {
    if (deadline <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
