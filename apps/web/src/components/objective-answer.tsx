import { useEffect, useRef, useState } from "react";
import { api, useAPI, useAction } from "@/lib/api";
import type { Objective } from "@/lib/competition";
import { ObjectiveFields } from "./objective-fields";
import { QueryState } from "./shared";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ActionError } from "./action-error";
import type { ObjectiveReview } from "@/lib/objective-paper";
type Answer = { choices?: string[]; blanks?: Record<string, string> };
type Saved = {
  review?: ObjectiveReview | null;
  practice?: boolean;
  answer: Answer;
  correct: boolean | null;
  finalized_at: string | null;
};
export function ObjectiveAnswer({
  id,
  scope,
  definition: v,
  readOnly = false,
}: {
  id: string;
  scope: string;
  definition: Objective;
  readOnly?: boolean;
}) {
  const query = useAPI<Saved>(`/challenges/${id}/answer?scope=${scope}`),
    [answer, setAnswer] = useState<Answer>({}),
    [confirm, setConfirm] = useState(false),
    [feedback, setFeedback] = useState<Saved | null>(null),
    [edited, setEdited] = useState(false),
    loaded = useRef(false);
  useEffect(() => {
    if (query.data && (!loaded.current || query.data.finalized_at)) {
      setAnswer(query.data.answer);
      loaded.current = true;
      if (query.data.finalized_at) {
        setEdited(false);
        setConfirm(false);
      }
    }
  }, [query.data]);
  const saved = query.data?.finalized_at
      ? query.data
      : (feedback ?? query.data),
    locked = readOnly || !!saved?.finalized_at;
  const submit = useAction(
    async (finalize: boolean) => {
      const result = await api<Saved>(`/challenges/${id}/answer`, "POST", {
        scope,
        answer,
        finalize,
      });
      setFeedback(result);
      setAnswer(result.answer);
      setConfirm(false);
      setEdited(false);
    },
    undefined,
    false,
  );
  const complete =
    v.type === "blank"
      ? v.blanks.every((b) => answer.blanks?.[b.id]?.trim())
      : !!answer.choices?.length;
  return (
    <section
      aria-label="提交答案"
      className="space-y-5 rounded-lg bg-card p-5 sm:p-7"
    >
      <h2 className="font-medium">
        {v.type === "single"
          ? "单选题"
          : v.type === "multiple"
            ? "多选题"
            : "填空题"}
      </h2>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <ObjectiveFields
        definition={v}
        answer={answer}
        review={!edited && saved?.finalized_at ? saved.review : null}
        onChange={(next) => {
          setAnswer(next);
          setEdited(true);
        }}
        disabled={locked || submit.isPending || query.isLoading}
      />
      {!locked && (
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={submit.isPending || query.isLoading}
            onClick={() => submit.mutate(false)}
          >
            保存答案
          </Button>
          <Button
            disabled={!complete || submit.isPending || query.isLoading}
            onClick={() => setConfirm(true)}
          >
            {submit.isPending ? "提交中" : "提交答案"}
          </Button>
        </div>
      )}
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          本组可查看此题，暂不开放作答。
        </p>
      )}
      {submit.error && <ActionError error={submit.error} />}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交本题答案</DialogTitle>
            <DialogDescription>
              {scope === "practice"
                ? "提交后不能修改答案。"
                : "全队共享本次答案，提交后不能修改。"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              继续检查
            </Button>
            <Button
              disabled={submit.isPending || locked}
              onClick={() => submit.mutate(true)}
            >
              确认提交
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
