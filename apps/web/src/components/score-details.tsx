import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CategoryScore, Score, ScoreDetail } from "@/lib/types";
import { date } from "@/lib/utils";
import { bloodLabels } from "@/lib/scoreboard";
import { SolveMark } from "./scoreboard-table";
import { Badge } from "./ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { ScrollArea } from "./ui/scroll-area";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "./ui/table";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Loading, Pagination, QueryState } from "./shared";

const ScoreRadar = lazy(() =>
  import("./score-radar").then((m) => ({ default: m.ScoreRadar })),
);
const PAGE_SIZE = 24;
function strongest(categories: CategoryScore[]) {
  const maximum = Math.max(0, ...categories.map((c) => c.score));
  return maximum > 0
    ? categories
        .filter((c) => c.score === maximum)
        .map((c) => c.category)
        .join(" / ")
    : "暂无得分";
}

export function ScoreDetails({
  row,
  scope,
  group,
  onClose,
}: {
  row: Score | null;
  scope: string;
  group: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={!!row}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="w-full gap-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        {row && (
          <DetailContent
            key={`${scope}:${group}:${row.id}`}
            row={row}
            scope={scope}
            group={group}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
function DetailContent({
  row,
  scope,
  group,
}: {
  row: Score;
  scope: string;
  group: string;
}) {
  const query = new URLSearchParams({ scope });
  if (group) query.set("group", group);
  const [memberId, setMemberId] = useState("");
  const [page, setPage] = useState(1);
  const path = `/scoreboard/${row.id}?${query}`;
  const data = useQuery<ScoreDetail>({
    queryKey: [path],
    queryFn: () => api<ScoreDetail>(path),
    refetchInterval: (query) =>
      query.state.data?.ends_at &&
      Date.parse(query.state.data.ends_at) <= Date.now()
        ? false
        : 15000,
  });
  const detail = data.data;
  const summary = detail ?? row;
  const units = useMemo(
    () => new Map(detail?.columns.map((c) => [c.id, c]) ?? []),
    [detail?.columns],
  );
  const selected = detail?.members.find((m) => m.id === memberId);
  const categories = selected?.categories ?? detail?.categories ?? [];
  const records = useMemo(
    () => detail?.cells.slice().reverse() ?? [],
    [detail?.cells],
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(records.length / PAGE_SIZE)),
  );
  useEffect(() => {
    if (detail && memberId && !selected) setMemberId("");
  }, [detail, memberId, selected]);
  return (
    <>
      <SheetHeader className="gap-3 p-6 pb-4">
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <SheetTitle className="break-words">{summary.name}</SheetTitle>
          {summary.group_name && (
            <Badge variant="secondary">{summary.group_name}</Badge>
          )}
          {detail?.frozen && <Badge variant="secondary">已封榜</Badge>}
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-4 py-2 text-sm">
          {[
            ["全局排名", summary.overall_rank ?? "不参与"],
            ...(summary.group_rank != null
              ? [["组内排名", summary.group_rank]]
              : []),
            ["得分", summary.score.toLocaleString()],
            ["解题 / Flag", `${summary.solves} / ${summary.flags}`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1.5 text-xl font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
        <QueryState
          loading={data.isLoading}
          error={data.error}
          retry={() => void data.refetch()}
        />
        {detail && (
          <div className="space-y-8 pb-6">
            {detail.details_limited && (
              <p className="text-sm text-muted-foreground">
                明细仅包含当前可见赛题，总分仍按全部赛题计算。
              </p>
            )}
            <section aria-label="方向得分">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium">方向得分</h3>
                {scope !== "practice" && detail.members.length > 0 && (
                  <NativeSelect
                    aria-label="查看方向得分"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                  >
                    <NativeSelectOption value="">全队</NativeSelectOption>
                    {detail.members.map((m) => (
                      <NativeSelectOption key={m.id} value={m.id}>
                        {m.name}
                        {m.current_member ? "" : "（已离队）"}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </div>
              <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <Suspense
                  fallback={
                    <div className="flex h-64 items-center justify-center">
                      <Loading />
                    </div>
                  }
                >
                  <ScoreRadar
                    categories={categories}
                    name={selected?.name ?? detail.name}
                    maximum={Math.max(
                      1,
                      ...detail.categories.map((c) => c.score),
                    )}
                  />
                </Suspense>
                <dl
                  aria-label="各方向得分"
                  className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-1"
                >
                  {categories.map((c) => (
                    <div
                      key={c.category}
                      className="flex justify-between gap-3"
                    >
                      <dt className="text-muted-foreground">{c.category}</dt>
                      <dd className="font-medium tabular-nums">
                        {c.score.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
            {scope !== "practice" && (
              <section aria-label="队员贡献" className="space-y-3">
                <h3 className="text-sm font-medium">队员贡献</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>队员</TableHead>
                      <TableHead className="text-right">得分</TableHead>
                      <TableHead className="text-right">Flag</TableHead>
                      <TableHead title="按本场方向得分最高项统计">
                        擅长方向
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="max-w-52 whitespace-normal break-words font-medium">
                          {member.name}
                          {!member.current_member && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              已离队
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {member.score.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {member.flags}
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">
                          {strongest(member.categories)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  擅长方向按本场得分统计
                </p>
              </section>
            )}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">得分记录</h3>
                <span className="text-xs text-muted-foreground">
                  解题与轮次结算明细
                </span>
              </div>
              <ul aria-label="解题记录" className="divide-y">
                {records
                  .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                  .map((cell) => {
                    const unit = units.get(cell.unit_id);
                    return (
                      <li
                        key={`${cell.unit_id}-${cell.round_number ?? "solve"}`}
                        className="flex items-center gap-3 py-4"
                      >
                        <span className="shrink-0">
                          <SolveMark cell={cell} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium">
                            {unit?.title ?? "题目"}
                            {unit?.part_title ? ` / ${unit.part_title}` : ""}
                            {cell.round_number
                              ? ` / 第 ${cell.round_number} 轮`
                              : ""}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              {unit?.category}
                              {cell.blood_rank
                                ? ` / ${bloodLabels[cell.blood_rank - 1]}`
                                : ""}
                            </span>
                            <span className="break-all">
                              {cell.solver_name
                                ? `解答人 ${cell.solver_name}`
                                : "战队轮次结算"}
                            </span>
                            <time
                              dateTime={cell.solved_at}
                              className="tabular-nums"
                            >
                              {date(cell.solved_at)}
                            </time>
                          </div>
                        </div>
                        <span className="min-w-16 shrink-0 text-right text-xl leading-none font-semibold tabular-nums">
                          {cell.score.toLocaleString()}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              {!records.length && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  暂无解题记录
                </p>
              )}
              <Pagination
                page={currentPage}
                setPage={setPage}
                total={records.length}
                pageSize={PAGE_SIZE}
                hasMore={currentPage * PAGE_SIZE < records.length}
              />
            </section>
          </div>
        )}
      </ScrollArea>
    </>
  );
}
