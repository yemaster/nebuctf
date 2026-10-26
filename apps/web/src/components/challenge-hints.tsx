import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { ApiError, api, useAction } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { hintPrice, type ChallengeHint } from "@/lib/hints";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { ActionError } from "./action-error";
import { Markdown } from "./markdown";

export function ChallengeHints({
  challenge,
  scope,
  refresh,
  available = true,
}: {
  challenge: Pick<Challenge, "id" | "hints">;
  available?: boolean;
  scope: string;
  refresh: () => void;
}) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState<ChallengeHint | null>(null);
  const [revealed, setRevealed] = useState<Record<string, ChallengeHint>>({});
  const [open, setOpen] = useState<string[]>([]);
  const unlock = useAction(
    async (hint: ChallengeHint) => {
      const result = await api<ChallengeHint>(
        `/challenges/${challenge.id}/hints/${hint.id}/unlock`,
        "POST",
        { scope, quote: hint.quote, confirmed: hint.policy?.mode !== "free" },
      ).catch((error) => {
        if (error instanceof ApiError && error.status === 409) {
          setConfirm(null);
          refresh();
        }
        throw error;
      });
      setRevealed((v) => ({ ...v, [hint.id]: result }));
      setOpen((v) => (v.includes(hint.id) ? v : [...v, hint.id]));
      setConfirm(null);
      refresh();
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey.some(
            (k) => typeof k === "string" && k.includes("scoreboard"),
          ),
      });
    },
    undefined,
    false,
  );
  const hints = challenge.hints.map((hint, i): ChallengeHint =>
    typeof hint === "string"
      ? {
          id: String(i),
          content: hint,
          unlocked: true,
          policy: { mode: "free" },
        }
      : (revealed[hint.id] ?? hint),
  );
  const change = (values: string[]) => {
    const next = values.find((v) => !open.includes(v));
    const hint = hints.find((h) => h.id === next);
    if (hint && !hint.unlocked) {
      unlock.reset();
      if (hint.policy?.mode === "free") unlock.mutate(hint);
      else setConfirm(hint);
    } else setOpen(values);
  };
  return (
    <section aria-label="题目提示" className="space-y-2">
      <Accordion type="multiple" value={open} onValueChange={change}>
        {hints.map((hint, i) => (
          <AccordionItem key={hint.id} value={hint.id}>
            <AccordionTrigger
              disabled={unlock.isPending || (!available && !hint.unlocked)}
              className="py-3"
            >
              <span className="flex items-center gap-2">
                提示 {i + 1}
                {!hint.unlocked && (
                  <LockKeyhole className="size-3.5 text-muted-foreground" />
                )}
              </span>
              <span className="ml-auto mr-2 text-xs font-normal text-muted-foreground">
                {hint.unlocked
                  ? hint.policy?.mode !== "free"
                    ? `已解锁 / ${hintPrice(hint.policy ?? { mode: "free" })}`
                    : ""
                  : unlock.isPending && unlock.variables?.id === hint.id
                    ? "正在解锁"
                    : hintPrice(hint.policy ?? { mode: "free" })}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {hint.content !== undefined && (
                <Markdown>{hint.content}</Markdown>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {!confirm && unlock.error && <ActionError error={unlock.error} />}
      <Dialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v && !unlock.isPending) {
            setConfirm(null);
            unlock.reset();
          }
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!unlock.isPending}>
          <DialogHeader>
            <DialogTitle>查看提示</DialogTitle>
            <DialogDescription>
              {confirm?.policy?.mode === "fixed"
                ? `战队总分立即扣除 ${confirm.policy.points} 分，可为负分。`
                : confirm?.policy?.mode === "factor"
                  ? `本题已得分及后续得分乘以 ${confirm.policy.factor}，包含所有小题和轮次。多条提示的系数相乘，按计分记录向下取整。`
                  : ""}
              全队共享，只扣一次。
            </DialogDescription>
          </DialogHeader>
          {unlock.error && <ActionError error={unlock.error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={unlock.isPending}
              onClick={() => {
                setConfirm(null);
                unlock.reset();
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={unlock.isPending}
              onClick={() => confirm && unlock.mutate(confirm)}
            >
              {unlock.isPending ? "正在解锁" : "确认查看"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
