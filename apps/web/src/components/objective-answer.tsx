import { useEffect, useRef, useState } from "react";
import { m, useAnimationControls, useReducedMotion } from "motion/react";
import { api, useAPI, useAction } from "@/lib/api";
import type { Objective } from "@/lib/competition";
import { Field, QueryState } from "./shared";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
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
    locked = readOnly || (!!saved?.finalized_at && scope !== "practice");
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
        <fieldset
          disabled={locked || submit.isPending || query.isLoading}
          className="space-y-3"
        >
          {v.type === "blank" ? (
            v.blanks.map((b) => (
              <Field key={b.id} label={b.label}>
                <Input
                  maxLength={500}
                  value={answer.blanks?.[b.id] ?? ""}
                  onChange={(e) =>
                    setAnswer({
                      ...answer,
                      blanks: { ...answer.blanks, [b.id]: e.target.value },
                    })
                  }
                />
              </Field>
            ))
          ) : v.type === "single" ? (
            <RadioGroup
              aria-label="单选答案"
              disabled={locked || submit.isPending || query.isLoading}
              value={answer.choices?.[0] ?? ""}
              onValueChange={(choice) => setAnswer({ choices: [choice] })}
            >
              {v.options.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-4 has-[[data-state=checked]]:bg-accent"
                >
                  <RadioGroupItem className="mt-0.5" value={o.id} />
                  <span className="text-sm font-medium">{o.id}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words text-sm">
                    {o.text}
                  </span>
                </label>
              ))}
            </RadioGroup>
          ) : (
            v.options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-4 has-[[data-state=checked]]:bg-accent"
              >
                <Checkbox
                  className="mt-0.5"
                  disabled={locked || submit.isPending || query.isLoading}
                  checked={answer.choices?.includes(o.id) ?? false}
                  onCheckedChange={(yes) =>
                    setAnswer({
                      choices: yes
                        ? [...(answer.choices ?? []), o.id]
                        : (answer.choices ?? []).filter((id) => id !== o.id),
                    })
                  }
                />
                <span className="text-sm font-medium">{o.id}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words text-sm">
                  {o.text}
                </span>
              </label>
            ))
          )}
        </fieldset>
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
              scope === "practice" ? submit.mutate(true) : setConfirm(true)
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
