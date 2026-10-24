import type { ResourceProfile } from "@/lib/competition";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  Download,
  RefreshCw,
  Play,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import { endpointURL, date } from "@/lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import { QueryState } from "../shared";
import { OperationProgress } from "../operation-progress";
import { ActionError } from "../action-error";

export type ImageRecord = {
  image: string;
  present: boolean;
  image_id?: string;
  size?: number;
  checked_at?: string;
  challenges: { id: string; title: string }[];
  job_id?: string;
  job_status?: string;
  job_error?: string;
  worker?: { online: boolean; error?: string };
};
type PullJob = {
  id: string;
  reference: string;
  status: string;
  error?: string;
  layers: { id: string; status: string; current: number; total: number }[];
  logs: { time: string; message: string }[];
};
const pulling = (status?: string) =>
  status === "queued" || status === "pulling";
export const imageState = (item: ImageRecord) =>
  pulling(item.job_status)
    ? "拉取中"
    : item.present
      ? "已就绪"
      : item.job_status === "failed"
        ? "拉取失败"
        : "未拉取";
export const imageSize = (bytes?: number) =>
  bytes == null
    ? "—"
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function PullDialog({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const query = useQuery<PullJob>({
    queryKey: [`/admin/images/pulls/${jobId}`],
    queryFn: () => api(`/admin/images/pulls/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) =>
      !q.state.data || pulling(q.state.data.status) ? 1000 : false,
  });
  const job = query.data;
  return (
    <Dialog
      open={!!jobId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>拉取镜像</DialogTitle>
          <DialogDescription className="break-all">
            {job?.reference ?? "正在读取任务"}
          </DialogDescription>
        </DialogHeader>
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {job && (
          <>
            <div className="flex items-center justify-between gap-3">
              <Badge
                variant="secondary"
                className={
                  job.status === "failed"
                    ? "text-destructive"
                    : job.status === "succeeded"
                      ? "text-success"
                      : ""
                }
              >
                {
                  (
                    {
                      queued: "等待拉取",
                      pulling: "正在拉取",
                      succeeded: "拉取完成",
                      failed: "拉取失败",
                    } as Record<string, string>
                  )[job.status]
                }
              </Badge>
              {pulling(job.status) && (
                <span className="text-xs text-muted-foreground">
                  关闭窗口后继续拉取
                </span>
              )}
            </div>
            <div
              className="max-h-[30dvh] space-y-3 overflow-y-auto"
              aria-label="镜像分层进度"
            >
              {job.layers.map((layer) => (
                <div key={layer.id} className="space-y-1.5">
                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="font-mono">{layer.id}</span>
                    <span className="text-muted-foreground">
                      {layer.status}
                      {layer.total > 0
                        ? ` ${imageSize(layer.current)} / ${imageSize(layer.total)}`
                        : ""}
                    </span>
                  </div>
                  {layer.total > 0 && (
                    <Progress
                      value={Math.min(100, (layer.current / layer.total) * 100)}
                      aria-label={`${layer.id} 拉取进度`}
                    />
                  )}
                </div>
              ))}
            </div>
            <pre
              aria-label="镜像拉取日志"
              className="max-h-[28dvh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 text-xs leading-6"
            >
              {job.logs.length
                ? job.logs
                    .map(
                      (line) =>
                        `${new Date(line.time).toLocaleTimeString()} ${line.message}`,
                    )
                    .join("\n")
                : "等待 Worker 开始拉取"}
            </pre>
            {job.error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {job.error}
              </p>
            )}
          </>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {job?.status === "succeeded" ? "完成" : "关闭"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ImagePullButton({
  image,
  jobId,
  working,
  disabled,
  onOpen,
}: {
  image: string;
  jobId?: string;
  working?: boolean;
  disabled?: boolean;
  onOpen: (id: string) => void;
}) {
  const pull = useAction(async () => {
    const job = await api<{ id: string }>("/admin/images/pull", "POST", {
      image,
    });
    onOpen(job.id);
  });
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled || pull.isPending}
      onClick={() => (working && jobId ? onOpen(jobId) : pull.mutate())}
    >
      {working ? (
        <RefreshCw className="motion-safe:animate-spin" />
      ) : (
        <Download />
      )}
      {working ? "查看拉取进度" : pull.isPending ? "提交中" : "拉取镜像"}
    </Button>
  );
}
type TestInstance = {
  id: string;
  status: string;
  kind: string;
  endpoint?: string;
  error?: string;
  expires_at: string;
  image: string;
};
export function ImageTools({
  image,
  challengeId,
  kind,
  savedKind,
  formRef,
  resourceType,
  profile,
}: {
  image: string;
  challengeId?: string;
  kind: string;
  savedKind?: string;
  resourceType?: "container" | "attachment";
  profile?: ResourceProfile;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  const [reference, setReference] = useState(image),
    [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setReference(image.trim()), 400);
    return () => clearTimeout(timer);
  }, [image]);
  const info = useAPI<ImageRecord>(
    `/admin/images/status?image=${encodeURIComponent(reference)}`,
    !!reference,
    3000,
  );
  const environment = useAPI<{
    instance: TestInstance | null;
    next_operation_at: string | null;
  }>(
    `/admin/challenges/${challengeId}/test-instance${resourceType ? `?resource_type=${resourceType}` : ""}`,
    !!challengeId,
    3000,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(environment.data?.next_operation_at ?? "") - now) / 1000,
    ) || 0,
  );
  const instance = environment.data?.instance;
  const active =
    !!instance &&
    ["queued", "starting", "running", "ready", "stopping"].includes(
      instance.status,
    );
  const action = useAction(
    async (stop: boolean) => {
      if (stop && instance)
        return api(`/instances/${instance.id}/stop`, "POST", {});
      const form = formRef.current;
      if (!form) return;
      const f = new FormData(form);
      const spec = {
        image,
        access_mode: f.get("access_mode") ?? "port",
        port: Number(f.get("port") ?? 8080),
        cpu: Number(f.get("cpu")),
        memory: Number(f.get("memory")),
      };
      return api(`/admin/challenges/${challengeId}/test-instance`, "POST", {
        ...(profile ?? spec),
        resource_type: resourceType,
      });
    },
    undefined,
    false,
  );
  const ready =
    info.data?.present &&
    info.data.worker?.online &&
    image.trim() === reference;
  const busy =
    action.isPending ||
    (!!instance &&
      ["queued", "starting", "stopping"].includes(instance.status));
  const endpoint = instance?.endpoint ? endpointURL(instance.endpoint) : null;
  return (
    <div className="mt-4 space-y-4" aria-label="镜像与测试环境">
      <div className="flex flex-wrap items-center gap-3">
        {info.data && (
          <Badge variant="secondary">{imageState(info.data)}</Badge>
        )}
        {reference &&
          (!info.data?.present || pulling(info.data.job_status)) && (
            <ImagePullButton
              image={reference}
              jobId={info.data?.job_id}
              working={pulling(info.data?.job_status)}
              disabled={
                !info.data?.worker?.online || reference !== image.trim()
              }
              onOpen={setJobId}
            />
          )}
        {info.data?.job_id && !pulling(info.data.job_status) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setJobId(info.data!.job_id!)}
          >
            拉取日志
          </Button>
        )}
        {(ready || active) && (
          <Button
            type="button"
            size="sm"
            variant={active ? "secondary" : "default"}
            disabled={
              action.isPending ||
              instance?.status === "stopping" ||
              !challengeId ||
              (!active && !resourceType && kind !== savedKind) ||
              seconds > 0
            }
            onClick={() => action.mutate(active)}
          >
            {active ? <Square /> : <Play />}
            {seconds > 0
              ? `${seconds} 秒后可操作`
              : active
                ? "停止测试环境"
                : kind === "dynamic_attachment"
                  ? "测试生成附件"
                  : "启动测试靶机"}
          </Button>
        )}
        {!challengeId && ready && (
          <span className="text-xs text-muted-foreground">
            保存题目后可测试
          </span>
        )}
        {challengeId && !resourceType && kind !== savedKind && (
          <span className="text-xs text-muted-foreground">
            请先保存题目类型
          </span>
        )}
        {info.data && !info.data.worker?.online && (
          <span className="text-xs text-muted-foreground">
            等待 Docker Worker 连接
          </span>
        )}
      </div>
      {info.error && <ActionError error={info.error} />}
      <QueryState
        loading={false}
        error={environment.error}
        retry={() => void environment.refetch()}
      />
      <OperationProgress
        busy={busy}
        failed={!!action.error || instance?.status === "failed"}
        label={
          instance?.status === "stopping"
            ? "正在停止测试环境"
            : "正在准备测试环境"
        }
        completeLabel="测试环境已更新"
      />
      {active && instance?.status === "running" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-background p-4">
          <span className="min-w-0 flex-1 break-all text-sm">
            {instance.endpoint}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="复制测试靶机地址"
            onClick={() =>
              navigator.clipboard
                .writeText(instance.endpoint ?? "")
                .then(() => toast.success("已复制"))
                .catch(() => toast.error("复制失败"))
            }
          >
            <Copy />
          </Button>
          {endpoint && (
            <Button asChild size="icon-sm" variant="ghost">
              <a
                href={endpoint}
                target="_blank"
                rel="noreferrer"
                aria-label="打开测试靶机"
              >
                <ExternalLink />
              </a>
            </Button>
          )}
          <span className="w-full text-xs text-muted-foreground">
            运行至 {date(instance.expires_at)}
          </span>
        </div>
      )}
      {active && instance?.status === "ready" && (
        <Button type="button" variant="secondary" asChild>
          <a href={`/api/instances/${instance.id}/artifact`}>
            <Download />
            下载测试附件
          </a>
        </Button>
      )}
      {instance?.error && ["failed", "stopping"].includes(instance.status) && (
        <p className="break-words text-sm text-destructive">{instance.error}</p>
      )}
      {action.error && <ActionError error={action.error} />}
      <PullDialog
        jobId={jobId}
        onClose={() => {
          setJobId(null);
          void info.refetch();
        }}
      />
    </div>
  );
}

export function CheckerImageTools({ image }: { image: string }) {
  const [reference, setReference] = useState(image.trim());
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setReference(image.trim()), 400);
    return () => clearTimeout(timer);
  }, [image]);
  const query = useAPI<ImageRecord>(
    `/admin/images/status?image=${encodeURIComponent(reference)}`,
    !!reference,
    3000,
  );
  const item = query.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {item && <Badge variant="secondary">{imageState(item)}</Badge>}
        {reference && (!item?.present || pulling(item.job_status)) && (
          <ImagePullButton
            image={reference}
            jobId={item?.job_id}
            working={pulling(item?.job_status)}
            disabled={!item?.worker?.online || reference !== image.trim()}
            onOpen={setJobId}
          />
        )}
        {item?.job_id && !pulling(item.job_status) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setJobId(item.job_id!)}
          >
            拉取日志
          </Button>
        )}
      </div>
      {query.error && <ActionError error={query.error} />}
      <PullDialog jobId={jobId} onClose={() => setJobId(null)} />
    </div>
  );
}
