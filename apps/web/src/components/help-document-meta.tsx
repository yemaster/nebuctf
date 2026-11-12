import type { HelpDocument } from "@/lib/help";
import { cn, date } from "@/lib/utils";
import { UserIdentity } from "./user-avatar";

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
  return (
    <dl
      aria-label="文档维护记录"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <dt>创建人</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <UserIdentity
            name={document.author?.username}
            avatarId={document.author?.avatar_id}
          />
          <time dateTime={document.created_at}>
            {date(document.created_at)}
          </time>
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <dt>最后编辑人</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <UserIdentity
            name={document.editor?.username}
            avatarId={document.editor?.avatar_id}
          />
          <time dateTime={document.updated_at}>
            {date(document.updated_at)}
          </time>
        </dd>
      </div>
    </dl>
  );
}
