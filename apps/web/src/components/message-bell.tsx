import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useInboxSummary } from "@/lib/notifications";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function MessageBell({ user }: { user: string }) {
  const summary = useInboxSummary(user, true),
    unread = summary.data?.unread ?? 0;
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative my-auto size-9 shrink-0"
    >
      <Link
        to="/messages"
        aria-label={unread ? `消息中心，${unread} 条未读` : "消息中心"}
        title="消息中心"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <Badge
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-4 min-w-4 bg-primary px-1 text-[10px] tabular-nums text-primary-foreground"
          >
            {unread > 99 ? "99+" : unread}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
