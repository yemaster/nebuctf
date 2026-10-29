import { useRef } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, useAction } from "@/lib/api";
import { Button } from "./ui/button";
export function TeamLogoEditor({
  team,
  hasLogo,
}: {
  team: string;
  hasLogo: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useAction(
    async (file: File | null) => {
      if (!file) return api(`/teams/${team}/logo`, "DELETE");
      if (file.size > 5 * 1024 * 1024) throw Error("Logo 不能超过 5 MiB");
      const body = new FormData();
      body.set("file", file);
      return api(`/teams/${team}/logo`, "POST", body);
    },
    () => toast.success("战队 Logo 已更新"),
  );
  return (
    <div className="flex items-center gap-2">
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="选择战队 Logo"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
      >
        {upload.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />}
        {upload.isPending ? "处理中" : "上传 Logo"}
      </Button>
      {hasLogo && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label="移除战队 Logo"
          disabled={upload.isPending}
          onClick={() => upload.mutate(null)}
        >
          <Trash2 />
        </Button>
      )}
    </div>
  );
}
