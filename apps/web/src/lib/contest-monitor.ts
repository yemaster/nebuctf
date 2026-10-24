import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useMonitor(id: string, enabled = true) {
  const cache = useQueryClient(),
    [live, setLive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      retries = 0,
      revision: string | undefined;
    const refresh = () =>
      void cache.invalidateQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith(`/admin/contests/${id}/`) ||
          q.queryKey[0] === `/contests/${id}`,
      });
    const connect = () => {
      if (stopped) return;
      const url = new URL(
        `/api/admin/contests/${id}/activity/ws`,
        window.location.href,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new window.WebSocket(url);
      socket.onopen = () => {
        if (!stopped) {
          setLive(true);
          retries = 0;
        }
      };
      socket.onmessage = (e) => {
        if (stopped) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === "monitor" && typeof m.data?.revision === "string") {
            if (revision !== m.data.revision) refresh();
            revision = m.data.revision;
            setLive(true);
          } else if (m.type === "retry") setLive(false);
        } catch {
          /* Ignore malformed snapshots. */
        }
      };
      socket.onclose = (event) => {
        if (stopped) return;
        setLive(false);
        if (event.code === 1008) {
          refresh();
          return;
        }
        timer = setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)),
        );
      };
      socket.onerror = () => {
        if (!stopped) setLive(false);
      };
    };
    const online = () => {
      if (socket?.readyState === 0 || socket?.readyState === 1) return;
      clearTimeout(timer);
      connect();
    };
    connect();
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      window.removeEventListener("online", online);
    };
  }, [cache, id, enabled]);
  return live;
}
