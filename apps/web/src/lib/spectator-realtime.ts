import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, useAPI } from "./api";
import type { SpectatorData } from "./spectator";
import {
  SpectatorHighlightTracker,
  type SpectatorHighlightBatch,
} from "./spectator-highlights";

export function useSpectatorRealtime(scope: string) {
  const path = `/contests/${scope}/spectate`,
    query = useAPI<SpectatorData>(path),
    cache = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "retrying">(
    "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [highlights, setHighlights] = useState<SpectatorHighlightBatch | null>(
    null,
  );
  useEffect(() => {
    const tracker = new SpectatorHighlightTracker();
    let disposed = false,
      blocked = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      retries = 0;
    setDenied(null);
    setHighlights(null);
    const connect = () => {
      if (disposed || blocked || document.hidden) return;
      let continuous = false;
      const url = new URL(`/api${path}/ws`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      setStatus(retries ? "retrying" : "connecting");
      socket = new window.WebSocket(url);
      socket.onopen = () => {
        if (!disposed) {
          retries = 0;
          setStatus("live");
        }
      };
      socket.onmessage = (message) => {
        if (disposed) return;
        try {
          const frame = JSON.parse(String(message.data));
          if (frame.type === "retry") {
            continuous = false;
            setStatus("retrying");
            return;
          }
          if (
            frame.type !== "spectator" ||
            !Array.isArray(frame.data?.events) ||
            !Array.isArray(frame.data?.leaders) ||
            typeof frame.data?.frozen !== "boolean"
          )
            return;
          const items = tracker.ingest(
            frame.data,
            continuous && !document.hidden,
          );
          continuous = !document.hidden;
          if (items.length) setHighlights({ items });
          void cache.cancelQueries({ queryKey: [path], exact: true });
          cache.setQueryData([path], frame.data);
          void cache.invalidateQueries({
            predicate: (q) =>
              String(q.queryKey[0]).startsWith(`${path}/ranking?`),
          });
          setStatus("live");
        } catch {
          /* A malformed frame cannot replace the last valid snapshot. */
        }
      };
      socket.onerror = () => {
        continuous = false;
        if (!disposed) setStatus("retrying");
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setStatus("retrying");
        if (event.code === 1008) {
          blocked = true;
          setDenied(new ApiError("本场比赛的观战权限已变更", 403));
          void cache.cancelQueries({ queryKey: [path] });
          cache.removeQueries({ queryKey: [path], exact: true });
          void cache.invalidateQueries({ queryKey: [`/contests/${scope}`] });
          return;
        }
        if (!document.hidden)
          timer = setTimeout(
            connect,
            Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)) +
              Math.random() * 300,
          );
      };
    };
    const resume = () => {
      if (document.hidden) {
        setStatus("retrying");
        if (timer) clearTimeout(timer);
        socket?.close();
      } else if (!socket || socket.readyState > 1) {
        if (timer) clearTimeout(timer);
        connect();
      }
    };
    connect();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      socket?.close();
    };
  }, [scope, path, cache, attempt]);
  return {
    ...query,
    data: denied ? undefined : query.data,
    error: denied ?? query.error,
    status,
    highlights,
    retry: () => {
      setAttempt((v) => v + 1);
      void query.refetch();
    },
  };
}
