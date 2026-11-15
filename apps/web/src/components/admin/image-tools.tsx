import { copyText } from "@/lib/clipboard";
import {
  Terminal,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Loader2,
  ChevronDown,
} from "lucide-react";
import type { ResourceProfile } from "@/lib/competition";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { ScrollArea } from "../ui/scroll-area";
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
  job_kind?: "pull" | "load";
  job_error?: string;
  worker?: { online: boolean; error?: string };
};
type PullJob = {
  id: string;
  reference: string;
  status: string;
  kind?: "pull" | "load";
  error?: string;
  layers: { id: string; status: string; current: number; total: number }[];
  logs: { time: string; message: string }[];
};
const pulling = (status?: string) =>
  status === "queued" || status === "pulling";
export const imageState = (item: ImageRecord) =>
  pulling(item.job_status)
    ? item.job_kind === "load"
      ? "导入中"
      : "拉取中"
    : item.present
      ? "已就绪"
      : item.job_status === "failed"
        ? item.job_kind === "load"
          ? "导入失败"
          : "拉取失败"
        : "未拉取";
export function ImageStatus({ item }: { item: ImageRecord }) {
  return (
    <Badge
      variant="secondary"
      className={
        pulling(item.job_status)
          ? "bg-warning/10 text-warning"
          : item.present
            ? "bg-success/10 text-success"
            : item.job_status === "failed"
              ? "bg-destructive/10 text-destructive"
              : "text-muted-foreground"
      }
    >
      {imageState(item)}
    </Badge>
  );
}
export const imageSize = (bytes?: number) => {
  if (bytes == null) return "—";
  const unit = bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : 1;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["", "KiB", "MiB", "GiB"][unit]}`;
};
export type ImageUploadProgress = {
  filename: string;
  received: number;
  total: number;
  error?: string;
};
export function PullDialog({
  jobId,
  upload,
  onCancelUpload,
  onClose,
}: {
  jobId: string | null;
  upload?: ImageUploadProgress | null;
  onCancelUpload?: () => void;
  onClose: () => void;
}) {
  const query = useQuery<PullJob>({
    queryKey: [`/admin/images/pulls/${jobId}`],
    queryFn: () => api(`/admin/images/pulls/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) =>
      !q.state.data || pulling(q.state.data.status) ? 1000 : false,
  });
  const job = jobId ? query.data : undefined;
  const state = upload ? (upload.error ? "failed" : "uploading") : job?.status;
  const operation = upload || job?.kind === "load" ? "导入" : "拉取";
  const labels: Record<string, string> = {
    uploading: "正在上传",
    queued: "等待处理",
    pulling: `正在${operation}`,
    succeeded: `${operation}完成`,
    failed: upload ? "上传未完成" : `${operation}失败`,
  };
  const Icon =
    state === "succeeded"
      ? CheckCircle2
      : state === "failed"
        ? CircleAlert
        : state === "queued"
          ? Clock3
          : Loader2;
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const logText = upload
    ? `${upload.error ?? (upload.received === upload.total ? "上传完成，正在提交导入任务…" : "正在上传镜像归档…")}`
    : job?.logs
        .map(
          (line) =>
            `${new Date(line.time).toLocaleTimeString()}  ${line.message}`,
        )
        .join("\n") || "等待 Worker 开始处理…";
  useEffect(() => {
    const viewport = scroll.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    const onScroll = () => {
      follow.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32;
    };
    viewport.addEventListener("scroll", onScroll);
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [jobId, !!upload, !!job]);
  useEffect(() => {
    const viewport = scroll.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport && follow.current) viewport.scrollTop = viewport.scrollHeight;
  }, [logText]);
  useEffect(() => {
    follow.current = true;
  }, [jobId]);
  const layers = job?.layers ?? [];
  const completed = layers.filter((layer) =>
    /complete|already exists/i.test(layer.status),
  ).length;
  const error = upload?.error ?? job?.error;
  return (
    <Dialog
      open={!!jobId || !!upload}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{upload ? "上传镜像" : `${operation}镜像`}</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {upload?.filename ?? job?.reference ?? "正在读取任务"}
          </DialogDescription>
        </DialogHeader>
        {jobId && (
          <QueryState
            loading={query.isLoading}
            error={query.error}
            retry={() => void query.refetch()}
          />
        )}
        {(job || upload) && (
          <>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge
                  variant="secondary"
                  className={
                    state === "failed"
                      ? "gap-1.5 bg-destructive/10 text-destructive"
                      : state === "succeeded"
                        ? "gap-1.5 bg-success/10 text-success"
                        : "gap-1.5 bg-muted text-foreground"
                  }
                >
                  <Icon
                    className={`size-3.5 ${state === "pulling" || state === "uploading" ? "motion-safe:animate-spin" : ""}`}
                  />
                  {labels[state ?? ""]}
                </Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {upload
                    ? `${imageSize(upload.received)} / ${imageSize(upload.total)}`
                    : layers.length
                      ? `${completed} / ${layers.length} 层已就绪`
                      : null}
                </span>
              </div>
              {upload && (
                <Progress
                  value={(upload.received / upload.total) * 100}
                  aria-label="镜像上传进度"
                />
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-border/60 bg-zinc-950 text-zinc-200">
              <div className="flex h-10 items-center justify-between border-b border-white/10 px-3">
                <span className="flex items-center gap-2 text-xs text-zinc-400">
                  <Terminal className="size-3.5" />
                  任务日志
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="复制镜像日志"
                  className="text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                  onClick={() =>
                    void copyText(logText)
                      .then(() => toast.success("日志已复制"))
                      .catch(() => toast.error("复制失败"))
                  }
                >
                  <Copy />
                </Button>
              </div>
              <ScrollArea ref={scroll} className="h-64 sm:h-72">
                <pre
                  aria-label="镜像拉取日志"
                  tabIndex={0}
                  className="min-w-0 whitespace-pre-wrap break-all p-3 font-mono text-xs leading-6"
                >
                  {logText}
                </pre>
              </ScrollArea>
            </div>
            {layers.length > 0 && (
              <details className="group rounded-lg border px-3">
                <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-sm">
                  镜像分层进度
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <ScrollArea className="h-40">
                  <div
                    className="space-y-3 pb-3 pr-3"
                    aria-label="镜像分层进度"
                  >
                    {layers.map((layer) => (
                      <div key={layer.id} className="space-y-1.5">
                        <div className="flex flex-wrap justify-between gap-1 text-xs">
                          <span className="font-mono">{layer.id}</span>
                          <span className="text-muted-foreground">
                            {layer.status}
                            {layer.total > 0
                              ? ` · ${imageSize(layer.current)} / ${imageSize(layer.total)}`
                              : ""}
                          </span>
                        </div>
                        {layer.total > 0 && (
                          <Progress
                            value={Math.min(
                              100,
                              (layer.current / layer.total) * 100,
                            )}
                            aria-label={`${layer.id} 拉取进度`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </details>
            )}
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {upload && !upload.error
              ? "上传期间请保留此页面"
              : job && pulling(job.status)
                ? "关闭弹窗后继续处理"
                : ""}
          </span>
          <div className="ml-auto flex gap-2">
            {upload && !upload.error && (
              <Button type="button" variant="ghost" onClick={onCancelUpload}>
                取消上传
              </Button>
            )}
            <Button
              type="button"
              variant={state === "succeeded" ? "default" : "secondary"}
              onClick={onClose}
            >
              {state === "succeeded" ? "完成" : "关闭"}
            </Button>
          </div>
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
  protocol?: "http" | "nc";
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
  children,
}: {
  image: string;
  children: (status: ReactNode, actions: ReactNode) => ReactNode;
  challengeId?: string;
  kind: string;
  savedKind?: string;
  resourceType?: "container" | "attachment";
  profile?: ResourceProfile;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  const [reference, setReference] = useState(image.trim()),
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
  const item = reference === image.trim() ? info.data : undefined;
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
      const profileRoot = resourceType
        ? form.querySelector(`[data-resource-profile="${resourceType}"]`)
        : form;
      const invalid = profileRoot?.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input:invalid, select:invalid, textarea:invalid");
      if (invalid) {
        invalid.reportValidity();
        invalid.focus();
        throw new Error("请先修正资源配置中标出的字段");
      }
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
  const ready = item?.present && item.worker?.online;
  const busy =
    action.isPending ||
    (!!instance &&
      ["queued", "starting", "stopping"].includes(instance.status));
  const endpoint =
    instance?.protocol === "nc"
      ? `/terminal?target=${instance.id}`
      : instance?.endpoint
        ? endpointURL(instance.endpoint)
        : null;
  return (
    <>
      {children(
        item ? <ImageStatus item={item} /> : null,
        <>
          {item &&
            reference &&
            (!item?.present || pulling(item.job_status)) && (
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
              onClick={() => setJobId(item!.job_id!)}
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
          {item && !item.worker?.online && (
            <span className="text-xs text-muted-foreground">
              等待 Docker Worker 连接
            </span>
          )}
        </>,
      )}
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
              copyText(instance.endpoint ?? "")
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
                aria-label={
                  instance.protocol === "nc"
                    ? "在容器终端打开测试靶机"
                    : "打开测试靶机"
                }
              >
                {instance.protocol === "nc" ? <Terminal /> : <ExternalLink />}
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
    </>
  );
}

export function CheckerImageTools({
  image,
  children,
}: {
  image: string;
  children: (status: ReactNode, actions: ReactNode) => ReactNode;
}) {
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
  const item = reference === image.trim() ? query.data : undefined;
  return (
    <>
      {children(
        item ? <ImageStatus item={item} /> : null,
        <>
          {item &&
            reference &&
            (!item?.present || pulling(item.job_status)) && (
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
        </>,
      )}
      {query.error && <ActionError error={query.error} />}
      <PullDialog jobId={jobId} onClose={() => setJobId(null)} />
    </>
  );
}
