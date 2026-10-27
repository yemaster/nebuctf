import { ChallengeHints } from "./challenge-hints";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, X, Save } from "lucide-react";
import type { ObjectivePaperModel } from "@/lib/use-objective-paper";
import {
  answerColors,
  answerLabels,
  answerComplete,
} from "@/lib/objective-paper";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { QueryState, Empty } from "./shared";
import { Markdown } from "./markdown";
import { ObjectiveFields } from "./objective-fields";
import { PhaseCards } from "./contest-timing";
import { useContestNow } from "./contest-clock";
import { ActionError } from "./action-error";
import { useObjectiveSubmissionNotice } from "@/lib/use-objective-submission-notice";

export function ObjectiveNavigation({
  model,
  active,
  onSelect,
}: {
  model: ObjectivePaperModel;
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="客观题题号" className="px-2 pb-3">
      <div className="grid grid-cols-6 gap-2">
        {model.query.data?.items.map((q, i) => {
          const state = model.state(q);
          return (
            <Button
              key={q.id}
              variant="ghost"
              className={`relative size-9 p-0 tabular-nums ring-inset ${answerColors[state]} ${active === q.id ? "ring-2 ring-foreground/40" : ""}`}
              aria-label={`第 ${i + 1} 题 ${answerLabels[state]}`}
              aria-current={active === q.id ? "true" : undefined}
              title={`${q.title}：${answerLabels[state]}`}
              onClick={() => onSelect(q.id)}
            >
              {i + 1}
              {state === "correct" ? (
                <Check className="absolute bottom-0 right-0 size-2.5" />
              ) : state === "incorrect" ? (
                <X className="absolute bottom-0 right-0 size-2.5" />
              ) : null}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

export function ObjectivePaper({
  scope,
  model,
  focus,
  active,
}: {
  scope: string;
  model: ObjectivePaperModel;
  focus: string | null;
  active: boolean;
}) {
  const notice = useObjectiveSubmissionNotice();
  const { query, submit } = model,
    data = query.data,
    [confirm, setConfirm] = useState(false);
  const now = useContestNow(data, query.dataUpdatedAt);
  useEffect(() => {
    if (
      confirm &&
      data?.items.length &&
      data.items
        .filter((q) => q.permissions.submit)
        .every((q) => q.saved.finalized_at)
    )
      setConfirm(false);
  }, [confirm, data]);
  useEffect(() => {
    if (!active || !focus || !data) return;
    document
      .getElementById(`paper-question-${focus}`)
      ?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [active, focus, !!data]);
  if (query.isLoading || query.error || !data)
    return (
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
        fullPage
      />
    );
  const editable = data.items.filter((q) => q.permissions.submit),
    pending = editable.filter((q) => !q.saved.finalized_at);
  const completed = data.items.filter((q) =>
    answerComplete(q.objective, model.response(q)),
  ).length;
  const remaining = pending.filter(
    (q) => !answerComplete(q.objective, model.response(q)),
  ).length;
  const withinTime =
    data.can_submit &&
    (data.practice ||
      !data.phase.deadline_at ||
      Date.parse(data.phase.deadline_at) > now);
  const canSubmit = withinTime && pending.length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="客观题答卷">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10 md:pt-12 lg:pb-10">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">客观题</h1>
            <span className="text-sm tabular-nums text-muted-foreground">
              已填写 {completed}/{data.items.length}
            </span>
          </header>
          {data.preview && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-md bg-muted px-4 py-3 text-sm">
              <span>报名比赛后即可作答</span>
              <Button asChild variant="secondary" size="sm">
                <Link to={`/contests/${scope}`}>前往报名</Link>
              </Button>
            </div>
          )}
          {!data.items.length && (
            <>
              <PhaseCards scope={scope} phases={[data.phase]} />
              {!["ready", "scheduled"].includes(data.phase.status) && (
                <Empty>暂无客观题</Empty>
              )}
            </>
          )}
          <div className="divide-y">
            {data.items.map((q, index) => {
              const locked =
                !withinTime || !q.permissions.submit || !!q.saved.finalized_at;
              return (
                <section
                  key={q.id}
                  id={`paper-question-${q.id}`}
                  aria-label={`第 ${index + 1} 题 ${q.title}`}
                  className="scroll-mt-6 space-y-5 py-8 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="break-words text-base font-medium">
                        {index + 1}. {q.title}
                      </h2>
                      <Badge variant="secondary" className="font-normal">
                        {q.objective.type === "single"
                          ? "单选"
                          : q.objective.type === "multiple"
                            ? "多选"
                            : "填空"}
                      </Badge>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {q.points} 分
                    </span>
                  </div>
                  {q.description && <Markdown>{q.description}</Markdown>}
                  {!!q.hints?.length && (
                    <ChallengeHints
                      challenge={{ id: q.id, hints: q.hints }}
                      scope={scope}
                      refresh={() => void query.refetch()}
                      available={data.can_submit || data.preview}
                    />
                  )}
                  <ObjectiveFields
                    definition={q.objective}
                    answer={model.response(q)}
                    review={
                      q.saved.finalized_at && !model.edited(q.id)
                        ? q.saved.review
                        : null
                    }
                    disabled={locked || submit.isPending}
                    onChange={(answer) => model.change(q, answer)}
                  />
                  {!q.permissions.submit && (
                    <p className="text-xs text-muted-foreground">
                      本题未开放作答
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </ScrollArea>
      {submit.error && (
        <div className="flex items-center gap-3 border-t px-6 py-3">
          <ActionError error={submit.error} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void model.reload()}
          >
            重新读取答卷
          </Button>
        </div>
      )}
      {data.items.length > 0 && !data.preview && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card py-3 pl-6 pr-16">
          <span className="text-sm text-muted-foreground" role="status">
            {!editable.length
              ? "本卷仅供查看"
              : !pending.length
                ? "答卷已提交"
                : !withinTime
                  ? "作答已结束"
                  : model.dirty
                    ? "有未保存的答案"
                    : submit.isSuccess
                      ? "答案已保存"
                      : "全队共享答卷"}
          </span>
          {canSubmit && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={!model.dirty || submit.isPending}
                onClick={() => submit.mutate(false)}
              >
                <Save />
                保存草稿
              </Button>
              <Button
                disabled={submit.isPending}
                onClick={() =>
                  remaining > 0 || notice.needsConfirmation()
                    ? setConfirm(true)
                    : submit.mutate(true)
                }
              >
                提交答卷
              </Button>
            </div>
          )}
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交客观题答卷</DialogTitle>
            <DialogDescription>
              {remaining > 0
                ? `还有 ${remaining} 题未完成。`
                : "全部题目已填写。"}
              {notice.needsConfirmation() &&
                "全队共享本次提交，提交后不能修改。"}
            </DialogDescription>
          </DialogHeader>
          {submit.error && <ActionError error={submit.error} />}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              继续检查
            </Button>
            <Button
              disabled={submit.isPending || !canSubmit}
              onClick={() => {
                notice.acknowledge();
                submit.mutate(true, { onSuccess: () => setConfirm(false) });
              }}
            >
              {submit.isPending ? "提交中" : "确认交卷"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
