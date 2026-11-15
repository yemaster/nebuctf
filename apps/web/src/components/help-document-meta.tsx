import type { HelpDocument } from "@/lib/help";
import { cn } from "@/lib/utils";

export function HelpDocumentMeta({
  document,
  className,
}: {
  document: Pick<
    HelpDocument,
    "author" | "editor" | "created_at" | "updated_at"
  >;
  className?: string;
}) {
  const author = document.author;
  const editor = document.editor?.id !== author?.id ? document.editor : null;
  return (
    <div
      aria-label="文档维护记录"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {author && <span className="break-all">作者 {author.username}</span>}
      <span>
        {editor && <span className="break-all">{editor.username} </span>}
        更新于{" "}
        <time
          dateTime={document.updated_at}
          title={new Date(document.updated_at).toLocaleString("zh-CN")}
        >
          {new Date(document.updated_at).toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })}
        </time>
      </span>
    </div>
  );
}
