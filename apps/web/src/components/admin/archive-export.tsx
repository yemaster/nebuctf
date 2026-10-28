import { useMutation } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";

export function ArchiveExport({
  kind,
  id,
  title,
  icon = false,
}: {
  kind: "challenge" | "contest";
  id: string;
  title: string;
  icon?: boolean;
}) {
  const download = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/admin/${kind === "contest" ? "contests" : "challenges"}/${id}/export`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? "导出失败，请重试");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Button
      type="button"
      variant={icon ? "ghost" : "outline"}
      size={icon ? "icon" : "default"}
      aria-label={`导出 ${title}`}
      title="导出"
      aria-busy={download.isPending}
      disabled={download.isPending}
      onClick={() => download.mutate()}
    >
      {download.isPending ? (
        <LoaderCircle className="motion-safe:animate-spin" />
      ) : (
        <Download />
      )}
      {!icon && (download.isPending ? "正在导出" : "导出")}
    </Button>
  );
}
