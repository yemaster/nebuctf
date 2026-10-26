import {
  ObjectivePaper,
  ObjectiveNavigation,
} from "@/components/objective-paper";
import { useObjectivePaper } from "@/lib/use-objective-paper";
import { OBJECTIVE_PAPER } from "@/lib/objective-paper";
import { activateFromRow } from "@/lib/row-action";
import { PhaseCards } from "@/components/contest-timing";
import type { ContestClock } from "@/lib/contest-clock";
import { ChallengeBloods } from "@/components/challenge-bloods";
import type { Phase } from "@/lib/competition";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChallengeCatalog } from "@/components/challenge-catalog";
import { PageTitle } from "@/components/shared";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDashed,
  ChevronDown,
  List,
  Search,
  X,
} from "lucide-react";
import { useAPI } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Empty, Pagination, QueryState } from "@/components/shared";
import { ChallengeWorkspace } from "@/components/challenge-workspace";
import { learningReturnPath } from "@/lib/learning-navigation";
import { usePracticeTransition } from "@/lib/practice-transition";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { TransitionSurface } from "@/components/transition-surface";

export const categories = [
  "Web",
  "Pwn",
  "Reverse",
  "Crypto",
  "Misc",
  "Forensics",
];
type OpenChallenge = { id: string; title: string };

