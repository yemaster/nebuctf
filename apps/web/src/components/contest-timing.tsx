import { useEffect, useState } from "react";
import { Clock, Play } from "lucide-react";
import { api, useAPI, useAction } from "@/lib/api";
import type { Phase } from "@/lib/competition";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ActionError } from "./action-error";
import { QueryState } from "./shared";
import { ContestClockSummary } from "./contest-clock";
import type { ContestClock } from "@/lib/contest-clock";
export function ContestTiming({ id }: { id: string }) {
  const query = useAPI<{ phases: Phase[]; clock?: ContestClock }>(
    `/contests/${id}/timing`,
    true,
    15000,
  );
  return (
    <>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {query.data?.clock && (
        <ContestClockSummary
          compact
          clock={query.data.clock}
          receivedAt={query.dataUpdatedAt}
        />
      )}
      {query.data && <PhaseCards scope={id} phases={query.data.phases} />}
    </>
  );
}
export function PhaseCards({
  scope,
  phases,
  compact = false,
}: {
  scope: string;
  phases: Phase[];
  compact?: boolean;
}) {
  const [now, setNow] = useState(Date.now()),
    [start, setStart] = useState<Phase | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const action = useAction(
    async () => {
      if (start)
        await api(`/contests/${scope}/start/${start.section}`, "POST", {});
    },
    () => setStart(null),
    false,
  );
  const relevant = phases.filter((p) => p.mode !== "inherit");
  if (!relevant.length) return null;
  return (
    <section
      aria-label="作答时间"
      className={compact ? "grid gap-4" : "grid w-full gap-5 md:grid-cols-2"}
    >
      {relevant.map((p) => {
        const end = Date.parse(p.deadline_at ?? p.closes_at!),
          remaining = Math.max(0, Math.ceil((end - now) / 1000)),
          finished = !remaining || p.status === "ended",
          active = p.status === "active" && !finished,
          title = p.section === "objective" ? "客观题" : "实操题";
        return (
          <div
            key={p.section}
            className={
              compact
                ? "space-y-2 text-sm"
                : "space-y-4 rounded-xl bg-card p-6 shadow-sm"
            }
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-medium">{title}</h3>
              <span className="text-xs text-muted-foreground">
                {finished
                  ? "已结束"
                  : active
                    ? "作答中"
                    : p.status === "ready"
                      ? "尚未开始"
                      : "等待开放"}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="size-4 text-muted-foreground" />
                {active
                  ? `${Math.floor(remaining / 3600)
                      .toString()
                      .padStart(2, "0")}:${Math.floor((remaining % 3600) / 60)
                      .toString()
                      .padStart(
                        2,
                        "0",
                      )}:${(remaining % 60).toString().padStart(2, "0")}`
                  : p.mode === "flexible"
                    ? `${(p.duration_seconds ?? 0) / 60} 分钟`
                    : new Date(p.opens_at!).toLocaleString()}
              </div>
              {p.status === "ready" && !finished && (
                <Button size="sm" onClick={() => setStart(p)}>
                  <Play />
                  开始{title}
                </Button>
              )}
            </div>
            {active && (
              <Progress
                aria-label={`${title}剩余时间`}
                value={Math.min(
                  100,
                  ((remaining * 1000) / (end - Date.parse(p.started_at!))) *
                    100,
                )}
              />
            )}
            {!compact && (
              <p className="text-xs text-muted-foreground">
                截止 {new Date(p.closes_at!).toLocaleString()}
              </p>
            )}
          </div>
        );
      })}
      <Dialog open={!!start} onOpenChange={(open) => !open && setStart(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              开始{start?.section === "objective" ? "客观题" : "实操题"}作答
            </DialogTitle>
            <DialogDescription>
              全队共享 {(start?.duration_seconds ?? 0) / 60}{" "}
              分钟作答时间。开始后持续计时，最晚于有效期结束时截止。
            </DialogDescription>
          </DialogHeader>
          {action.error && <ActionError error={action.error} />}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setStart(null)}>
              稍后开始
            </Button>
            <Button disabled={action.isPending} onClick={() => action.mutate()}>
              确认开始
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
