import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Progress } from "./ui/progress";

// Activity feedback, not a measured backend percentage. Only confirmed success reaches 100.
export function OperationProgress({
  busy,
  failed = false,
  label,
  completeLabel = "已完成",
}: {
  busy: boolean;
  failed?: boolean;
  label: string;
  completeLabel?: string;
}) {
  const started = useRef<number | null>(busy ? Date.now() : null);
  const [view, setView] = useState({
    visible: busy,
    value: 6,
    done: false,
    leaving: false,
  });
  useEffect(() => {
    let finish: ReturnType<typeof setTimeout> | undefined;
    let fade: ReturnType<typeof setTimeout> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    if (busy) {
      const fresh = started.current === null;
      started.current ??= Date.now();
      setView((v) => ({
        ...v,
        value: fresh ? 6 : v.value,
        visible: true,
        done: false,
        leaving: false,
      }));
    }
    if (started.current === null) return;
    const advance = () => {
      const elapsed = Date.now() - started.current!;
      setView((v) => ({
        ...v,
        value: 6 + 88 * (1 - 1 / (1 + elapsed / 5500)),
      }));
    };
    const timer = setInterval(advance, 120);
    if (!busy) {
      finish = setTimeout(
        () => {
          clearInterval(timer);
          started.current = null;
          setView((v) => ({
            ...v,
            value: failed ? v.value : 100,
            done: !failed,
            leaving: failed,
          }));
          fade = setTimeout(
            () => setView((v) => ({ ...v, leaving: true })),
            failed ? 0 : 600,
          );
          hide = setTimeout(
            () =>
              setView({
                visible: false,
                value: 6,
                done: false,
                leaving: false,
              }),
            failed ? 250 : 850,
          );
        },
        failed ? 0 : Math.max(0, 500 - (Date.now() - started.current)),
      );
    }
    return () => {
      clearInterval(timer);
      clearTimeout(finish);
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [busy, failed]);
  if (!view.visible) return null;
  return (
    <div
      className={`w-full space-y-3 motion-safe:duration-250 ${view.leaving ? "motion-safe:animate-out motion-safe:fade-out motion-safe:slide-out-to-top-1" : "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"}`}
    >
      <div
        role="status"
        className={`flex items-center gap-2 text-sm ${view.done ? "text-success" : "text-muted-foreground"}`}
      >
        {view.done ? (
          <CheckCircle2 className="size-4 motion-safe:animate-in motion-safe:zoom-in-50" />
        ) : (
          <Loader2 className="size-4 motion-safe:animate-spin" />
        )}
        {view.done ? completeLabel : label}
      </div>
      <Progress
        value={view.value}
        activity={!view.done}
        aria-label={view.done ? completeLabel : label}
        className={`h-1.5 [&_[data-slot=progress-indicator]]:duration-200 [&_[data-slot=progress-indicator]]:ease-linear ${view.done ? "[&_[data-slot=progress-indicator]]:bg-success" : "[&_[data-slot=progress-indicator]]:motion-safe:animate-pulse"}`}
      />
    </div>
  );
}