export function Challenges({
  scope = "practice",
  embedded = false,
}: {
  scope?: string;
  embedded?: boolean;
}) {
  const [params] = useSearchParams();
  const problemset = scope === "practice" ? params.get("problemset") : null;
  return (
    <ChallengeBrowser
      key={`${scope}:${problemset ?? ""}`}
      scope={scope}
      embedded={embedded}
      problemset={problemset}
    />
  );
}
function ChallengeBrowser({
  scope,
  embedded,
  problemset,
}: {
  scope: string;
  embedded: boolean;
  problemset: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const returnToTree =
    scope === "practice" && !problemset ? learningReturnPath(params) : null;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  useEffect(() => setSearch(q), [q]);
  function filter(values: Record<string, string>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  }
  const setPage = (value: number) => filter({ page: String(value) });
  const [mobile, setMobile] = useState(false);
  const [expanded, setExpanded] = useState(["客观题", ...categories]);
  const [opened, setOpened] = useState<OpenChallenge[]>([]);
  const data = useAPI<{
    items: Challenge[];
    total: number;
    filtered_total?: number;
    title?: string;
    phases?: Phase[];
    clock?: ContestClock | null;
    objective_count?: number;
  }>(
    problemset
      ? `/problemsets/${encodeURIComponent(problemset)}?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}`
      : `/challenges?scope=${scope}&category=${category}&q=${encodeURIComponent(q)}&page=${page}`,
    true,
    scope === "practice" ? undefined : 15000,
  );
  const total = data.data?.filtered_total ?? data.data?.total;
  const returnToSet = problemset
    ? `/problemsets/${encodeURIComponent(problemset)}?page=${page}`
    : null;
  const returnTo = returnToSet ?? returnToTree;
  const returnLabel = returnToSet ? "返回题单" : "返回技能树";
  const objectiveCount =
    data.data?.objective_count ??
    data.data?.items.filter((q) => q.challenge_type === "objective").length ??
    0;
  const rawRequested = params.get("challenge");
  const legacyObjective =
    scope !== "practice" &&
    !!data.data?.items.some(
      (c) => c.id === rawRequested && c.challenge_type === "objective",
    );
  const requested = legacyObjective ? OBJECTIVE_PAPER : rawRequested;
  const paperFocus =
    params.get("question") ?? (legacyObjective ? rawRequested : null);
  const routeSelection =
    requested ??
    (scope !== "practice" || problemset
      ? scope !== "practice" &&
        data.data?.items[0]?.challenge_type === "objective"
        ? OBJECTIVE_PAPER
        : (data.data?.items[0]?.id ??
          (scope !== "practice" && objectiveCount > 0 ? OBJECTIVE_PAPER : null))
      : null);
  function selectionParams(previous: URLSearchParams, id: string | null) {
    const next = new URLSearchParams(previous);
    next.set("page", String(page));
    if (q) next.set("q", q);
    else next.delete("q");
    if (category) next.set("category", category);
    else next.delete("category");
    if (id !== OBJECTIVE_PAPER) next.delete("question");
    if (id) next.set("challenge", id);
    else next.delete("challenge");
    return next;
  }
  const select = (id: string | null, replace = false) => {
    setParams((previous) => selectionParams(previous, id), { replace });
    setMobile(false);
  };
  const transition = usePracticeTransition(routeSelection, select);
  const selected = transition.selected;
  const reduced = useReducedMotion();
  const entering =
    transition.phase === "shrinking" || transition.phase === "loading";
  useEffect(() => {
    if ((scope === "practice" && !problemset) || requested || !selected) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("challenge", selected);
        return next;
      },
      { replace: true },
    );
  }, [scope, problemset, requested, selected, setParams]);
  const paper = useObjectivePaper(
    scope,
    scope !== "practice" &&
      (objectiveCount > 0 || selected === OBJECTIVE_PAPER),
    selected === OBJECTIVE_PAPER,
  );
  const selectObjective = (id: string) => {
    setParams((previous) => {
      const next = selectionParams(previous, OBJECTIVE_PAPER);
      next.set("question", id);
      return next;
    });
    setMobile(false);
    requestAnimationFrame(() =>
      document
        .getElementById(`paper-question-${id}`)
        ?.scrollIntoView?.({ block: "start", behavior: "instant" }),
    );
  };
  const detail = useAPI<Challenge>(
    `/challenges/${selected}?scope=${scope}`,
    !!selected && selected !== OBJECTIVE_PAPER,
  );
  const groups = [...(scope === "practice" ? ["客观题"] : []), ...categories]
    .map((name) => ({
      name,
      items:
        data.data?.items.filter((c) =>
          name === "客观题"
            ? c.challenge_type === "objective"
            : c.challenge_type !== "objective" && c.category === name,
        ) ?? [],
    }))
    .filter((g) => g.items.length);
  useEffect(() => {
    if (selected === OBJECTIVE_PAPER) {
      setOpened((previous) =>
        previous.some((item) => item.id === OBJECTIVE_PAPER)
          ? previous
          : [...previous, { id: OBJECTIVE_PAPER, title: "客观题" }],
      );
      return;
    }
    if (!detail.data || detail.data.id !== selected) return;
    const c = detail.data;
    setOpened((previous) =>
      previous.some((item) => item.id === c.id && item.title === c.title)
        ? previous
        : [
            ...previous.filter((item) => item.id !== c.id),
            { id: c.id, title: c.title },
          ],
    );
  }, [detail.data, selected]);
  const tabs =
    selected && !opened.some((c) => c.id === selected)
      ? [
          ...opened,
          {
            id: selected,
            title:
              selected === OBJECTIVE_PAPER
                ? "客观题"
                : (data.data?.items.find((c) => c.id === selected)?.title ??
                  "题目"),
          },
        ]
      : opened;
  const close = (id: string) => {
    const remaining = tabs.filter((c) => c.id !== id);
    setOpened(remaining);
    if (id === selected) select(remaining.at(-1)?.id ?? null, true);
  };
  const directory = (
    <>
      <form
        className="px-5 pb-4"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          filter({ q: search.trim(), page: "1" });
        }}
      >
        <InputGroup className="border-0 bg-background shadow-none">
          <InputGroupInput
            aria-label="搜索题目"
            placeholder="搜索题目"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="icon-sm" aria-label="搜索">
              <Search />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="px-5 pb-2">
        <NativeSelect
          aria-label="题目分类"
          value={category}
          onChange={(e) => {
            filter({ category: e.target.value, page: "1" });
          }}
          className="border-0 shadow-none"
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pb-6">
          <QueryState
            loading={data.isLoading}
            error={data.error}
            retry={() => void data.refetch()}
          />
          {problemset ? (
            <div className="space-y-1" aria-label="题单题目">
              {data.data?.items.map((c) => (
                <DirectoryItem
                  key={c.id}
                  c={c}
                  selected={selected}
                  select={select}
                />
              ))}
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={expanded}
              onValueChange={setExpanded}
            >
              {scope !== "practice" &&
                (objectiveCount > 0 || selected === OBJECTIVE_PAPER) && (
                  <AccordionItem value="客观题" className="border-0">
                    <AccordionTrigger
                      className="px-2 py-4"
                      onClick={(event) => {
                        if (selected !== OBJECTIVE_PAPER) {
                          event.preventDefault();
                          setExpanded((old) =>
                            old.includes("客观题") ? old : [...old, "客观题"],
                          );
                          select(OBJECTIVE_PAPER);
                        }
                      }}
                    >
                      客观题
                      <span className="ml-auto mr-2 text-xs font-normal tabular-nums text-muted-foreground">
                        {objectiveCount}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {paper.query.data?.items.length ? (
                        <ObjectiveNavigation
                          model={paper}
                          active={
                            selected === OBJECTIVE_PAPER
                              ? (paperFocus ??
                                paper.query.data?.items[0]?.id ??
                                null)
                              : null
                          }
                          onSelect={selectObjective}
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => {
                            select(OBJECTIVE_PAPER);
                            if (paper.query.error) void paper.query.refetch();
                          }}
                        >
                          {paper.query.isLoading
                            ? "正在读取答卷"
                            : paper.query.error
                              ? "重新读取答卷"
                              : "查看答卷"}
                        </Button>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}
              {groups.map((group) => (
                <AccordionItem
                  key={group.name}
                  value={group.name}
                  className="border-0"
                >
                  <AccordionTrigger className="px-2 py-4">
                    {group.name}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1 pb-4">
                    {group.items.map((c) => (
                      <DirectoryItem
                        key={c.id}
                        c={c}
                        selected={selected}
                        select={select}
                        contest={scope !== "practice"}
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
          {data.data?.items.length === 0 && !objectiveCount && (
            <Empty>没有符合条件的题目</Empty>
          )}
          {scope === "practice" && (
            <Pagination
              page={page}
              setPage={setPage}
              hasMore={page * 24 < (total ?? 0)}
            />
          )}
        </div>
      </ScrollArea>
    </>
  );
  const catalog = (
    <div
      data-practice-list
      style={{
        viewTransitionName:
          transition.phase === "source" || transition.phase === "returning"
            ? "practice-directory"
            : undefined,
      }}
      className="h-full overflow-y-auto px-6 py-8 sm:px-10 lg:px-14 lg:py-10"
    >
      <PageTitle
        action={
          scope === "practice" ? (
            <Button variant="secondary" asChild>
              <Link to="/problemsets">题单</Link>
            </Button>
          ) : (
            <Button variant="ghost" asChild>
              <Link to={`/contests/${scope}`}>返回比赛</Link>
            </Button>
          )
        }
      >
        {scope === "practice" ? "练习场" : "赛题"}
      </PageTitle>
      <form
        className="mb-8 flex flex-wrap items-center gap-4"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          filter({ q: search.trim(), page: "1" });
        }}
      >
        <InputGroup className="w-full sm:w-80">
          <InputGroupInput
            aria-label="搜索题库"
            placeholder="搜索题目"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" aria-label="搜索">
              <Search />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <NativeSelect
          aria-label="筛选分类"
          value={category}
          onChange={(e) => {
            filter({ category: e.target.value, page: "1" });
          }}
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="ml-auto text-sm text-muted-foreground">
          {data.data?.total ?? 0} 题
        </span>
      </form>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      {data.data && (
        <ChallengeCatalog
          items={data.data.items}
          onSelect={
            scope === "practice" && !problemset && !selected
              ? transition.enter
              : undefined
          }
          getHref={(id) =>
            `${scope === "practice" ? "/challenges" : `/contests/${scope}/challenges`}?${selectionParams(params, id)}`
          }
        />
      )}
      {data.data?.items.length === 0 && !objectiveCount && (
        <Empty>没有符合条件的题目</Empty>
      )}
      <Pagination
        page={page}
        setPage={setPage}
        hasMore={page * 24 < (data.data?.total ?? 0)}
        total={data.data?.total}
        pageSize={24}
      />
    </div>
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  if (data.error || (selected && detail.error && !entering))
    return (
      <QueryState
        loading={false}
        error={data.error || detail.error}
        retry={() => {
          void data.refetch();
          if (selected) void detail.refetch();
        }}
        fullPage
      />
    );
  return (
    <>
      {scope === "practice" && !problemset && !selected && catalog}
      <div
        className={`${scope === "practice" && !problemset && !selected ? "hidden" : "flex"} w-full overflow-hidden ${embedded ? "h-[75dvh] min-h-[560px]" : "h-full min-h-0"}`}
      >
        <aside
          aria-label="题目目录"
          style={{
            viewTransitionName:
              entering || transition.phase === "return-source"
                ? "practice-directory"
                : undefined,
          }}
          className="hidden w-80 shrink-0 flex-col bg-card lg:flex 2xl:w-96"
        >
          <div className="flex h-16 shrink-0 items-center px-5">
            {scope === "practice" ? (
              returnTo ? (
                <Button variant="ghost" asChild>
                  <Link to={returnTo}>
                    <ArrowLeft />
                    {returnLabel}
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" onClick={transition.returnToList}>
                  <ArrowLeft />
                  返回题库
                </Button>
              )
            ) : (
              <h1 className="font-medium">赛题</h1>
            )}
          </div>
          {problemset && data.data?.title && (
            <h1 className="px-5 pb-4 font-medium break-words">
              {data.data.title}
            </h1>
          )}
          {directory}
        </aside>
        <section
          className="relative flex min-w-0 flex-1 flex-col"
          aria-label="解题区"
        >
          <AnimatePresence>
            {transition.phase === "loading" && (
              <TransitionSurface key={selected} loading />
            )}
          </AnimatePresence>
          <m.div
            initial={false}
            animate={{ opacity: entering ? 0 : 1, y: entering ? 8 : 0 }}
            transition={{
              duration: entering || reduced ? 0 : 0.28,
              ease: "easeOut",
            }}
            className="flex min-h-0 flex-1 flex-col"
            inert={entering || undefined}
            aria-hidden={entering || undefined}
            style={{ visibility: entering ? "hidden" : undefined }}
            data-practice-content={entering ? "waiting" : "visible"}
          >
            <Tabs
              value={selected ?? ""}
              onValueChange={(id) => select(id)}
              className="h-full min-h-0 gap-0"
            >
              <div className="flex h-14 shrink-0 items-center gap-2 px-3">
                {scope === "practice" &&
                  (returnTo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="lg:hidden"
                      asChild
                    >
                      <Link to={returnTo}>
                        <ArrowLeft />
                        {returnLabel}
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="lg:hidden"
                      aria-label="返回题库"
                      onClick={transition.returnToList}
                    >
                      <ArrowLeft />
                    </Button>
                  ))}
                <Sheet open={mobile} onOpenChange={setMobile}>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="lg:hidden"
                      aria-label="题目目录"
                    >
                      <List />
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    aria-describedby={undefined}
                    className="w-80 gap-0 border-0 bg-card p-0"
                  >
                    <SheetHeader className="px-6 py-6">
                      <SheetTitle>
                        {problemset
                          ? (data.data?.title ?? "题单题目")
                          : "题目目录"}
                      </SheetTitle>
                    </SheetHeader>
                    {directory}
                  </SheetContent>
                </Sheet>
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <TabsList
                    className="h-10 w-max justify-start gap-2 bg-transparent p-0"
                    aria-label="已打开题目"
                  >
                    {tabs.map((c) => (
                      <div
                        key={c.id}
                        className={`flex items-center rounded-md ${selected === c.id ? "bg-secondary" : ""}`}
                      >
                        <TabsTrigger
                          value={c.id}
                          className="h-10 max-w-64 flex-none gap-2 px-4 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-transparent"
                        >
                          <span className="truncate">{c.title}</span>
                        </TabsTrigger>
                        {tabs.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="mr-2"
                            aria-label={`关闭 ${c.title}`}
                            onClick={() => close(c.id)}
                          >
                            <X />
                          </Button>
                        )}
                      </div>
                    ))}
                  </TabsList>
                </div>
              </div>
              {tabs.map((c) => (
                <TabsContent
                  key={`${scope}-${c.id}`}
                  value={c.id}
                  forceMount
                  className="min-h-0 flex-1 data-[state=inactive]:hidden"
                >
                  {c.id === OBJECTIVE_PAPER ? (
                    <ObjectivePaper
                      scope={scope}
                      model={paper}
                      focus={paperFocus}
                      active={selected === OBJECTIVE_PAPER}
                    />
                  ) : (
                    <ChallengeWorkspace
                      id={c.id}
                      scope={scope}
                      active={selected === c.id}
                      solved={
                        data.data?.items.find((item) => item.id === c.id)
                          ?.solved
                      }
                    />
                  )}
                </TabsContent>
              ))}
              {!selected && (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8">
                  <QueryState
                    loading={data.isLoading}
                    error={data.error}
                    retry={() => void data.refetch()}
                  />
                  {!!data.data?.phases?.some((p) => p.mode !== "inherit") && (
                    <div className="w-full max-w-3xl">
                      <PhaseCards scope={scope} phases={data.data.phases} />
                    </div>
                  )}
                  {!data.isLoading &&
                    !data.error &&
                    !data.data?.phases?.some((p) => p.status === "ready") && (
                      <Empty>暂无题目</Empty>
                    )}
                </div>
              )}
            </Tabs>
          </m.div>
        </section>
      </div>
    </>
  );
}

function DirectoryItem({
  c,
  selected,
  select,
  contest = false,
}: {
  c: Challenge;
  selected: string | null;
  select: (id: string) => void;
  contest?: boolean;
}) {
  const [open, setOpen] = useState(selected === c.id);
  useEffect(() => {
    if (selected === c.id) setOpen(true);
  }, [selected, c.id]);
  const activate = () => {
    setOpen(true);
    select(c.id);
  };
  const multipart = !!c.parts?.length;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={
        selected === c.id ? "rounded-lg bg-secondary/70" : "rounded-lg"
      }
    >
      <div
        className="cursor-pointer py-1"
        onClick={(event) => activateFromRow(event, activate)}
      >
        <div className="flex items-center pr-2">
          <Button
            variant="ghost"
            className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-3 px-3 py-2 font-normal hover:bg-transparent hover:text-inherit dark:hover:bg-transparent"
            onClick={activate}
            aria-current={selected === c.id ? "true" : undefined}
          >
            {c.solved ? (
              <CheckCircle2
                className="size-4 shrink-0 text-success"
                aria-label="已解出"
              />
            ) : c.solved_parts > 0 ? (
              <CircleDashed className="size-4 shrink-0 text-primary" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-left" title={c.title}>
              {c.title}
            </span>
            <span
              className="min-w-8 shrink-0 text-right tabular-nums text-muted-foreground"
              aria-label={`${c.points} 分`}
            >
              {c.points}
            </span>
          </Button>
          {multipart ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6 shrink-0 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent [&[data-state=open]>svg]:rotate-180"
                aria-label={`${c.title} 小题展开或折叠`}
              >
                <ChevronDown className="motion-safe:transition-transform" />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          )}
        </div>
        {c.challenge_type !== "objective" && (
          <div className="flex min-h-7 items-center justify-between gap-2 pl-10 pr-3 pb-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              {multipart && (
                <span>
                  {c.solved_parts}/{c.total_parts} 小题
                </span>
              )}
              <span>
                {c.challenge_type === "awd"
                  ? "AWD 对抗"
                  : `${c.solves} ${contest ? "队" : "人"}${multipart ? "全部解出" : "解出"}`}
              </span>
            </span>
            {contest && !multipart && c.challenge_type !== "awd" && (
              <ChallengeBloods title={c.title} bloods={c.bloods} />
            )}
          </div>
        )}
      </div>
      {multipart && (
        <CollapsibleContent>
          <ul
            aria-label={`${c.title} 小题进度`}
            className="space-y-1 pb-2 pl-7 pr-2"
          >
            {c.parts.map((part) => (
              <li
                key={part.id}
                className="cursor-pointer"
                onClick={(event) => activateFromRow(event, () => select(c.id))}
              >
                <Button
                  variant="ghost"
                  className="h-auto min-h-8 w-full justify-start gap-2 px-3 py-1.5 text-xs font-normal hover:bg-transparent hover:text-inherit dark:hover:bg-transparent"
                  onClick={() => select(c.id)}
                  aria-label={`${part.title} ${part.solved ? "已通过" : "未通过"}`}
                >
                  {part.solved ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-left"
                    title={part.title}
                  >
                    {part.title}
                  </span>
                  <span className="min-w-8 pr-6 text-right tabular-nums text-muted-foreground">
                    {part.points}
                  </span>
                </Button>
                {contest && (
                  <div className="flex min-h-6 items-center justify-between gap-2 pl-8 pr-1 text-xs text-muted-foreground">
                    <span>{part.solves} 队解出</span>
                    <ChallengeBloods title={part.title} bloods={part.bloods} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
