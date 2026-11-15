import { useEffect, useRef, useState } from "react";
import { Download, Upload, FileClock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { PullDialog, imageSize, type ImageUploadProgress } from "./image-tools";

export function ImageImportActions({ disabled }: { disabled: boolean }) {
  const cache = useQueryClient();
  const [mode, setMode] = useState<"pull" | "upload">("pull");
  const [formOpen, setFormOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<ImageUploadProgress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const uploading = !!progress && !progress.error;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    if (mode === "pull") {
      try {
        const job = await api<{ id: string }>("/admin/images/pull", "POST", {
          image: reference.trim(),
        });
        setJobId(job.id);
        setProgress(null);
        setFormOpen(false);
        setShowProgress(true);
        void cache.invalidateQueries({ queryKey: ["/admin/images"] });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPending(false);
      }
      return;
    }
    if (!file) {
      setError("请选择镜像文件");
      setPending(false);
      return;
    }
    if (
      file.size > 2 * 1024 ** 3 ||
      !file.size ||
      !/\.(tar|tar\.gz|tgz)$/i.test(file.name)
    ) {
      setError("请选择不超过 2 GiB 的 .tar 或 .tar.gz 镜像归档");
      setPending(false);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    let uploadId: string | undefined;
    setJobId(null);
    setProgress({ filename: file.name, received: 0, total: file.size });
    setFormOpen(false);
    setShowProgress(true);
    try {
      const upload = await api<{ id: string; chunk_size: number }>(
        "/admin/images/uploads",
        "POST",
        { filename: file.name, size: file.size },
        abort.signal,
      );
      uploadId = upload.id;
      for (let offset = 0; offset < file.size; offset += upload.chunk_size) {
        const body = new FormData();
        body.append(
          "file",
          file.slice(offset, offset + upload.chunk_size),
          "chunk",
        );
        const result = await api<{ received: number }>(
          `/admin/images/uploads/${upload.id}?offset=${offset}`,
          "PUT",
          body,
          abort.signal,
        );
        setProgress({
          filename: file.name,
          received: result.received,
          total: file.size,
        });
      }
      const job = await api<{ id: string }>(
        `/admin/images/uploads/${upload.id}/complete`,
        "POST",
        {},
        abort.signal,
      );
      uploadId = undefined;
      setJobId(job.id);
      setProgress(null);
      void cache.invalidateQueries();
    } catch (e) {
      setProgress(
        (value) =>
          value && {
            ...value,
            error: abort.signal.aborted ? "上传已取消" : (e as Error).message,
          },
      );
    } finally {
      if (uploadId)
        void api(`/admin/images/uploads/${uploadId}`, "DELETE").catch(() => {});
      controller.current = null;
      setPending(false);
    }
  }
  const open = (next: "pull" | "upload") => {
    setMode(next);
    setFormOpen(true);
    setError("");
    setFile(null);
  };
  return (
    <>
      {(jobId || progress) && (
        <Button variant="ghost" size="sm" onClick={() => setShowProgress(true)}>
          <FileClock />
          任务进度
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || uploading || pending}
        onClick={() => open("upload")}
      >
        <Upload />
        上传镜像
      </Button>
      <Button
        size="sm"
        disabled={disabled || uploading || pending}
        onClick={() => open("pull")}
      >
        <Download />
        拉取镜像
      </Button>
      <Dialog
        open={formOpen}
        onOpenChange={(value) => !value && !pending && setFormOpen(false)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {mode === "pull" ? "拉取镜像" : "上传镜像"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {mode === "pull"
                ? "指定镜像地址并加入拉取队列"
                : "选择镜像归档并导入 Docker"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {mode === "pull" ? (
              <div className="space-y-2">
                <Label htmlFor="image-reference">镜像地址</Label>
                <Input
                  id="image-reference"
                  autoFocus
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="nebuctf/challenge:latest"
                  maxLength={200}
                  required
                  disabled={pending}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="image-archive">镜像文件</Label>
                <Input
                  id="image-archive"
                  type="file"
                  accept=".tar,.tar.gz,.tgz"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  docker save 导出的 .tar / .tar.gz，最大 2 GiB
                  {file ? ` · ${imageSize(file.size)}` : ""}
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setFormOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={pending || (mode === "upload" && !file)}
              >
                {pending
                  ? "提交中"
                  : mode === "pull"
                    ? "开始拉取"
                    : "上传并导入"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <PullDialog
        jobId={showProgress ? jobId : null}
        upload={showProgress ? progress : null}
        onCancelUpload={() => controller.current?.abort()}
        onClose={() => {
          setShowProgress(false);
          void cache.invalidateQueries();
        }}
      />
    </>
  );
}
