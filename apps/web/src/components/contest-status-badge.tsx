import type { Contest } from "@/lib/types";
import { cn, contestStatus } from "@/lib/utils";
import { Badge } from "./ui/badge";

const tones = {
  即将开始: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  进行中:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  已结束: "bg-muted text-muted-foreground",
};

export function ContestStatusBadge({
  contest,
  className,
}: {
  contest: Pick<Contest, "starts_at" | "ends_at">;
  className?: string;
}) {
  const status = contestStatus(contest);
  return (
    <Badge className={cn("border-0", tones[status], className)}>{status}</Badge>
  );
}
