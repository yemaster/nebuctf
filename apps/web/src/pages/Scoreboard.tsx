import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  RefreshCw,
  Search,
  Check,
  X,
} from "lucide-react";
import { useUser } from "@/App";
import { api, useAPI } from "@/lib/api";
import type { Contest, Score, ScoreboardData } from "@/lib/types";
import { bloodLabels } from "@/lib/scoreboard";
import { BloodMark } from "@/components/blood-mark";
import { ScopeSelect } from "./Instances";
import { ScoreboardCards } from "@/components/scoreboard-cards";
import { ScoreboardTable } from "@/components/scoreboard-table";
import { ScoreDetails } from "@/components/score-details";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  Empty,
  Loading,
  PageTitle,
  Pagination,
  QueryState,
} from "@/components/shared";
const ScoreTimeline = lazy(() =>
  import("@/components/score-timeline").then((m) => ({
    default: m.ScoreTimeline,
  })),
);
const COLUMN_PAGE_SIZE = 36;
export function Scoreboard({
  scope,
  embedded = false,
}: {
  scope?: string;
  embedded?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const activeScope = scope ?? params.get("scope") ?? "practice";
  return (
    <Board
      key={activeScope}
      scope={activeScope}
      embedded={embedded}
      standalone={!scope}
      params={params}
      setParams={setParams}
    />
  );
}
function Board({
  scope,
  embedded,
  standalone,
  params,
  setParams,
}: {
  scope: string;
  embedded: boolean;
  standalone: boolean;
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
}) {
  const competition = scope !== "practice",
    user = useUser();
  const group = params.get("group") ?? "",
    q = params.get("q") ?? "",
    participant = params.get("participant") ?? "";
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const [search, setSearch] = useState(q),
    [details, setDetails] = useState<Score | null>(null),
    [chartOpen, setChartOpen] = useState(true);
  const [category, setCategory] = useState(""),
    [columnPage, setColumnPage] = useState(1);
  useEffect(() => setSearch(q), [q]);
  const contest = useAPI<Contest>(`/contests/${scope}`, competition);
  const query = new URLSearchParams({
    scope,
    page: String(page),
    page_size: competition ? "30" : "12",
  });
  if (group) query.set("group", group);
  if (q) query.set("q", q);
  if (participant) query.set("participant", participant);
  const path = `/scoreboard?${query}`;
  const data = useQuery<ScoreboardData>({
    queryKey: [path],
    queryFn: () => api<ScoreboardData>(path),
    placeholderData: keepPreviousData,
    refetchInterval:
      !competition ||
      !contest.data ||
      Date.parse(contest.data.ends_at) > Date.now()
        ? 15000
        : false,
  });
  const board = data.data;
  const selfId = competition ? contest.data?.registration?.team_id : user?.id;
  function update(values: Record<string, string | null>) {
    setDetails(null);
    if ("q" in values) setSearch(values.q ?? "");
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  }
  useEffect(() => {
    if (
      board &&
      !data.isPlaceholderData &&
      !data.isFetching &&
      page > 1 &&
      (page - 1) * board.page_size >= board.total
    )
      update({
        page: String(Math.max(1, Math.ceil(board.total / board.page_size))),
      });
  }, [board, data.isFetching, data.isPlaceholderData, page]);
  const categories = useMemo(
    () => [...new Set(board?.columns.map((col) => col.category) ?? [])],
    [board?.columns],
  );
  const filteredColumns = useMemo(
    () =>
      board?.columns.filter((col) => !category || col.category === category) ??
      [],
    [board?.columns, category],
  );
  const columnPages = Math.max(
    1,
    Math.ceil(filteredColumns.length / COLUMN_PAGE_SIZE),
  );
  const actualColumnPage = Math.min(columnPage, columnPages);
  const columns = filteredColumns.slice(
    (actualColumnPage - 1) * COLUMN_PAGE_SIZE,
    actualColumnPage * COLUMN_PAGE_SIZE,
  );
  const liveDetails = details
    ? (board?.items.find((row) => row.id === details.id) ?? details)
    : null;
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      {!embedded && (
        <PageTitle
          action={
            standalone ? (
              <ScopeSelect
                value={scope}
                onChange={(value) =>
                  update({
                    scope: value === "practice" ? null : value,
                    group: null,
                    page: null,
                    q: null,
                    participant: null,
                  })
                }
              />
            ) : undefined
          }
        >
          排行榜
        </PageTitle>
      )}
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {board && (
        <div className="space-y-5">
          <Card
            aria-busy={data.isFetching || undefined}
            className="gap-0 overflow-hidden border-0 py-0 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-3 p-4">
              {competition && (contest.data?.groups.length ?? 0) > 0 && (
                <NativeSelect
                  aria-label="排行榜组别"
                  value={group}
                  onChange={(e) =>
                    update({
                      group: e.target.value || null,
                      page: null,
                      participant: null,
                    })
                  }
                >
                  <NativeSelectOption value="">全局排名</NativeSelectOption>
                  {contest.data?.groups.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name} / 组内排名
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <form
                className="w-full sm:w-64"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({
                    q: search.trim() || null,
                    page: null,
                    participant: null,
                  });
                }}
              >
                <InputGroup>
                  <InputGroupInput
                    aria-label={competition ? "搜索战队" : "搜索选手"}
                    placeholder={competition ? "搜索战队" : "搜索选手"}
                    value={search}
                    maxLength={100}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="submit"
                      size="icon-xs"
                      aria-label="搜索"
                    >
                      <Search />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </form>
              {selfId && (
                <Button
                  variant={participant ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() =>
                    update({
                      participant: participant ? null : selfId,
                      group: participant
                        ? group || null
                        : contest.data?.groups.find(
                              (g) =>
                                g.id === contest.data?.registration?.group_id,
                            )?.rank_overall === false
                          ? (contest.data?.registration?.group_id ?? null)
                          : null,
                      q: null,
                      page: null,
                    })
                  }
                >
                  我的排名
                </Button>
              )}
              {(q || participant) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({ q: null, participant: null, page: null })
                  }
                >
                  <X />
                  清除筛选
                </Button>
              )}
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                {board.frozen && (
                  <Badge
                    variant="secondary"
                    className="gap-1.5 text-warning"
                    title="封榜期间隐藏后续解题，比赛结束后恢复"
                  >
                    <Lock className="size-3" />
                    已封榜
                  </Badge>
                )}
                {!board.started && <Badge variant="secondary">尚未开始</Badge>}
                <span className="tabular-nums">
                  {board.participants} {competition ? "支战队" : "位选手"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="刷新排行榜"
                  disabled={data.isFetching}
                  onClick={() => void data.refetch()}
                >
                  <RefreshCw
                    className={
                      data.isFetching ? "motion-safe:animate-spin" : ""
                    }
                  />
                </Button>
              </div>
            </div>
            {competition && board.started && board.timeline.length > 0 && (
              <Collapsible
                open={chartOpen}
                onOpenChange={setChartOpen}
                className="px-4 pb-3 sm:px-6"
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="group h-9 w-full justify-between px-0 hover:bg-transparent"
                  >
                    <span className="text-sm font-medium">
                      积分走势
                      <span className="ml-3 text-xs font-normal text-muted-foreground">
                        前五名
                      </span>
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Suspense
                    fallback={
                      <div className="flex h-72 items-center justify-center">
                        <Loading variant="chart" />
                      </div>
                    }
                  >
                    <ScoreTimeline key={`${scope}:${group}`} board={board} />
                  </Suspense>
                  <p className="pt-3 text-right text-xs text-muted-foreground">
                    按当前题目分值累计
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
            {competition && board.columns.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div
                  className="flex flex-wrap gap-4 text-xs text-muted-foreground"
                  aria-label="解题标记说明"
                >
                  {bloodLabels.map((label, index) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <BloodMark rank={index + 1} className="size-4" />
                      {label}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5">
                    <Check className="size-4 text-success" />
                    已解答
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {categories.length > 1 && (
                    <NativeSelect
                      aria-label="赛题分类"
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setColumnPage(1);
                      }}
                    >
                      <NativeSelectOption value="">全部分类</NativeSelectOption>
                      {categories.map((item) => (
                        <NativeSelectOption key={item} value={item}>
                          {item}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                  {columnPages > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="上一组赛题"
                        disabled={actualColumnPage === 1}
                        onClick={() => setColumnPage(actualColumnPage - 1)}
                      >
                        <ChevronLeft />
                      </Button>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {(actualColumnPage - 1) * COLUMN_PAGE_SIZE + 1}–
                        {Math.min(
                          actualColumnPage * COLUMN_PAGE_SIZE,
                          filteredColumns.length,
                        )}{" "}
                        / {filteredColumns.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="下一组赛题"
                        disabled={actualColumnPage === columnPages}
                        onClick={() => setColumnPage(actualColumnPage + 1)}
                      >
                        <ChevronRight />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
            {competition &&
              (board.items.length > 0 ? (
                <ScoreboardTable
                  rows={board.items}
                  columns={columns}
                  competition={competition}
                  grouped={!!group}
                  selfId={selfId}
                  onSelect={setDetails}
                />
              ) : (
                <div className="py-12">
                  <Empty>
                    {q || participant ? "没有符合条件的排名" : "暂无排名"}
                  </Empty>
                </div>
              ))}
          </Card>
          {!competition &&
            (board.items.length > 0 ? (
              <ScoreboardCards
                rows={board.items}
                selfId={selfId}
                onSelect={setDetails}
              />
            ) : (
              <Card className="border-0 py-12">
                <Empty>
                  {q || participant ? "没有符合条件的排名" : "暂无排名"}
                </Empty>
              </Card>
            ))}
          <Pagination
            page={page}
            setPage={(value) => update({ page: String(value) })}
            pageSize={board.page_size}
            total={board.total}
            hasMore={page * board.page_size < board.total}
            disabled={data.isFetching}
            alwaysShow={!competition}
          />
          <ScoreDetails
            row={liveDetails}
            scope={scope}
            group={group}
            onClose={() => setDetails(null)}
          />
        </div>
      )}
    </>
  );
}
