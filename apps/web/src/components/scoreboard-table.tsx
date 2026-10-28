import { memo, useMemo, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";
import type { Score, ScoreCell, ScoreColumn } from "@/lib/types";
import {
  bloodLabels,
  categoryHeaderColors,
  categoryTextColors,
} from "@/lib/scoreboard";
import { date } from "@/lib/utils";
import { activateFromRow } from "@/lib/row-action";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { BloodMark } from "./blood-mark";
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
    <BloodMark rank={cell.blood_rank} />
  ) : (
    <Check className="size-6 text-success" />
  );
}
const solveTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function SolveDetails({
  row,
  column,
  cell,
  onSelect,
}: {
  row: Score;
  column: ScoreColumn;
  cell: ScoreCell;
  onSelect: (row: Score) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointer = useRef({ touch: false, open: false });
  const name = `${column.title}${column.part_title ? ` / ${column.part_title}` : ""}`;
  const blood = cell.blood_rank ? bloodLabels[cell.blood_rank - 1] : null;
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full hover:bg-transparent dark:hover:bg-transparent"
          onPointerDown={(event) => {
            // Radix closes an open tooltip on pointerdown, before click runs.
            pointer.current = { touch: event.pointerType === "touch", open };
          }}
          onKeyDown={() => {
            pointer.current.touch = false;
          }}
          onClick={(event) => {
            if (pointer.current.touch) {
              event.preventDefault();
              setOpen(!pointer.current.open);
            } else {
              onSelect(row);
            }
          }}
          aria-label={`${row.name}，${name}，${blood ?? "已解答"}，${cell.score} 分`}
        >
          <SolveMark cell={cell} />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        variant="surface"
        side="top"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-44 max-w-[min(20rem,calc(100vw-1.5rem))] space-y-1.5 px-3 py-2.5 text-left text-pretty"
      >
        <p className="break-words font-medium leading-5">
          {column.title}
          {column.part_title && (
            <span className="block font-normal text-muted-foreground">
              {column.part_title}
            </span>
          )}
        </p>
        <div className="flex items-baseline justify-between gap-4">
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${categoryTextColors[column.category] ?? "text-foreground"}`}
          >
            {cell.score > 0 ? "+" : ""}
            {cell.score.toLocaleString()}
            <span className="ml-1 font-sans text-xs font-normal">分</span>
          </span>
          {blood && <span className="text-muted-foreground">{blood}</span>}
        </div>
        <time
          dateTime={cell.solved_at}
          className="block font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {solveTime.format(new Date(cell.solved_at))}
        </time>
      </TooltipContent>
    </Tooltip>
  );
}
const identity =
  "sticky left-0 z-10 w-44 min-w-44 max-w-44 px-3 sm:w-72 sm:min-w-72 sm:max-w-72";
const scoreColumn =
  "w-24 min-w-24 px-3 text-right tabular-nums sm:sticky sm:left-72 sm:z-10";
export const ScoreboardTable = memo(function ScoreboardTable({
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
  const questions = useMemo(
    () =>
      columns.reduce<ScoreColumn[][]>((list, column) => {
        const last = list.at(-1);
        if (
          last?.[0]?.challenge_id === column.challenge_id &&
          last[0].category === column.category
        )
          last.push(column);
        else list.push([column]);
        return list;
      }, []),
    [columns],
  );
  const hasParts = matrix && columns.some((column) => !!column.part_title);
  const headerRows = matrix ? (hasParts ? 4 : 3) : 1;
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
                rowSpan={headerRows}
                className={`${identity} border-b bg-card text-muted-foreground`}
              >
                {grouped ? "组内 / 全局" : "全局排名"} /{" "}
                {competition ? "战队" : "选手"}
              </TableHead>
              <TableHead
                rowSpan={headerRows}
                className={`${scoreColumn} border-b bg-card`}
              >
                总分
              </TableHead>
              <TableHead
                rowSpan={headerRows}
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
                    className={`h-9 text-center text-xs ${categoryHeaderColors[group.category] ?? "bg-muted text-muted-foreground"}`}
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
                {questions.map((question) => {
                  const first = question[0]!;
                  const multipart = !!first.part_title;
                  return (
                    <TableHead
                      key={first.id}
                      scope={multipart ? "colgroup" : "col"}
                      colSpan={question.length}
                      rowSpan={!multipart && hasParts ? 2 : 1}
                      className={`min-w-28 px-3 pb-1 pt-2 text-center ${multipart ? "h-8" : "h-9 w-28"}`}
                      title={first.title}
                    >
                      {/* Fill the merged cell without enlarging the table's intrinsic width. */}
                      <div className="w-0 min-w-full truncate text-xs font-medium">
                        {first.title}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            )}
            {hasParts && (
              <TableRow className="hover:bg-transparent">
                {columns
                  .filter((column) => !!column.part_title)
                  .map((column) => (
                    <TableHead
                      key={column.id}
                      scope="col"
                      className="h-7 w-28 min-w-28 px-3 pb-1 pt-0 text-center"
                      title={`${column.title} / ${column.part_title}`}
                    >
                      <div className="w-0 min-w-full truncate text-xs text-muted-foreground">
                        {column.part_title}
                      </div>
                    </TableHead>
                  ))}
              </TableRow>
            )}
            {matrix && (
              <TableRow className="hover:bg-transparent" aria-label="赛题分值">
                {columns.map((column) => (
                  <TableHead
                    key={column.id}
                    className="h-8 border-b px-3 py-1.5 text-center font-mono text-xs font-semibold tabular-nums"
                    aria-label={`${column.title}${column.part_title ? ` / ${column.part_title}` : ""}，当前分值 ${column.points} 分`}
                  >
                    {column.points.toLocaleString()}
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
                      <span className="w-9 shrink-0 text-center tabular-nums text-muted-foreground">
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
                            <SolveDetails
                              row={row}
                              column={column}
                              cell={cell}
                              onSelect={onSelect}
                            />
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
});
