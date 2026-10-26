import { useMemo } from "react";
import { Check, Medal, Minus } from "lucide-react";
import type { Score, ScoreCell, ScoreColumn } from "@/lib/types";
import { bloodColors, bloodLabels } from "@/lib/scoreboard";
import { date } from "@/lib/utils";
import { activateFromRow } from "@/lib/row-action";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "./ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export function SolveMark({ cell }: { cell?: ScoreCell }) {
  if (!cell)
    return <Minus className="mx-auto size-6 text-muted-foreground/40" />;
  return cell.blood_rank ? (
    <Medal className={`size-6 ${bloodColors[cell.blood_rank - 1]}`} />
  ) : (
    <Check className="size-6 text-success" />
  );
}
const identity =
  "sticky left-0 z-10 w-44 min-w-44 max-w-44 px-3 sm:w-72 sm:min-w-72 sm:max-w-72";
const scoreColumn =
  "w-24 min-w-24 px-3 text-right tabular-nums sm:sticky sm:left-72 sm:z-10";
export function ScoreboardTable({
  rows,
  columns,
  competition,
  grouped,
  selfId,
  onSelect,
}: {
  rows: Score[];
  columns: ScoreColumn[];
  competition: boolean;
  grouped: boolean;
  selfId?: string;
  onSelect: (row: Score) => void;
}) {
  const groups = useMemo(
    () =>
      columns.reduce<{ category: string; count: number }[]>((list, col) => {
        const last = list.at(-1);
        if (last?.category === col.category) last.count++;
        else list.push({ category: col.category, count: 1 });
        return list;
      }, []),
    [columns],
  );
  const matrix = competition && columns.length > 0;
  return (
    <TooltipProvider delayDuration={150}>
      <div className="[&_[data-slot=table-container]]:max-h-[65dvh] [&_[data-slot=table-container]]:overflow-auto">
        <Table
          className="w-max min-w-full table-auto border-separate border-spacing-0"
          aria-label={competition ? "战队排行榜" : "练习排行榜"}
        >
          <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead
                rowSpan={matrix ? 2 : 1}
                className={`${identity} border-b bg-card text-muted-foreground`}
              >
                {grouped ? "组内 / 全局" : "全局排名"} /{" "}
                {competition ? "战队" : "选手"}
              </TableHead>
              <TableHead
                rowSpan={matrix ? 2 : 1}
                className={`${scoreColumn} border-b bg-card`}
              >
                总分
              </TableHead>
              <TableHead
                rowSpan={matrix ? 2 : 1}
                className="w-24 min-w-24 border-b px-3 text-center"
              >
                解题 / Flag
              </TableHead>
              {matrix ? (
                groups.map((group) => (
                  <TableHead
                    scope="colgroup"
                    key={group.category}
                    colSpan={group.count}
                    className="h-9 bg-muted/60 text-center text-xs text-muted-foreground"
                  >
                    {group.category}
                  </TableHead>
                ))
              ) : (
                <TableHead className="min-w-44 border-b px-4">
                  最后解题
                </TableHead>
              )}
            </TableRow>
            {matrix && (
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead
                    key={column.id}
                    scope="col"
                    className="w-28 min-w-28 border-b p-3 text-center"
                    title={`${column.title}${column.part_title ? ` / ${column.part_title}` : ""}`}
                  >
                    {/* Fill the allocated column without enlarging the table's intrinsic width. */}
                    <div className="w-0 min-w-full truncate text-xs font-medium">
                      {column.title}
                    </div>
                    {column.part_title && (
                      <div className="mt-1 w-0 min-w-full truncate text-xs text-muted-foreground">
                        {column.part_title}
                      </div>
                    )}
                    <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                      {column.points} 分
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const cells = new Map(
                row.cells.map((cell) => [cell.unit_id, cell]),
              );
              const mine = row.id === selfId;
              return (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer [&>td]:bg-inherit ${mine ? "bg-accent hover:bg-accent" : "bg-card hover:bg-card"}`}
                  data-self={mine || undefined}
                  onClick={(event) =>
                    activateFromRow(event, () => onSelect(row))
                  }
                >
                  <TableCell className={`${identity} border-b py-1`}>
                    <Button
                      variant="ghost"
                      className="h-auto min-h-14 w-full justify-start gap-3 px-1 text-left hover:bg-transparent dark:hover:bg-transparent"
                      onClick={() => onSelect(row)}
                      aria-label={`查看${row.name}的解题详情`}
                    >
                      <span
                        className={`w-9 shrink-0 text-center tabular-nums ${row.rank <= 3 ? bloodColors[row.rank - 1] : "text-muted-foreground"}`}
                      >
                        {row.rank}
                        {grouped && row.overall_rank != null && (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            / {row.overall_rank}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={row.name}>
                          {row.name}
                        </span>
                        {row.group_name && (
                          <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                            {row.group_name}
                          </span>
                        )}
                      </span>
                      {mine && (
                        <Badge variant="secondary" className="shrink-0">
                          我
                        </Badge>
                      )}
                    </Button>
                  </TableCell>
                  <TableCell
                    className={`${scoreColumn} border-b font-semibold`}
                  >
                    {row.score.toLocaleString()}
                  </TableCell>
                  <TableCell className="border-b px-3 text-center tabular-nums text-muted-foreground">
                    {row.solves} / {row.flags}
                  </TableCell>
                  {matrix ? (
                    columns.map((column) => {
                      const cell = cells.get(column.id);
                      const name = `${column.title}${column.part_title ? ` / ${column.part_title}` : ""}`;
                      return (
                        <TableCell
                          key={column.id}
                          className="border-b p-1 text-center"
                        >
                          {cell ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full hover:bg-transparent dark:hover:bg-transparent"
                                  onClick={() => onSelect(row)}
                                  aria-label={`${row.name}，${name}，${cell.blood_rank ? bloodLabels[cell.blood_rank - 1] : "已解答"}，${cell.score} 分`}
                                >
                                  <SolveMark cell={cell} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="space-y-1">
                                <p>{name}</p>
                                <p>
                                  {cell.score} 分
                                  {cell.blood_rank
                                    ? ` / ${bloodLabels[cell.blood_rank - 1]}`
                                    : ""}
                                </p>
                                <time dateTime={cell.solved_at}>
                                  {date(cell.solved_at)}
                                </time>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span aria-label={`${row.name}，${name}，未解答`}>
                              <SolveMark />
                            </span>
                          )}
                        </TableCell>
                      );
                    })
                  ) : (
                    <TableCell className="border-b px-4 text-xs text-muted-foreground">
                      {date(row.last_solve)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
