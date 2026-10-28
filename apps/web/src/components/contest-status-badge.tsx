import type { Contest } from "@/lib/types";
import { cn, contestStatus } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Clock3, Flag, Radio } from "lucide-react";

const tones = {
  即将开始: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  进行中:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  已结束: "bg-muted text-muted-foreground",
};

export function ContestStatusBadge({
  contest,
  className,
  prominent = false,
  now,
}: {
  contest: Pick<Contest, "starts_at" | "ends_at">;
  className?: string;
  prominent?: boolean;
  now?: number;
}) {
  const status = contestStatus(contest, now);
  const Icon = { 即将开始: Clock3, 进行中: Radio, 已结束: Flag }[status];
  return (
    <Badge
      className={cn(
        "border-0",
        prominent && status === "进行中"
          ? "bg-success text-background"
          : tones[status],
        className,
      )}
    >
      {prominent && <Icon aria-hidden="true" />}
      {status}
    </Badge>
  );
}
