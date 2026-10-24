import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, useAction } from "@/lib/api";
import type { Contest } from "@/lib/types";
import { ContestPoster } from "../contest-poster";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { ResourceError } from "../resource-error";
export function ContestPosterEditor({
  contest,
  disabled,
}: {
  contest: Contest | null;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    [confirm, setConfirm] = useState(false);
  const upload = useAction(
    async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw Error("海报不能超过 5 MiB");
      if (!/\.(png|jpe?g|webp)$/i.test(file.name))
        throw Error("仅支持 PNG、JPEG 和 WebP 图片");
      const data = new FormData();
      data.set("file", file);
      return api(`/admin/contests/${contest!.id}/poster`, "POST", data);
    },
    () => toast.success("海报已更新"),
    false,
  );
  const remove = useAction(
    () => api(`/admin/contests/${contest!.id}/poster`, "DELETE"),
    () => {
      setConfirm(false);
      toast.success("海报已移除");
    },
    false,
  );
  const busy = disabled || upload.isPending || remove.isPending;
  return (
    <section aria-label="比赛海报" className="space-y-3">
      <h2 className="text-sm font-medium">比赛海报</h2>
      <div className="overflow-hidden rounded-lg bg-muted ring-1 ring-border/60">
        {contest ? (
          <ContestPoster contest={contest} className="aspect-video" />
        ) : (
          <img
            src="/images/contest-lab.jpg"
            alt="默认比赛海报"
            className="aspect-video w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="选择比赛海报"
          disabled={busy || !contest}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) {
              remove.reset();
              upload.mutate(file);
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !contest}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className="motion-safe:animate-spin" />
          ) : (
            <ImagePlus />
          )}
          {contest?.poster_id ? "更换海报" : "上传海报"}
        </Button>
        {contest?.poster_id && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="移除海报"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {contest ? "PNG、JPEG、WebP，最大 5 MiB" : "保存比赛后可上传海报"}
      </p>
      {upload.error && <ResourceError error={upload.error} />}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirm(open);
        }}
      >
        <DialogContent>
          <DialogTitle>移除比赛海报？</DialogTitle>
          <p className="text-sm text-muted-foreground">移除后使用默认海报。</p>
          {remove.error && <ResourceError error={remove.error} />}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setConfirm(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              移除海报
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
