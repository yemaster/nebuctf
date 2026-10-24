import { useRef, useState } from "react";
import { Upload, RotateCw, Check } from "lucide-react";
import { api, useAPI, useAction } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { OperationProgress } from "./operation-progress";
import { ResourceError } from "./resource-error";
import { QueryState } from "./shared";
type Job = {
  id: string;
  status: string;
  patch_name: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
const names: Record<string, string> = {
  queued: "等待校验",
  building: "构建补丁",
  checking: "正在校验",
  passed: "校验通过",
  failed: "校验未通过",
  cancelled: "已取消",
};
export function PatchPanel({ id, scope }: { id: string; scope: string }) {
  const query = useAPI<{ items: Job[] }>(
      `/challenges/${id}/patches?scope=${scope}`,
      true,
      3000,
    ),
    input = useRef<HTMLInputElement>(null),
    [file, setFile] = useState<File | null>(null);
  const job = query.data?.items[0],
    busy = !!job && ["queued", "building", "checking"].includes(job.status);
  const upload = useAction(
    async () => {
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      await api(`/challenges/${id}/patches?scope=${scope}`, "POST", form);
      setFile(null);
      if (input.current) input.current.value = "";
    },
    undefined,
    false,
  );
  return (
    <section
      aria-label="防守补丁"
      className="space-y-4 rounded-xl bg-muted/40 p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">防守补丁</h2>
        {job && (
          <Badge
            variant="secondary"
            className={job.status === "passed" ? "text-success" : ""}
          >
            {job.status === "passed" && <Check className="mr-1 size-3" />}
            {names[job.status]}
          </Badge>
        )}
      </div>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <div className="flex flex-wrap gap-3">
        <Input
          ref={input}
          type="file"
          accept=".tar,.tar.gz,.tgz"
          aria-label="选择补丁包"
          className="min-w-0 flex-1"
          disabled={busy || upload.isPending}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="secondary"
          disabled={!file || busy || upload.isPending}
          onClick={() => upload.mutate()}
        >
          {job?.status === "failed" ? <RotateCw /> : <Upload />}提交补丁
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        tar 或 tar.gz，最多 20 MiB{job ? "，最近提交：" + job.patch_name : ""}
      </div>
      {scope !== "practice" && (
        <p className="text-xs text-muted-foreground">
          补丁须在实操作答时间内完成校验。
        </p>
      )}
      <OperationProgress
        busy={busy || upload.isPending}
        failed={upload.isError || job?.status === "failed"}
        label={job && busy ? names[job.status]! : "正在上传补丁"}
        completeLabel="校验完成"
      />
      {(upload.error || job?.error) && !busy && (
        <ResourceError error={upload.error ?? job!.error!} />
      )}
    </section>
  );
}
