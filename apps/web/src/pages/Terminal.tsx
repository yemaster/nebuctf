import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  RotateCw,
  Square,
  Terminal as TerminalIcon,
} from "lucide-react";
import { api, ApiError, useAPI } from "@/lib/api";
import { useResourceCooldown } from "@/lib/instances";
import type { Instance, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loading, LoginPrompt, QueryState } from "@/components/shared";
import { useLoadingState } from "@/components/loading-transition";
import { OperationProgress } from "@/components/operation-progress";
import { ResourceError } from "@/components/resource-error";
import { ConfirmAction } from "@/components/confirm-action";
import { TerminalFrame, TerminalTool } from "@/components/terminal-frame";
const WebTerminal = lazy(() =>
  import("@/components/web-terminal").then((m) => ({ default: m.WebTerminal })),
);
type TerminalInstance = Pick<
  Instance,
  | "id"
  | "status"
  | "error"
  | "expires_at"
  | "max_expires_at"
  | "ttl"
  | "renew_count"
  | "renew_limit"
  | "next_operation_at"
  | "queue_ahead"
>;
type TerminalData = { instance: TerminalInstance | null };
type Target = { id: string; title: string; endpoint: string; href: string };

function Lifetime({ instance }: { instance: TerminalInstance }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(instance.expires_at) - now) / 1000),
  );
  return (
    <div className="mr-3 flex items-center gap-2" title="终端剩余时间">
      <span className="font-mono text-xs tabular-nums">
        {seconds >= 3600 ? `${Math.floor(seconds / 3600)}:` : ""}
        {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")}
      </span>
      <Progress
        className="h-1 w-16"
        value={Math.min(100, (seconds / (instance.ttl ?? 1800)) * 100)}
        aria-label="终端剩余时间"
      />
    </div>
  );
}
export function TerminalPage() {
  const [params, setParams] = useSearchParams();
  const targetId = params.get("target") || undefined;
  const identity = useAPI<{ user: User | null }>("/me");
  const target = useAPI<Target>(
    `/terminal/targets/${encodeURIComponent(targetId ?? "")}`,
    !!targetId && !!identity.data?.user,
  );
  const query = useQuery({
    queryKey: ["/terminal"],
    queryFn: ({ signal }) =>
      api<TerminalData>("/terminal", "GET", undefined, signal),
    enabled: !!identity.data?.user,
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      ["queued", "starting", "stopping"].includes(
        q.state.data?.instance?.status ?? "",
      )
        ? 1500
        : q.state.data?.instance?.status === "running"
          ? 15000
          : false,
  });
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const autoStarted = useRef<string | null>(null);
  const instance = query.data?.instance;
  const action = useMutation({
    mutationFn: async (type: "start" | "stop" | "renew") => {
      const result = await api<{
        id?: string;
        status?: string;
        expires_at?: string;
        renew_count?: number;
      }>(
        type === "start" ? "/terminal" : `/instances/${instance!.id}/${type}`,
        "POST",
        type === "start" && targetId ? { target: targetId } : undefined,
      );
      cache.setQueryData<TerminalData>(["/terminal"], (old) => ({
        instance:
          type === "start"
            ? {
                id: result.id!,
                status: result.status!,
                error: null,
                expires_at: "",
              }
            : old?.instance
              ? {
                  ...old.instance,
                  ...(type === "stop"
                    ? { status: "stopping" }
                    : {
                        expires_at: result.expires_at!,
                        renew_count: result.renew_count,
                      }),
                }
              : null,
      }));
      setConfirm(false);
      await cache.invalidateQueries({ queryKey: ["/terminal"] });
      void cache.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("/instances"),
      });
    },
  });
  const error = action.error;
  const cooldown = useResourceCooldown(
    instance?.next_operation_at,
    error instanceof ApiError ? error.retryAfter : undefined,
  );
  const pending =
    identity.isPending ||
    (!!identity.data?.user &&
      (query.isPending || (!!targetId && target.isPending)));
  useLoadingState(pending);
  useEffect(() => {
    if (
      !targetId ||
      !target.data ||
      target.error ||
      !query.data ||
      query.error ||
      autoStarted.current === targetId
    )
      return;
    autoStarted.current = targetId;
    if (
      !["queued", "starting", "running", "stopping"].includes(
        query.data.instance?.status ?? "",
      )
    )
      action.mutate("start");
  }, [targetId, target.data, target.error, query.data, query.error]);
  useEffect(() => {
    if (instance?.status !== "running") return;
    const delay = Date.parse(instance.expires_at) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => void query.refetch(), delay + 50);
    return () => clearTimeout(timer);
  }, [instance?.status, instance?.expires_at]);
  if (pending) return null;
  if (identity.error || query.error)
    return (
      <QueryState
        loading={false}
        error={identity.error ?? query.error}
        retry={() => {
          void identity.refetch();
          void query.refetch();
        }}
      />
    );
  if (!identity.data?.user) return <LoginPrompt />;
  const creating =
    (action.isPending && action.variables === "start") ||
    ["queued", "starting"].includes(instance?.status ?? "");
  const stopping =
    instance?.status === "stopping" ||
    (action.isPending && action.variables === "stop");
  const running =
    instance?.status === "running" &&
    Date.parse(instance.expires_at) > Date.now();
  const busy = creating || stopping || action.isPending;
  const title = (
    <>
      {target.data && (
        <TerminalTool label="返回题目" asChild>
          <Link to={target.data.href}>
            <ArrowLeft />
          </Link>
        </TerminalTool>
      )}
      <h1 className="truncate text-sm font-medium">
        {target.data?.title ?? "终端"}
      </h1>
      {target.data && (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {target.data.endpoint}
        </span>
      )}
    </>
  );
  const actions = (
    <>
      <OperationProgress
        compact
        busy={busy}
        failed={!!error || instance?.status === "failed"}
        label={
          creating
            ? instance?.queue_ahead
              ? `排队中，前方 ${instance.queue_ahead} 个任务`
              : "正在启动"
            : stopping || action.variables === "stop"
              ? "正在销毁"
              : action.variables === "start"
                ? "正在启动"
                : "正在续期"
        }
        completeLabel={
          stopping || action.variables === "stop" ? "已销毁" : "已完成"
        }
        idle={running ? <Lifetime instance={instance!} /> : undefined}
      />
      {(running || creating) && (
        <>
          <TerminalTool
            label="续期"
            disabled={
              !running ||
              busy ||
              (instance?.renew_count ?? 0) >= (instance?.renew_limit ?? 0)
            }
            onClick={() => action.mutate("renew")}
          >
            <RotateCw />
          </TerminalTool>
          <TerminalTool
            label={cooldown ? `${cooldown} 秒后可销毁` : "销毁终端"}
            className="size-8 text-destructive hover:text-destructive"
            disabled={busy || cooldown > 0}
            onClick={() => setConfirm(true)}
          >
            <Square />
          </TerminalTool>
        </>
      )}
      {targetId && (
        <TerminalTool label="切换到 shell" onClick={() => setParams({})}>
          <TerminalIcon />
        </TerminalTool>
      )}
    </>
  );
  const placeholder = (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      {creating || stopping ? (
        <Loading />
      ) : (
        <div className="flex max-w-lg flex-col items-center gap-4">
          {target.error ? (
            <ResourceError error={target.error} />
          ) : (
            <>
              <Button
                disabled={busy || cooldown > 0}
                onClick={() => action.mutate("start")}
              >
                <Play />
                {instance?.status === "failed" ? "重新启动" : "启动终端"}
                {cooldown > 0 && (
                  <span className="tabular-nums">{cooldown}s</span>
                )}
              </Button>
              {instance?.error && <ResourceError error={instance.error} />}
            </>
          )}
        </div>
      )}
    </div>
  );
  return (
    <section
      className="flex h-[calc(100dvh-9rem)] min-h-[480px] flex-col"
      aria-label="终端"
    >
      <Suspense
        fallback={
          <TerminalFrame title={title}>
            <Loading />
          </TerminalFrame>
        }
      >
        <WebTerminal
          id={running && !stopping && !target.error ? instance!.id : undefined}
          target={targetId}
          onDisconnect={() => {
            if (targetId) void target.refetch();
            void query.refetch();
          }}
          title={title}
          actions={actions}
          notice={error && <ResourceError error={error} />}
          placeholder={placeholder}
        />
      </Suspense>
      <ConfirmAction
        open={confirm}
        onOpenChange={setConfirm}
        title="销毁终端"
        description="终端内的文件和进程将被清除。"
        confirm="销毁"
        pending={action.isPending}
        onConfirm={() => action.mutate("stop")}
      />
    </section>
  );
}
