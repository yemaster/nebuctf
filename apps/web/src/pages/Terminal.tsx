import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, RotateCw, Square, Terminal as TerminalIcon } from "lucide-react";
import { api, ApiError, useAPI, useAction } from "@/lib/api";
import { useResourceCooldown } from "@/lib/instances";
import type { Instance, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loading, LoginPrompt, QueryState } from "@/components/shared";
import { useLoadingState } from "@/components/loading-transition";
import { OperationProgress } from "@/components/operation-progress";
import { ResourceError } from "@/components/resource-error";
import { ConfirmAction } from "@/components/confirm-action";
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
export function TerminalPage() {
  const identity = useAPI<{ user: User | null }>("/me");
  const query = useAPI<{ instance: TerminalInstance | null }>(
    "/terminal",
    !!identity.data?.user,
    3000,
  );
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now);
  const instance = query.data?.instance;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const action = useAction(
    async (type: "start" | "stop" | "renew") => {
      const result = await api<{
        id?: string;
        status?: string;
        expires_at?: string;
        renew_count?: number;
      }>(
        type === "start" ? "/terminal" : `/instances/${instance!.id}/${type}`,
        "POST",
      );
      cache.setQueryData<{ instance: TerminalInstance | null }>(
        ["/terminal"],
        (old) => ({
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
        }),
      );
      setConfirm(false);
    },
    undefined,
    false,
  );
  const error = action.error;
  const cooldown = useResourceCooldown(
    instance?.next_operation_at,
    error instanceof ApiError ? error.retryAfter : undefined,
  );
  const pending =
    identity.isPending || (!!identity.data?.user && query.isPending);
  useLoadingState(pending);
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
    instance?.status === "running" && Date.parse(instance.expires_at) > now;
  const busy = creating || stopping || action.isPending;
  const seconds = running
    ? Math.max(0, Math.ceil((Date.parse(instance.expires_at) - now) / 1000))
    : 0;
  const lifetime = running ? (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="shrink-0">
        剩余{" "}
        <span className="font-mono tabular-nums text-foreground">
          {Math.floor(seconds / 3600) > 0
            ? `${Math.floor(seconds / 3600)}:`
            : ""}
          {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </span>
      </span>
      <Progress
        className="h-1.5 max-w-52"
        value={Math.min(100, (seconds / (instance?.ttl ?? 1800)) * 100)}
        aria-label="终端剩余时间"
      />
    </div>
  ) : undefined;
  return (
    <section
      className="flex h-[calc(100dvh-10rem)] min-h-[480px] flex-col gap-4"
      aria-label="终端"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="mr-3 text-2xl font-semibold">终端</h1>
        <Badge variant="outline">Linux</Badge>
        {(running || creating) && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                !running ||
                busy ||
                (instance?.renew_count ?? 0) >= (instance?.renew_limit ?? 0)
              }
              onClick={() => action.mutate("renew")}
            >
              <RotateCw />
              续期
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || cooldown > 0}
              title={cooldown ? `${cooldown} 秒后可操作` : undefined}
              onClick={() => setConfirm(true)}
            >
              <Square />
              销毁
              {cooldown > 0 && (
                <span className="tabular-nums">{cooldown}s</span>
              )}
            </Button>
          </>
        )}
      </header>
      {error && <ResourceError error={error} />}
      <div className="shrink-0">
        <OperationProgress
          busy={busy}
          failed={!!error || instance?.status === "failed"}
          label={
            creating
              ? instance?.queue_ahead != null && instance.queue_ahead > 0
                ? `排队中，前方 ${instance.queue_ahead} 个任务`
                : "正在启动终端"
              : stopping
                ? "正在销毁"
                : "正在续期"
          }
          completeLabel={stopping ? "已销毁" : "已完成"}
          idle={lifetime}
        />
      </div>
      {running && !stopping ? (
        <Suspense fallback={<Loading />}>
          <WebTerminal key={instance!.id} id={instance!.id} />
        </Suspense>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-lg border bg-card">
          <TerminalIcon
            className="size-10 text-muted-foreground"
            strokeWidth={1.5}
          />
          {creating || stopping ? (
            <p role="status" className="text-sm text-muted-foreground">
              {stopping ? "正在销毁" : "准备终端环境"}
            </p>
          ) : (
            <>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  bash / nc / curl / python3
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  文件在销毁或到期后清除
                </p>
              </div>
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
              {instance?.error && (
                <div className="max-w-md px-6 text-center">
                  <ResourceError error={instance.error} />
                </div>
              )}
            </>
          )}
        </div>
      )}
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
