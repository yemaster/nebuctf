import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { profiles } from "@/lib/competition";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Plus,
  Search,
  X,
  MoreHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { activateFromRow } from "@/lib/row-action";
import type { Challenge } from "@/lib/types";
import {
  questionTypes,
  questionSetting,
  type ContestQuestion,
  defaultQuestionLogic,
} from "@/lib/competition";
import { retainContestQuestions } from "@/lib/contest-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { ScrollArea } from "../ui/scroll-area";
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
import { ChallengePicker } from "../challenge-picker";
import type {
  SubmissionLimits,
  SubmissionOverride,
} from "@/lib/submission-limits";
import type { HintPolicy, HintOverride } from "@/lib/hints";
import {
  QuestionSubmissionLimits,
  ContestSubmissionLimits,
} from "./contest-submission-limits";
import { QuestionHints, ContestHints } from "./contest-hints";
import { QuestionLogicEditor, ContestRuleHelp } from "./contest-question-logic";
import { Separator } from "../ui/separator";
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
  submissionLimits,
  onSubmissionLimitsChange,
  submissionOverrides,
  onSubmissionOverridesChange,
  hintPolicy,
  onHintPolicyChange,
  hintOverrides,
  onHintOverridesChange,
  defaultIssue,
  disabled,
}: {
  ids: string[];
  onIdsChange: (ids: string[]) => void;
  value: ContestQuestion[];
  onChange: (v: ContestQuestion[]) => void;
  locked: boolean;
  issue: QuestionIssue | null;
  submissionLimits: SubmissionLimits;
  onSubmissionLimitsChange: (value: SubmissionLimits) => void;
  submissionOverrides: SubmissionOverride[];
  onSubmissionOverridesChange: (value: SubmissionOverride[]) => void;
  hintPolicy: HintPolicy;
  onHintPolicyChange: (value: HintPolicy) => void;
  hintOverrides: HintOverride[];
  onHintOverridesChange: (value: HintOverride[]) => void;
  defaultIssue: string;
  disabled: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [adding, setAdding] = useState(false),
    [pickerIds, setPickerIds] = useState<string[]>([]),
    [picked, setPicked] = useState<Challenge[]>([]),
    [expanded, setExpanded] = useState<string[]>([]),
    [defaultsOpen, setDefaultsOpen] = useState(false);
  const query = useQuery({
    queryKey: ["contest-question-settings", [...ids].sort().join(",")],
    queryFn: async () => {
      const batches = Array.from(
        { length: Math.ceil(ids.length / 100) },
        (_, i) => ids.slice(i * 100, (i + 1) * 100),
      );
      const pages = await Promise.all(
        batches.map((batch) =>
          api<{ items: Challenge[] }>("/admin/challenges/search", "POST", {
            ids: batch.join(","),
            page_size: 100,
          }),
        ),
      );
      return pages.flatMap((page) => page.items);
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const questions = ids.flatMap((id) => {
    const question = query.data?.find((c) => c.id === id);
    return question ? [question] : [];
  });
  const matching = questions.filter((c) =>
    c.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
  );
  const items = matching.slice((page - 1) * pageSize, page * pageSize);
  const total = matching.length;
  const groups = [
    ...new Set(
      value
        .map((s) => s.logic?.exclusive_group?.trim())
        .filter((group): group is string => !!group),
    ),
  ];
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total]);
  useEffect(() => {
    const missing = questions.filter(
      (c) => !value.some((v) => v.challenge_id === c.id),
    );
    if (missing.length) onChange([...value, ...missing.map(questionSetting)]);
  }, [questions, value, onChange]);
  useEffect(() => {
    if (defaultIssue) setDefaultsOpen(true);
  }, [defaultIssue]);
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
      <Collapsible
        open={defaultsOpen || !!defaultIssue}
        onOpenChange={setDefaultsOpen}
        className="space-y-5 border-b pb-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">
            赛题{" "}
            <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
              {ids.length} / 200
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-28"
              >
                默认规则{" "}
                <ChevronDown className={defaultsOpen ? "rotate-180" : ""} />
              </Button>
            </CollapsibleTrigger>

            <Dialog
              open={adding}
              onOpenChange={(open) => {
                if (open) {
                  setPickerIds([...ids]);
                  setPicked([]);
                }
                setAdding(open);
              }}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-28"
                  disabled={locked || disabled}
                >
                  <Plus />
                  调整选题
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>选择赛题</DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-[min(60dvh,32rem)] pr-4">
                  <ChallengePicker
                    value={pickerIds}
                    onChange={setPickerIds}
                    onPick={(c) =>
                      setPicked((current) =>
                        current.some((v) => v.id === c.id)
                          ? current
                          : [...current, c],
                      )
                    }
                    disabled={locked || disabled}
                    limit={200}
                  />
                </ScrollArea>
                <DialogFooter className="flex-row items-center border-t pt-4">
                  <span className="mr-auto whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                    已选 {pickerIds.length}
                    <span className="hidden sm:inline"> / 200</span>
                  </span>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      取消
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    disabled={locked || disabled}
                    onClick={() => {
                      const retained = retainContestQuestions(value, pickerIds);
                      onIdsChange(pickerIds);
                      onChange([
                        ...retained,
                        ...picked
                          .filter(
                            (c) =>
                              pickerIds.includes(c.id) &&
                              !retained.some((s) => s.challenge_id === c.id),
                          )
                          .map(questionSetting),
                      ]);
                      setAdding(false);
                    }}
                  >
                    确认选题
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        {defaultIssue && (
          <p role="alert" className="text-sm text-destructive">
            {defaultIssue}
          </p>
        )}
        <CollapsibleContent className="grid gap-5 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:duration-150 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-1 lg:col-span-2">
            <h4 className="text-sm font-medium">默认规则</h4>{" "}
            <ContestRuleHelp>
              次数按每队每题累计，错误 Flag
              也计次。提示逐条解锁、全队共享；多条系数相乘。赛后练习不占正式额度且提示免费。
            </ContestRuleHelp>
          </div>
          <ContestSubmissionLimits
            value={submissionLimits}
            onChange={onSubmissionLimitsChange}
          />
          <div className="space-y-2">
            <h4 className="text-sm font-medium">默认提示规则</h4>
            <ContestHints
              policy={hintPolicy}
              onPolicyChange={onHintPolicyChange}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {locked && (
        <p className="text-sm text-muted-foreground">
          比赛已开始，选题、计分与解锁规则已锁定。
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
          variant="rows"
          error={query.error}
          retry={() => void query.refetch()}
        />
        {!ids.length && <Empty>从题库添加本场比赛的赛题</Empty>}
        {!!ids.length && query.data && !items.length && (
          <Empty>没有符合条件的赛题</Empty>
        )}
        <fieldset
          disabled={query.isFetching}
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
                    <div
                      className="flex cursor-pointer flex-col gap-2 py-3 xl:flex-row xl:items-center xl:gap-5"
                      onClick={(event) =>
                        activateFromRow(event, () =>
                          setExpanded((old) =>
                            open
                              ? old.filter((id) => id !== c.id)
                              : [...old, c.id],
                          ),
                        )
                      }
                    >
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
                          <span className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center sm:gap-5">
                            <span className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={locked || disabled}
                              aria-label={`赛题操作 ${c.title}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              aria-label={`上移 ${c.title}`}
                              disabled={
                                locked || disabled || !!q || position === 0
                              }
                              onSelect={() => move(c.id, -1)}
                            >
                              <ArrowUp />
                              上移
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              aria-label={`下移 ${c.title}`}
                              disabled={
                                locked ||
                                disabled ||
                                !!q ||
                                position === ids.length - 1
                              }
                              onSelect={() => move(c.id, 1)}
                            >
                              <ArrowDown />
                              下移
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              aria-label={`移除 ${c.title}`}
                              variant="destructive"
                              disabled={locked || disabled}
                              onSelect={() =>
                                onIdsChange(ids.filter((id) => id !== c.id))
                              }
                            >
                              <X />
                              移除赛题
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <CollapsibleContent className="min-w-0 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:duration-150">
                      <div className="mb-4 min-w-0 space-y-5 border-t px-2 py-4">
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
                        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                          <fieldset disabled={locked} className="min-w-0">
                            <ScoringEditor
                              challenge={c}
                              value={v.scoring}
                              onChange={(scoring) => update({ ...v, scoring })}
                            />
                          </fieldset>
                          <Separator
                            orientation="vertical"
                            className="hidden h-auto self-stretch xl:block"
                          />
                          <Separator className="xl:hidden" />
                          <div className="min-w-0 space-y-5">
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
                                          ? new Date(
                                              e.target.value,
                                            ).toISOString()
                                          : "",
                                      })
                                    }
                                  />
                                </Field>
                              )}
                            </fieldset>
                            {profiles(c).container?.mode !== "public" &&
                              profiles(c).container && (
                                <fieldset className="space-y-3">
                                  <legend className="mb-3 text-sm font-medium">
                                    靶机开启次数
                                  </legend>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="限制方式">
                                      <NativeSelect
                                        aria-label={`${c.title}开启次数限制`}
                                        wrapperClassName="w-full"
                                        value={
                                          v.container_start_limit?.mode ??
                                          "inherit"
                                        }
                                        onChange={(event) =>
                                          update({
                                            ...v,
                                            container_start_limit: {
                                              mode: event.target.value as
                                                | "inherit"
                                                | "unlimited"
                                                | "custom",
                                              count:
                                                event.target.value === "custom"
                                                  ? (v.container_start_limit
                                                      ?.count ?? 3)
                                                  : null,
                                            },
                                          })
                                        }
                                      >
                                        <NativeSelectOption value="inherit">
                                          跟随比赛
                                        </NativeSelectOption>
                                        <NativeSelectOption value="unlimited">
                                          不限制
                                        </NativeSelectOption>
                                        <NativeSelectOption value="custom">
                                          单独设置
                                        </NativeSelectOption>
                                      </NativeSelect>
                                    </Field>
                                    {v.container_start_limit?.mode ===
                                      "custom" && (
                                      <Field label="每队最多开启">
                                        <Input
                                          type="number"
                                          aria-label={`${c.title}每队开启次数`}
                                          min={0}
                                          max={10000}
                                          step={1}
                                          required
                                          value={
                                            v.container_start_limit.count ?? ""
                                          }
                                          onChange={(event) =>
                                            update({
                                              ...v,
                                              container_start_limit: {
                                                mode: "custom",
                                                count:
                                                  event.target.value === ""
                                                    ? null
                                                    : Number(
                                                        event.target.value,
                                                      ),
                                              },
                                            })
                                          }
                                        />
                                      </Field>
                                    )}
                                  </div>
                                </fieldset>
                              )}
                            <QuestionSubmissionLimits
                              challenge={c}
                              defaults={submissionLimits}
                              value={submissionOverrides.find(
                                (s) => s.challenge_id === c.id,
                              )}
                              onChange={(next) =>
                                onSubmissionOverridesChange([
                                  ...submissionOverrides.filter(
                                    (s) => s.challenge_id !== c.id,
                                  ),
                                  ...(next ? [next] : []),
                                ])
                              }
                            />
                            <QuestionHints
                              challenge={c}
                              overrides={hintOverrides}
                              onOverridesChange={onHintOverridesChange}
                            />
                          </div>
                        </div>
                        <QuestionLogicEditor
                          challenge={c}
                          value={v.logic ?? defaultQuestionLogic()}
                          onChange={(logic) => update({ ...v, logic })}
                          questions={questions}
                          groups={groups}
                          locked={locked || disabled}
                        />
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
