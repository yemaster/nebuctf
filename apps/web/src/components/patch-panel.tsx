import { useResourceCooldown } from "@/lib/instances";
import { useRef, useState, useEffect } from "react";
import {
  Upload,
  RotateCw,
  CheckCircle2,
  LoaderCircle,
  ShieldAlert,
  ServerCrash,
  CircleAlert,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useAction } from "@/lib/api";
import type { SubmissionUsage } from "@/lib/submission-limits";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OperationProgress } from "./operation-progress";
import { ResourceError } from "./resource-error";
import { QueryState } from "./shared";
type Job = {
  id: string;
  status: string;
  patch_name: string;
  error: string | null;
  result?: {
    verdict?:
      "checking" | "service_error" | "exploit_success" | "defended" | "error";
    stage?: string;
  };
  created_at: string;
  finished_at: string | null;
};
const running = (job?: Job) =>
  !!job && ["queued", "building", "checking"].includes(job.status);
export function PatchPanel({
  id,
  scope,
  active = true,
  completed = false,
}: {
  id: string;
  scope: string;
  active?: boolean;
  completed?: boolean;
}) {
  const path = `/challenges/${id}/patches?scope=${scope}`,
    cache = useQueryClient();
  const query = useQuery({
    queryKey: [path],
    queryFn: () =>
      api<{
        items: Job[];
        usage?: SubmissionUsage;
        next_operation_at?: string | null;
      }>(path),
    refetchInterval: (q) =>
      running(q.state.data?.items?.[0]) ? 1000 : active ? 10000 : false,
  });
  const input = useRef<HTMLInputElement>(null),
    [file, setFile] = useState<File | null>(null);
  const job = query.data?.items?.[0],
    busy = running(job),
    usage = query.data?.usage;
  const upload = useAction(
    async () => {
      if (!file || busy || usage?.remaining === 0) return;
      const form = new FormData();
      form.append("file", file);
      const created = await api<{ id: string; status: string }>(
        path,
        "POST",
        form,
      ).catch((error) => {
        void query.refetch();
        throw error;
      });
      cache.setQueryData<{
        items: Job[];
        usage?: SubmissionUsage;
        next_operation_at?: string | null;
      }>([path], (old) => ({
        ...old,
        items: [
          {
            id: created.id,
            status: created.status,
            patch_name: file.name,
            error: null,
            result: { verdict: "checking" as const, stage: "queued" },
            created_at: new Date().toISOString(),
            finished_at: null,
          },
          ...(old?.items ?? []),
        ].slice(0, 10),
      }));
      setFile(null);
      if (input.current) input.current.value = "";
    },
    undefined,
    false,
  );
  const cooldown = useResourceCooldown(
    query.data?.next_operation_at,
    upload.error instanceof ApiError ? upload.error.retryAfter : undefined,
  );
  useEffect(() => {
    if (job?.finished_at)
      void cache.invalidateQueries({
        queryKey: [`/challenges/${id}?scope=${scope}`],
      });
  }, [job?.id, job?.finished_at, cache, id, scope]);
  if (query.isLoading || query.error)
    return (
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const verdict =
    job?.result?.verdict ??
    (job?.status === "passed"
      ? "defended"
      : job?.status === "failed"
        ? "error"
        : undefined);
  const labels = {
    service_error: "服务异常",
    exploit_success: "EXP 利用成功",
    defended: "防御成功",
    error: "校验异常",
    checking: "Check 中",
  };
  const done = completed && !busy;
  const Icon = busy
    ? LoaderCircle
    : verdict === "defended" || done
      ? CheckCircle2
      : verdict === "service_error"
        ? ServerCrash
        : verdict === "exploit_success"
          ? ShieldAlert
          : CircleAlert;
  const failed = job?.status === "failed" || job?.status === "cancelled";
  const stage =
    job?.status === "queued"
      ? "等待校验"
      : job?.status === "building"
        ? "构建补丁"
        : job?.result?.stage === "functional"
          ? "正常服务检测"
          : "漏洞利用检测";
  return (
    <div aria-label="防守补丁" className="space-y-3">
      {(job || done) && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-3"
        >
          <Icon
            className={`size-5 shrink-0 ${busy ? "animate-spin text-primary" : verdict === "defended" || done ? "text-success" : failed ? "text-destructive" : "text-muted-foreground"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {busy
                ? "Check 中"
                : done
                  ? "防御成功"
                  : job?.status === "cancelled"
                    ? "已取消"
                    : labels[verdict ?? "checking"]}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {busy
                ? stage
                : verdict === "service_error"
                  ? "正常服务检测失败"
                  : verdict === "exploit_success"
                    ? "漏洞仍可利用"
                    : job?.patch_name}
            </p>
          </div>
        </div>
      )}
      {!done && (
        <>
          <div className="flex flex-wrap gap-3">
            <Input
              ref={input}
              type="file"
              accept=".tar,.tar.gz,.tgz"
              aria-label="选择补丁包"
              className="min-w-0 flex-1"
              disabled={busy || upload.isPending || usage?.remaining === 0}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              disabled={
                !file ||
                busy ||
                upload.isPending ||
                usage?.remaining === 0 ||
                cooldown > 0
              }
              onClick={() => upload.mutate()}
            >
              {failed ? <RotateCw /> : <Upload />}
              {cooldown > 0 ? `${cooldown} 秒后可提交` : "提交补丁"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>tar / tar.gz，最多 20 MiB</span>
            {usage?.limit != null && (
              <span
                className={`tabular-nums ${usage.remaining === 0 ? "text-destructive" : ""}`}
              >
                {usage.remaining === 0
                  ? "防御申请次数已用完"
                  : `剩余 ${usage.remaining} / ${usage.limit} 次申请`}
              </span>
            )}
          </div>
        </>
      )}
      <OperationProgress
        busy={busy || upload.isPending}
        failed={upload.isError || failed}
        label={upload.isPending ? "正在上传补丁" : busy ? stage : "校验结束"}
        completeLabel={verdict === "defended" ? "防御成功" : "校验完成"}
      />
      {!busy &&
        (upload.error || (failed && verdict === "error" && job?.error)) && (
          <ResourceError error={upload.error ?? job!.error!} />
        )}
    </div>
  );
}
