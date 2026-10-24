import { Link } from "react-router-dom";
import { CheckCircle2, Circle, CircleDashed } from "lucide-react";
import type { Challenge } from "@/lib/types";
import { Item } from "./ui/item";

const columns =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_4.5rem_4.5rem] md:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5.5rem_4.5rem_4.5rem]";

export function ChallengeCatalog({
  items,
  getHref,
  onSelect,
}: {
  items: Challenge[];
  getHref?: (id: string) => string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div>
      <div
        aria-hidden="true"
        className={`${columns} px-4 py-3 text-sm font-medium text-muted-foreground`}
      >
        <span />
        <span>题目</span>
        <span className="hidden sm:block">分类</span>
        <span className="hidden md:block">难度</span>
        <span className="text-right">分值</span>
        <span className="hidden text-right sm:block">解出</span>
      </div>
      <ul aria-label="题目列表" className="space-y-1">
        {items.map((c) => (
          <li key={c.id}>
            <Item
              asChild
              className={`${columns} border-0 px-4 py-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset`}
            >
              <Link
                to={getHref?.(c.id) ?? `/challenges?challenge=${c.id}`}
                onClick={(event) => {
                  if (
                    !onSelect ||
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onSelect(c.id);
                }}
              >
                {c.solved ? (
                  <CheckCircle2
                    className="size-4 text-success"
                    aria-label="已完成"
                  />
                ) : c.solved_parts > 0 ? (
                  <CircleDashed
                    className="size-4 text-primary"
                    aria-label="部分完成"
                  />
                ) : (
                  <Circle
                    className="size-4 text-muted-foreground"
                    aria-label="未完成"
                  />
                )}
                <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="min-w-0 break-words text-base font-medium">
                    {c.title}
                  </span>
                  {c.total_parts > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {c.solved_parts} / {c.total_parts} 小题
                    </span>
                  )}
                </span>
                <span className="hidden text-muted-foreground sm:block">
                  {c.category}
                </span>
                <span className="hidden text-muted-foreground md:block">
                  {c.difficulty}
                </span>
                <span
                  className="text-right tabular-nums"
                  aria-label={`${c.points} 分`}
                >
                  {c.points}
                </span>
                <span
                  className="hidden text-right tabular-nums text-muted-foreground sm:block"
                  aria-label={`${c.solves} 人解出`}
                >
                  {c.solves}
                </span>
              </Link>
            </Item>
          </li>
        ))}
      </ul>
    </div>
  );
}
