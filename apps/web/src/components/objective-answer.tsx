import { useEffect, useRef, useState } from "react";
import { m, useAnimationControls, useReducedMotion } from "motion/react";
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
import { FlagFeedback } from "./flag-feedback";
type Answer = { choices?: string[]; blanks?: Record<string, string> };
type Saved = {
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
    loaded = useRef(false),
    shake = useAnimationControls(),
    reduced = useReducedMotion();
  useEffect(() => {
    if (query.data && !loaded.current) {
      setAnswer(query.data.answer);
      loaded.current = true;
    }
  }, [query.data]);
  const saved = feedback ?? query.data,
    locked =
      readOnly ||
      (!!saved?.finalized_at && scope !== "practice" && !saved.practice);
  const submit = useAction(
    async (finalize: boolean) => {
      const result = await api<Saved>(`/challenges/${id}/answer`, "POST", {
        scope,
        answer,
        finalize,
      });
      setFeedback(result);
      setConfirm(false);
      if (result.correct === false && !reduced)
        void shake.start({
          x: [0, -8, 8, -5, 5, 0],
          transition: { duration: 0.38 },
        });
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
      <m.div animate={shake}>
        <ObjectiveFields
          definition={v}
          answer={answer}
          onChange={setAnswer}
          disabled={locked || submit.isPending || query.isLoading}
        />
      </m.div>
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
            onClick={() =>
              scope === "practice" || saved?.practice
                ? submit.mutate(true)
                : setConfirm(true)
            }
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
      {saved?.finalized_at && (
        <FlagFeedback
          correct={!!saved.correct}
          animate={!!feedback && !!saved.correct}
          message={saved.correct ? "答案正确" : "答案不正确"}
        />
      )}
      {submit.error && <ActionError error={submit.error} />}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交本题答案</DialogTitle>
            <DialogDescription>
              全队共享本次答案，提交后不能修改。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              继续检查
            </Button>
            <Button
              disabled={submit.isPending || readOnly}
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
