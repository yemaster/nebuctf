import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "motion/react";
import {
  enqueueSpectatorHighlights,
  type SpectatorHighlight,
  type SpectatorHighlightBatch,
} from "@/lib/spectator-highlights";

const number = new Intl.NumberFormat("zh-CN");
const easing = [0.16, 1, 0.3, 1] as const;

export function SpectatorHighlightOverlay({
  batch,
  enabled,
  reduced,
  container,
}: {
  batch: SpectatorHighlightBatch | null;
  enabled: boolean;
  reduced: boolean;
  container: Element | null;
}) {
  const [queue, setQueue] = useState<SpectatorHighlight[]>([]);
  const consumed = useRef<SpectatorHighlightBatch | null>(null);
  useEffect(() => {
    if (!enabled) {
      consumed.current = batch;
      setQueue([]);
      return;
    }
    if (!batch || consumed.current === batch) return;
    consumed.current = batch;
    setQueue((current) => enqueueSpectatorHighlights(current, batch.items));
  }, [batch, enabled]);
  const active = enabled ? queue[0] : undefined;
  return createPortal(
    <div
      className="pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence initial={false}>
        {active && (
          <m.div
            key={active.id}
            data-spectator-highlight={active.kind}
            className="pointer-events-none fixed inset-0 z-[90] flex select-none items-center justify-center overflow-hidden bg-slate-950/85 px-10 text-center"
            style={{
              color:
                active.kind === "blood"
                  ? "var(--color-amber-200)"
                  : "var(--color-sky-200)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: reduced ? 3.8 : 4.6,
              times: [0, 0.1, 0.78, 1],
              ease: "easeInOut",
            }}
            onAnimationComplete={() =>
              setQueue((current) =>
                current[0]?.id === active.id
                  ? current
                      .slice(1)
                      .filter((item) => Date.now() - item.createdAt < 20000)
                  : current,
              )
            }
          >
            {!reduced && (
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <m.div
                  className="absolute size-[min(78vw,82vh)] rounded-full border border-current"
                  initial={{ scale: 0.35, opacity: 0 }}
                  animate={{ scale: [0.35, 1, 1.18], opacity: [0, 0.32, 0] }}
                  transition={{
                    duration: 1.8,
                    times: [0, 0.2, 1],
                    ease: easing,
                  }}
                />
                <m.div
                  className="absolute h-px w-full bg-current shadow-[0_0_24px_currentColor]"
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: [0, 1, 1], opacity: [0, 0.65, 0] }}
                  transition={{
                    duration: 1.1,
                    times: [0, 0.3, 1],
                    ease: easing,
                  }}
                />
              </div>
            )}
            <m.div
              className="relative w-full max-w-5xl"
              initial={{ y: reduced ? 0 : 18, scale: reduced ? 1 : 0.94 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ duration: reduced ? 0 : 0.65, ease: easing }}
            >
              <p className="text-5xl font-semibold tracking-widest [text-shadow:0_0_48px_currentColor] lg:text-7xl">
                {active.kind === "blood" ? "一血" : "榜首易主"}
              </p>
              <p className="mt-8 break-words text-3xl font-semibold leading-tight text-slate-50 lg:text-5xl">
                {active.teamName}
              </p>
              <p className="mt-4 break-words text-lg leading-relaxed text-slate-300 lg:text-xl">
                {active.kind === "blood" ? (
                  <>
                    {active.challengeTitle}
                    {active.partTitle && (
                      <span className="text-slate-400">
                        {" "}
                        / {active.partTitle}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-mono tabular-nums text-sky-200">
                      {number.format(active.score)}
                    </span>{" "}
                    分
                  </>
                )}
              </p>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>,
    container ?? document.body,
  );
}
