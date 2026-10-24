import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import {
  questionTypes,
  questionSetting,
  type ContestQuestion,
} from "@/lib/competition";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Item, ItemGroup } from "../ui/item";
import { Field, Pagination, QueryState, Empty } from "../shared";
import { ContestQuestionPicker } from "./contest-question-picker";
import { inputDate } from "./shared";
import { ScoringEditor, scoringNames, scoreSummary } from "./contest-scoring";

export type QuestionIssue = { id: string; message: string };
const pageSize = 10;

export function ContestQuestions({
  ids,
  onIdsChange,
  value,
  onChange,
  locked,
  issue,
}: {
  ids: string[];
  onIdsChange: (ids: string[]) => void;
  value: ContestQuestion[];
  onChange: (v: ContestQuestion[]) => void;
  locked: boolean;
  issue: QuestionIssue | null;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [adding, setAdding] = useState(true),
    [expanded, setExpanded] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ["contest-question-settings", ids.join(","), page, q],
    queryFn: () =>
      api<{ items: Challenge[]; total: number }>(
        "/admin/challenges/search",
        "POST",
        {
          ids: ids.join(","),
          page,
          page_size: pageSize,
          q,
        },
      ),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const items = ids.length
    ? (query.data?.items ?? [])
        .filter((c) => ids.includes(c.id))
        .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    : [];
  const total = ids.length ? query.data?.total : 0;
  useEffect(() => {
    if (total !== undefined && !query.isPlaceholderData)
      setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, query.isPlaceholderData]);
  useEffect(() => {
    const missing = items.filter(
      (c) => !value.some((v) => v.challenge_id === c.id),
    );
    if (missing.length) onChange([...value, ...missing.map(questionSetting)]);
  }, [items, value, onChange]);
  useEffect(() => {
    if (!issue) return;
    setSearch("");
    setQ("");
    setPage(Math.floor(Math.max(0, ids.indexOf(issue.id)) / pageSize) + 1);
    setExpanded((open) =>
      open.includes(issue.id) ? open : [...open, issue.id],
    );
  }, [issue, ids]);
  const update = (next: ContestQuestion) =>
    onChange(
      value.some((v) => v.challenge_id === next.challenge_id)
        ? value.map((v) => (v.challenge_id === next.challenge_id ? next : v))
        : [...value, next],
    );
  const move = (id: string, direction: -1 | 1) => {
    const from = ids.indexOf(id),
      to = from + direction;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onIdsChange(next);
    setPage(Math.floor(to / pageSize) + 1);
  };
  const find = () => {
    setQ(search.trim());
    setPage(1);
  };
  return (
    <section aria-label="比赛赛题" className="min-w-0 space-y-5">
      <Collapsible open={adding} onOpenChange={setAdding} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">
            赛题{" "}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {ids.length} / 200
            </span>
          </h3>
          <CollapsibleTrigger asChild>
            <Button type="button" variant={adding ? "secondary" : "default"}>
              {adding ? <ChevronDown className="rotate-180" /> : <Plus />}
              {adding ? "收起选题" : "调整选题"}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <ContestQuestionPicker
            value={ids}
            onChange={onIdsChange}
            onPick={(c) => {
              if (!value.some((v) => v.challenge_id === c.id))
                onChange([...value, questionSetting(c)]);
            }}
            disabled={locked}
          />
        </CollapsibleContent>
      </Collapsible>
      {locked && (
        <p className="text-sm text-muted-foreground">
          比赛已开始，可调整启用状态与上线时间；选题和计分已锁定。
        </p>
      )}
      <section aria-label="赛题配置" className="min-w-0 space-y-5">
        {!!ids.length && (
          <div className="flex items-center gap-2">
            <Input
              aria-label="搜索已选赛题"
              placeholder="搜索已选赛题"
              className="max-w-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  find();
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="搜索已选赛题"
              onClick={find}
            >
              <Search />
            </Button>
            {q && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setQ("");
                  setPage(1);
                }}
              >
                清除筛选
              </Button>
            )}
          </div>
        )}
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {!ids.length && <Empty>从题库添加本场比赛的赛题</Empty>}
        {!!ids.length && query.data && !items.length && (
          <Empty>没有符合条件的赛题</Empty>
        )}
        <fieldset
          disabled={query.isPlaceholderData}
          className="min-w-0"
          aria-busy={query.isFetching}
        >
          <ItemGroup className="divide-y">
            {items.map((c) => {
              const v =
                value.find((v) => v.challenge_id === c.id) ??
                questionSetting(c);
              const position = ids.indexOf(c.id);
              const open = expanded.includes(c.id);
              const timed = v.release_at !== null;
              return (
                <Collapsible
                  key={c.id}
                  open={open}
                  onOpenChange={(yes) =>
                    setExpanded((old) =>
                      yes ? [...old, c.id] : old.filter((id) => id !== c.id),
                    )
                  }
                  asChild
                >
                  <Item
                    role="listitem"
                    className="block min-w-0 rounded-none border-0 px-0 py-0"
                    data-question-id={c.id}
                  >
                    <div className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-5">
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`设置 ${c.title}`}
                          className="h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal px-2 py-3 text-left"
                        >
                          <ChevronDown
                            className={`shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                          />
                          <span className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center sm:gap-5">
                            <span className="min-w-0 space-y-1">
                              <span className="block break-words">
                                {position + 1}. {c.title}
                              </span>
                              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
                                <span>{c.category}</span>
                                <span>
                                  {questionTypes[c.challenge_type ?? "ctf"]}
                                </span>
                                {!!c.parts.length && (
                                  <span>{c.parts.length} 个小题</span>
                                )}
                                {!c.published && (
                                  <span className="text-warning">
                                    题库未启用
                                  </span>
                                )}
                                {c.practice && c.published && (
                                  <span>练习场已开放</span>
                                )}
                              </span>
                            </span>
                            <span className="space-y-1">
                              <span className="block tabular-nums">
                                {scoreSummary(c, v.scoring)}
                              </span>
                              <span className="block text-xs font-normal text-muted-foreground">
                                {scoringNames[v.scoring.mode]}
                              </span>
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {v.release_at === ""
                                ? "待设置上线时间"
                                : v.release_at
                                  ? new Date(v.release_at).toLocaleString(
                                      "zh-CN",
                                      {
                                        month: "2-digit",
                                        day: "2-digit",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )
                                  : "随阶段开放"}
                            </span>
                          </span>
                        </Button>
                      </CollapsibleTrigger>
                      <div className="flex shrink-0 items-center justify-end gap-1 px-2">
                        <label className="mr-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            aria-label={`在比赛中启用 ${c.title}`}
                            checked={v.published}
                            onCheckedChange={(published) =>
                              update({ ...v, published })
                            }
                          />
                          {v.published ? "启用" : "停用"}
                        </label>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`上移 ${c.title}`}
                          disabled={locked || !!q || position === 0}
                          onClick={() => move(c.id, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`下移 ${c.title}`}
                          disabled={
                            locked || !!q || position === ids.length - 1
                          }
                          onClick={() => move(c.id, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`移除 ${c.title}`}
                          disabled={locked}
                          onClick={() =>
                            onIdsChange(ids.filter((id) => id !== c.id))
                          }
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                    <CollapsibleContent className="min-w-0">
                      <div className="min-w-0 space-y-6 rounded-lg bg-muted/30 p-4 mb-4 sm:p-6">
                        {issue?.id === c.id && (
                          <p role="alert" className="text-sm text-destructive">
                            {issue.message}
                          </p>
                        )}
                        {!c.published && (
                          <p className="text-sm text-muted-foreground">
                            题库尚未启用此题，启用后选手才能访问。
                          </p>
                        )}
                        <fieldset className="min-w-0 space-y-3">
                          <legend className="mb-3 text-sm font-medium">
                            上线安排
                          </legend>
                          <RadioGroup
                            aria-label={`${c.title}上线安排`}
                            className="flex flex-wrap gap-5"
                            value={timed ? "scheduled" : "phase"}
                            onValueChange={(mode) => {
                              update({
                                ...v,
                                release_at:
                                  mode === "phase"
                                    ? null
                                    : (v.release_at ?? ""),
                              });
                            }}
                          >
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="phase" />
                              随阶段开放
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="scheduled" />
                              定时上线
                            </label>
                          </RadioGroup>
                          {timed && (
                            <Field label="上线时间" className="max-w-sm">
                              <Input
                                type="datetime-local"
                                required
                                aria-label={`${c.title}上线时间`}
                                value={inputDate(v.release_at)}
                                onChange={(e) =>
                                  update({
                                    ...v,
                                    release_at: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : "",
                                  })
                                }
                              />
                            </Field>
                          )}
                        </fieldset>
                        <fieldset
                          disabled={locked}
                          className="min-w-0 border-t pt-5"
                        >
                          <ScoringEditor
                            challenge={c}
                            value={v.scoring}
                            onChange={(scoring) => update({ ...v, scoring })}
                          />
                        </fieldset>
                      </div>
                    </CollapsibleContent>
                  </Item>
                </Collapsible>
              );
            })}
          </ItemGroup>
        </fieldset>
        {!!ids.length && (
          <Pagination
            page={page}
            setPage={setPage}
            total={total}
            pageSize={pageSize}
            hasMore={page * pageSize < (total ?? 0)}
            disabled={query.isFetching}
            alwaysShow
          />
        )}
      </section>
    </section>
  );
}
