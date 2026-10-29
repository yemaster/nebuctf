import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "./api";

export type MessageKind = "system" | "contest" | "reminder";
export type Message = {
  id: string;
  kind: MessageKind;
  title: string;
  excerpt: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};
export type MessageDetail = Message & {
  body: string;
  href: string | null;
  action_label: string | null;
  sender: string | null;
  actions?: { label: string; href: string }[];
};
export type InboxSummary = { unread: number; revision: string | null };
export const messageKinds = {
  system: "系统",
  contest: "比赛",
  reminder: "提醒",
};
export const inboxKey = (user: string) => ["notifications", user] as const;

export function useInboxSummary(user: string, live = false) {
  const cache = useQueryClient(),
    [connected, setConnected] = useState(false);
  const query = useQuery({
    queryKey: [...inboxKey(user), "summary"],
    queryFn: async ({ signal }) => {
      const summary = await api<InboxSummary>(
        "/notifications/summary",
        "GET",
        undefined,
        signal,
      );
      const previous = cache.getQueryData<InboxSummary>([
        ...inboxKey(user),
        "summary",
      ]);
      if (previous && previous.revision !== summary.revision)
        void cache.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === "notifications" &&
            q.queryKey[1] === user &&
            q.queryKey[2] !== "summary",
        });
      return summary;
    },
    refetchInterval: live && !connected ? 30000 : false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (
      !live ||
      typeof WebSocket === "undefined" ||
      !/^https?:$/.test(window.location.protocol)
    )
      return;
    let stopped = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      attempt = 0;
    function connect() {
      if (stopped || document.visibilityState === "hidden") return;
      const connection = new WebSocket(
        `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/notifications/live`,
      );
      socket = connection;
      socket.onmessage = (event) => {
        let payload: InboxSummary & { type?: string };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        if (
          payload.type !== "notifications" ||
          !Number.isInteger(payload.unread) ||
          payload.unread < 0 ||
          !(payload.revision === null || typeof payload.revision === "string")
        )
          return;
        setConnected(true);
        attempt = 0;
        const previous = cache.getQueryData<InboxSummary>([
          ...inboxKey(user),
          "summary",
        ]);
        cache.setQueryData([...inboxKey(user), "summary"], {
          unread: payload.unread,
          revision: payload.revision,
        });
        if (!previous || previous.revision !== payload.revision)
          void cache.invalidateQueries({
            predicate: (q) =>
              q.queryKey[0] === "notifications" &&
              q.queryKey[1] === user &&
              q.queryKey[2] !== "summary",
          });
      };
      socket.onerror = () => connection.close();
      socket.onclose = (event) => {
        if (stopped || socket !== connection) return;
        setConnected(false);
        if (
          stopped ||
          event.code === 1008 ||
          document.visibilityState === "hidden"
        )
          return;
        timer = setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
        );
      };
    }
    function visibility() {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        socket?.close();
        return;
      }
      void cache.invalidateQueries({ queryKey: inboxKey(user) });
      if (!socket || socket.readyState >= 2) connect();
    }
    connect();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      socket?.close();
    };
  }, [user, live, cache]);
  return query;
}

export function useMessageAction(user: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      read?: boolean;
      archived?: boolean;
    }) => api(`/notifications/${id}`, "PUT", body),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: inboxKey(user) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
