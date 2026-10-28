import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence } from "motion/react";
import { TransitionSurface } from "./transition-surface";

const LoadingContext = createContext<(pending: boolean) => void>(() => {});

// The lazy chunk and the page's data hand over the same mounted loading layer.
export function LoadingBoundary({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(true);
  return (
    <LoadingContext.Provider value={setPending}>
      <LoadingTransition pending={pending}>{children}</LoadingTransition>
    </LoadingContext.Provider>
  );
}

export function useLoadingState(pending: boolean) {
  const report = useContext(LoadingContext);
  useLayoutEffect(() => report(pending), [pending, report]);
}

export function LoadingFallback() {
  useLoadingState(true);
  return null;
}

// Short reads skip the skeleton. A visible skeleton gets time to settle before
// its opaque surface fades away, with the ready content already underneath.
export function LoadingTransition({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  const [indicator, setIndicator] = useState(false);
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    if (pending && shownAt.current !== null) return;
    const timer = setTimeout(
      () => {
        shownAt.current = pending ? Date.now() : null;
        setIndicator(pending);
      },
      pending ? 120 : Math.max(0, 240 - (Date.now() - (shownAt.current ?? 0))),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  const waiting = pending || indicator;
  return (
    <div className="relative min-h-[55dvh]" aria-busy={waiting}>
      <div
        className={waiting ? "absolute inset-x-0 top-0" : undefined}
        inert={waiting || undefined}
        aria-hidden={waiting || undefined}
        style={{ visibility: waiting ? "hidden" : undefined }}
      >
        {children}
      </div>
      <AnimatePresence initial={false}>
        {waiting && (
          <TransitionSurface
            key="loading"
            flow
            loading={indicator}
            loadingClassName="min-h-[55dvh]"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
