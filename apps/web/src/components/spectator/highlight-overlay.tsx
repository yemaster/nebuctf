import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "motion/react";
import {
  enqueueSpectatorHighlights,
  type SpectatorHighlight,
  type SpectatorHighlightBatch,
} from "@/lib/spectator-highlights";

const number = new Intl.NumberFormat("zh-CN");
const easing = [0.16, 1, 0.3, 1] as const;

// Clipped line reveals follow Motion's text animation guide. Padding preserves
// descenders and Chinese glyphs while the line moves through the mask.
function Reveal({
  children,
  reduced,
  delay = 0,
}: {
  children: ReactNode;
  reduced: boolean;
  delay?: number;
}) {
  return (
    <div className="-my-[0.15em] overflow-hidden py-[0.15em]">
      <m.div
        initial={{ y: reduced ? 0 : "115%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{
          duration: reduced ? 0.18 : 0.55,
          delay: reduced ? 0 : delay,
          ease: easing,
        }}
      >
        {children}
      </m.div>
    </div>
  );
}

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
            className="pointer-events-none fixed inset-0 z-[90] flex select-none items-center justify-center overflow-hidden bg-slate-950/75"
            style={{
              color:
                active.kind === "blood"
                  ? "var(--color-amber-200)"
                  : "var(--color-sky-200)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: reduced ? 3.8 : 4.8,
              times: [0, 0.07, 0.81, 1],
              ease: ["easeOut", "linear", "easeInOut"],
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
              <m.div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[44vw] bg-current opacity-15"
                initial={{ x: "-65vw", skewX: -16 }}
                animate={{ x: "135vw", skewX: -16 }}
                transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
              />
            )}
            <div className="relative w-full">
              <m.div
                className="absolute inset-0 origin-left bg-slate-950/65"
                initial={{ scaleX: reduced ? 1 : 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: reduced ? 0.18 : 0.45, ease: easing }}
              />
              <div className="relative mx-auto flex w-fit max-w-[min(1120px,calc(100%-80px))] flex-col items-center gap-8 py-16 text-center md:flex-row md:gap-16 md:text-left lg:py-20">
                <div className="shrink-0 text-center md:w-60">
                  <Reveal reduced={reduced} delay={0.12}>
                    {active.kind === "blood" ? (
                      <p className="text-7xl font-bold leading-tight tracking-tight lg:text-8xl">
                        一血
                      </p>
                    ) : (
                      <div>
                        <p
                          aria-hidden="true"
                          className="font-mono text-8xl font-semibold leading-none tracking-tighter lg:text-[128px]"
                        >
                          #1
                        </p>
                        <p className="mt-3 text-xl font-medium">榜首易主</p>
                      </div>
                    )}
                  </Reveal>
                </div>
                <div className="min-w-0">
                  <Reveal reduced={reduced} delay={0.24}>
                    <p
                      data-highlight-team
                      className={`font-semibold leading-[1.12] tracking-tight text-slate-50 [overflow-wrap:anywhere] ${Array.from(active.teamName).length > 32 ? "text-4xl lg:text-5xl" : "text-5xl lg:text-7xl"}`}
                    >
                      {active.teamName}
                    </p>
                  </Reveal>
                  <div className="mt-5">
                    <Reveal reduced={reduced} delay={0.38}>
                      <p className="text-lg leading-relaxed text-slate-300 [overflow-wrap:anywhere] lg:text-2xl">
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
                            <span className="font-mono text-3xl tabular-nums text-sky-200">
                              {number.format(active.score)}
                            </span>
                            <span className="ml-2 text-lg">分</span>
                          </>
                        )}
                      </p>
                    </Reveal>
                  </div>
                </div>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>,
    container ?? document.body,
  );
}
