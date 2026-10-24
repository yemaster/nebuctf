import { m, useIsPresent, useReducedMotion } from "motion/react";
import { Loading } from "./shared";

// Keep the same background while the spinner leaves and the content appears.
// An exiting layer relinquishes its native name before another card can open.
export function TransitionSurface({
  loading,
  card,
}: {
  loading: boolean;
  card?: string;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <m.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
      className="pointer-events-none absolute inset-0 z-10 bg-background"
      data-loading-surface={present ? "waiting" : "leaving"}
      data-card-surface={present ? card : undefined}
      aria-hidden={!present || undefined}
      style={{
        viewTransitionName: present && card ? "card-surface" : undefined,
      }}
    >
      {loading && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.12, ease: "easeOut" }}
          className="h-full"
        >
          <Loading fullPage />
        </m.div>
      )}
    </m.div>
  );
}
