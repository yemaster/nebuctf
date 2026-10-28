import { m, useIsPresent, useReducedMotion } from "motion/react";
import { Loading } from "./shared";
import { cn } from "@/lib/utils";
import type { SkeletonKind } from "./content-skeleton";

// Keep the same background while the skeleton leaves and the content appears.
// An exiting layer relinquishes its native name before another card can open.
export function TransitionSurface({
  loading,
  card,
  loadingClassName,
  variant,
  flow = false,
}: {
  loading: boolean;
  card?: string;
  loadingClassName?: string;
  variant?: SkeletonKind;
  flow?: boolean;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <m.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
      className={cn(
        "pointer-events-none z-10 overflow-hidden bg-background",
        flow && present ? "relative" : "absolute inset-0",
      )}
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
          className={cn("h-full", loadingClassName)}
        >
          <Loading fullPage variant={variant} immediate />
        </m.div>
      )}
    </m.div>
  );
}
