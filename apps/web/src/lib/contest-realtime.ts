import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAPI } from "./api";
import type { ContestActivityData } from "@/components/contest-activity";
export function useContestRealtime(scope: string) {
  const path = `/contests/${scope}/activity`,
    query = useAPI<ContestActivityData>(path),
    cache = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "retrying">(
    "connecting",
  );
  useEffect(() => {
    let disposed = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      retries = 0;
    const connect = () => {
      if (disposed) return;
      const url = new URL(
        `/api/contests/${scope}/activity/ws`,
        window.location.href,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      setStatus(retries ? "retrying" : "connecting");
      socket = new window.WebSocket(url.toString());
      socket.onopen = () => {
        if (disposed) return;
        retries = 0;
        setStatus("live");
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const payload = JSON.parse(String(event.data));
          if (
            payload.type === "judges" &&
            typeof payload.revision === "string"
          ) {
            void cache.invalidateQueries({
              predicate: (q) =>
                String(q.queryKey[0]).startsWith("/challenges/") &&
                String(q.queryKey[0]).includes(`scope=${scope}`),
            });
            return;
          }
          if (payload.type === "retry") {
            setStatus("retrying");
            return;
          }
          if (
            payload.type !== "activity" ||
            !Array.isArray(payload.data?.items) ||
            typeof payload.data?.frozen !== "boolean"
          )
            return;
          const data = payload.data as ContestActivityData,
            previous = cache.getQueryData<ContestActivityData>([path]);
          // A slower initial HTTP response must not replace a newer socket snapshot.
          void cache.cancelQueries({ queryKey: [path], exact: true });
          cache.setQueryData([path], data);
          setStatus("live");
          if (
            previous &&
            (data.permissions_version !== previous.permissions_version ||
              data.frozen !== previous.frozen ||
              previous.items.some(
                (old) => !data.items.some((e) => e.id === old.id),
              ) ||
              data.items.some(
                (e) => !previous.items.some((old) => old.id === e.id),
              ))
          ) {
            void cache.invalidateQueries({
              predicate: (q) => {
                const key = String(q.queryKey[0]);
                return (
                  (key.startsWith("/challenges") ||
                    key.startsWith("/scoreboard") ||
                    key.startsWith("/instances")) &&
                  key.includes(`scope=${scope}`)
                );
              },
            });
          }
        } catch {
          /* Ignore invalid frames and keep the last usable snapshot. */
        }
      };
      socket.onerror = () => {
        if (!disposed) setStatus("retrying");
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setStatus("retrying");
        if (event.code === 1008) {
          void cache.invalidateQueries({ queryKey: [`/contests/${scope}`] });
          return;
        }
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)) +
          Math.random() * 300;
        timer = setTimeout(connect, delay);
      };
    };
    const online = () => {
      if (socket?.readyState === 1 || socket?.readyState === 0) return;
      if (timer) clearTimeout(timer);
      connect();
    };
    connect();
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", online);
      socket?.close();
    };
  }, [scope, path, cache]);
  return { ...query, status };
}
