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
  Download,
  CircleHelp,
  ClipboardCheck,
  ListChecks,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useAction } from "@/lib/api";
import type { SubmissionUsage } from "@/lib/submission-limits";
import type { QuestionLogic } from "@/lib/competition";
import { useExclusiveSubmission } from "./exclusive-submission";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OperationProgress } from "./operation-progress";
import { ResourceError } from "./resource-error";
import { QueryState } from "./shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
type Job = {
  id: string;
  status: string;
  patch_name: string;
  error: string | null;
  result?: {
    verdict?:
      | "checking"
      | "update_error"
      | "service_error"
      | "exploit_success"
      | "defended"
      | "error";
    stage?: string;
  };
  created_at: string;
  finished_at: string | null;
};
type PatchResponse = {
  items: Job[];
  usage?: SubmissionUsage;
  next_operation_at?: string | null;
  submission: {
    format: "tar.gz";
    entrypoint: "update.sh";
    workdir: string;
    timeout: number;
    restart_required: false;
  };
};
const running = (job?: Job) =>
  !!job && ["queued", "building", "checking"].includes(job.status);
export function PatchPanel({
  id,
  scope,
  title = "本题",
  contestLogic,
  active = true,
  completed = false,
}: {
  id: string;
  scope: string;
  title?: string;
  contestLogic?: QuestionLogic & { exclusive_selected: boolean };
  active?: boolean;
  completed?: boolean;
}) {
  const exclusive = useExclusiveSubmission(scope);
  const path = `/challenges/${id}/patches?scope=${encodeURIComponent(scope)}`,
    cache = useQueryClient();
  const query = useQuery({
    queryKey: [path],
    queryFn: () => api<PatchResponse>(path),
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
      cache.setQueryData<PatchResponse>(
        [path],
        (old) =>
          old && {
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
          },
      );
      setFile(null);
      if (input.current) input.current.value = "";
      return created;
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
    update_error: "更新失败",
    service_error: "服务异常",
    exploit_success: "EXP 利用成功",
    defended: "防御成功",
    error: "校验基础设施异常",
    checking: "校验中",
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
      : job?.result?.stage === "updating"
        ? "执行更新脚本"
        : job?.status === "building"
          ? "构建补丁"
          : job?.result?.stage === "functional"
            ? "正常服务检测"
            : "漏洞利用检测";
  return (
    <div aria-label="防守补丁" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a
            href={`/api/challenges/${id}/patches/example?scope=${encodeURIComponent(scope)}`}
            download="defense-example.tar.gz"
          >
            <Download />
            下载示例
          </a>
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <CircleHelp />
              提交说明
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>提交防守补丁</DialogTitle>
              <DialogDescription>
                tar.gz，最多 20 MiB；示例仅为模板，请替换为实际修复。
              </DialogDescription>
            </DialogHeader>
            <section className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-primary">
                <Upload aria-hidden="true" className="size-4" />
                提交方法
              </h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>下载示例，替换 files 内文件，按需修改 update.sh。</li>
                <li>
                  在 update.sh 与 files 所在目录打包，不套外层目录：
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    <code>
                      COPYFILE_DISABLE=1 tar --format=ustar -czf defense.tar.gz
                      update.sh files
                    </code>
                  </pre>
                </li>
                <li>选择 defense.tar.gz 并提交，等待更新与校验结果。</li>
              </ol>
            </section>
            <section className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-warning">
                <ClipboardCheck aria-hidden="true" className="size-4" />
                提交要求
              </h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>
                  根目录须含非空普通文件 update.sh，由 /bin/sh 执行，无需
                  chmod。
                </li>
                <li>
                  包内文件通过{" "}
                  <code className="break-all">PATCH_DIR=/.nebuctf-update</code>{" "}
                  访问。
                  {query.data?.submission && (
                    <>
                      执行目录{" "}
                      <code className="break-all">
                        {query.data.submission.workdir}
                      </code>
                      ， 更新限时 {query.data.submission.timeout} 秒。
                    </>
                  )}
                </li>
                <li>
                  退出 0
                  后才进入校验；平台自动启动服务，脚本无需也不得启动或重启服务。
                </li>
              </ul>
            </section>
            <section className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-primary">
                <ListChecks aria-hidden="true" className="size-4" />
                结果说明
              </h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  <span>
                    <strong className="font-medium text-destructive">
                      更新失败
                    </strong>
                    <span className="text-muted-foreground">
                      ：脚本未成功完成。
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ServerCrash
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  <span>
                    <strong className="font-medium text-destructive">
                      服务异常
                    </strong>
                    <span className="text-muted-foreground">
                      ：正常功能未通过。
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ShieldAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  <span>
                    <strong className="font-medium text-warning">
                      EXP 利用成功
                    </strong>
                    <span className="text-muted-foreground">
                      ：漏洞仍可利用。
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                  <span>
                    <strong className="font-medium text-success">
                      防御成功
                    </strong>
                    <span className="text-muted-foreground">：全部通过。</span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>
                    <strong className="font-medium">校验基础设施异常</strong>
                    <span className="text-muted-foreground">
                      ：判题未能完成。
                    </span>
                  </span>
                </li>
              </ul>
            </section>
          </DialogContent>
        </Dialog>
      </div>
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
                ? job?.result?.stage === "updating"
                  ? "更新中"
                  : "校验中"
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
              accept=".tar.gz,.tgz"
              aria-label="选择 tar.gz 防守补丁包"
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
              onClick={() =>
                exclusive.confirm(
                  [{ id, title, contest_logic: contestLogic }],
                  () => upload.mutateAsync(),
                )
              }
            >
              {failed ? <RotateCw /> : <Upload />}
              {cooldown > 0 ? `${cooldown} 秒后可提交` : "提交补丁"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>tar.gz，根目录含 update.sh，最多 20 MiB</span>
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
        (upload.error ||
          (failed &&
            (verdict === "error" || verdict === "update_error") &&
            job?.error)) && (
          <ResourceError error={upload.error ?? job!.error!} />
        )}
      {exclusive.dialog}
    </div>
  );
}
