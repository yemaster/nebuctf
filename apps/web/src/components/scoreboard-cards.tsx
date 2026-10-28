import { memo } from "react";
import type { Score } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { UserAvatar } from "./user-avatar";

export const ScoreboardCards = memo(function ScoreboardCards({
  rows,
  selfId,
  onSelect,
}: {
  rows: Score[];
  selfId?: string;
  onSelect: (row: Score) => void;
}) {
  return (
    <ul
      aria-label="个人排行榜"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {rows.map((row) => (
        <li key={row.id} className="min-w-0">
          <Card
            className={cn(
              "h-full gap-0 border-0 p-0 shadow-sm transition-shadow hover:shadow-md",
              row.id === selfId && "ring-1 ring-primary/35",
            )}
          >
            <button
              type="button"
              className="flex h-full w-full flex-col gap-6 rounded-xl p-6 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(row)}
              aria-label={`查看 ${row.name} 的排名详情`}
            >
              <span className="flex w-full min-w-0 items-center gap-4">
                <UserAvatar
                  name={row.name}
                  avatarId={row.avatar_id}
                  className="size-16 shrink-0 text-xl font-medium"
                />
                <span
                  className="min-w-0 truncate text-lg font-semibold"
                  title={row.name}
                >
                  {row.name}
                </span>
              </span>
              <span className="mt-auto flex w-full items-end justify-between gap-3">
                <span className="flex flex-wrap gap-2">
                  <Badge className="bg-primary/10 text-primary">
                    总分 {row.score.toLocaleString("zh-CN")}
                  </Badge>
                  <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
                    Flag {row.flags.toLocaleString("zh-CN")}
                  </Badge>
                </span>
                <span
                  className="shrink-0 text-4xl leading-none font-semibold tabular-nums text-muted-foreground/40"
                  aria-label={`第 ${row.rank} 名`}
                >
                  #{row.rank}
                </span>
              </span>
            </button>
          </Card>
        </li>
      ))}
    </ul>
  );
});
