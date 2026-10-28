import type { Announcement } from "@/lib/types";
import { date } from "@/lib/utils";
import { UserIdentity } from "./user-avatar";

export function AnnouncementMeta({ notice }: { notice: Announcement }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <UserIdentity
        name={notice.author?.username}
        avatarId={notice.author?.avatar_id}
      />
      <time dateTime={notice.created_at}>{date(notice.created_at)}</time>
    </span>
  );
}
