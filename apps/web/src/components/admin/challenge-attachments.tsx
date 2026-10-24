import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, useAction } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { ActionError } from "../action-error";
import { Button } from "../ui/button";
import { FieldSet, FieldLegend, FieldDescription } from "../ui/field";
import { Table, TableBody, TableCell, TableRow } from "../ui/table";
import { imageSize } from "./image-tools";

export function ChallengeAttachments({
  challengeId,
  attachments,
  disabled = false,
}: {
  challengeId?: string;
  attachments: Challenge["attachments"];
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    cache = useQueryClient();
  const [removeId, setRemoveId] = useState<string | null>(null);
  const upload = useAction(
    async (files: File[]) => {
      if (!challengeId) return;
      if (files.length > 20) throw Error("一次最多上传 20 个附件");
      for (const file of files)
        if (file.size > 20 * 1024 * 1024)
          throw Error(`${file.name} 超过 20 MiB`);
      try {
        for (const file of files) {
          const body = new FormData();
          body.append("file", file);
          await api(
            `/admin/challenges/${challengeId}/attachments`,
            "POST",
            body,
          );
        }
      } finally {
        await cache.invalidateQueries({
          queryKey: [`/admin/challenges/${challengeId}`],
        });
      }
    },
    () => toast.success("附件已上传"),
    false,
  );
  const remove = useAction(
    (id: string) => api(`/admin/attachments/${id}`, "DELETE", {}),
    () => {
      setRemoveId(null);
      toast.success("附件已删除");
    },
    false,
  );
  const busy = disabled || upload.isPending || remove.isPending;
  return (
    <FieldSet disabled={busy}>
      <FieldLegend>附件</FieldLegend>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FieldDescription>
          {challengeId ? "单个附件最大 20 MiB" : "保存题目后可上传附件。"}
        </FieldDescription>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="选择题目附件"
          disabled={!challengeId || busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) upload.mutate(files);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!challengeId || busy}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className="motion-safe:animate-spin" />
          ) : (
            <Upload />
          )}
          {upload.isPending ? "上传中" : "上传附件"}
        </Button>
      </div>
      {!!attachments.length && (
        <Table aria-label="题目附件">
          <TableBody>
            {attachments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="max-w-0 break-all whitespace-normal">
                  {a.name}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                  {imageSize(a.size)}
                </TableCell>
                <TableCell className="w-24">
                  <div className="flex items-center justify-end gap-1">
                    {removeId === a.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => remove.mutate(a.id)}
                        >
                          确认删除
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setRemoveId(null);
                            remove.reset();
                          }}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button asChild size="icon-sm" variant="ghost">
                          <a
                            href={`/api/admin/attachments/${a.id}`}
                            aria-label={`下载 ${a.name}`}
                          >
                            <Download />
                          </a>
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`删除 ${a.name}`}
                          disabled={busy}
                          onClick={() => {
                            remove.reset();
                            setRemoveId(a.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {upload.error && <ActionError error={upload.error} />}
      {remove.error && <ActionError error={remove.error} />}
    </FieldSet>
  );
}
