import { useRef, useState } from "react";
import type { QuestionLogic } from "@/lib/competition";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ActionError } from "./action-error";

type Question = {
  id: string;
  title: string;
  contest_logic?: QuestionLogic & { exclusive_selected: boolean };
};
type Request = { questions: Question[]; submit: () => Promise<unknown> };

export function useExclusiveSubmission(scope: string) {
  const accepted = useRef(new Set<string>());
  const [request, setRequest] = useState<Request | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const unselected = (questions: Question[]) =>
    questions.filter(
      (q) =>
        q.contest_logic?.exclusive_group &&
        !q.contest_logic.exclusive_selected &&
        !accepted.current.has(`${scope}:${q.id}`),
    );
  const confirm = (questions: Question[], submit: () => Promise<unknown>) => {
    const choices = unselected(questions);
    if (!choices.length) {
      void submit().catch(() => {});
      return;
    }
    setError(null);
    setRequest({ questions: choices, submit });
  };
  return {
    needsConfirmation: (questions: Question[]) =>
      unselected(questions).length > 0,
    confirm,
    dialog: (
      <Dialog
        open={!!request}
        onOpenChange={(open) => {
          if (!open && !pending) setRequest(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认比赛路线</DialogTitle>
            <DialogDescription>
              首次提交后将固定路线，同组其他题将不可作答。
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {request?.questions.map((q) => (
              <li key={q.id}>
                {q.title} · {q.contest_logic?.exclusive_group}
              </li>
            ))}
          </ul>
          {error && <ActionError error={error} />}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setRequest(null)}
            >
              取消
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (!request) return;
                setPending(true);
                setError(null);
                try {
                  const result = await request.submit();
                  if (result !== undefined)
                    for (const q of request.questions)
                      accepted.current.add(`${scope}:${q.id}`);
                  setRequest(null);
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause : new Error("提交失败"),
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "提交中" : "确认提交"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    ),
  };
}
