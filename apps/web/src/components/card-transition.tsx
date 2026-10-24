import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { waitForReveal, waitForDetail } from "@/lib/view-transition";

export const loadContestPages = () => import("@/pages/Contests");
export type CardDestination = {
  kind: "contest" | "learning" | "problemset" | "article";
  id: string;
};
export function cardDestination(target: CardDestination) {
  const id = encodeURIComponent(target.id);
  switch (target.kind) {
    case "contest":
      return {
        path: `/contests/${id}`,
        query: `/contests/${id}`,
        load: loadContestPages,
      };
    case "learning":
      return {
        path: `/learning/${id}`,
        query: `/learning/trees/${id}`,
        load: () => import("@/pages/Learning"),
      };
    case "problemset":
      return {
        path: `/problemsets/${id}`,
        query: `/problemsets/${id}?page=1`,
        load: () => import("@/pages/ProblemSets"),
      };
    case "article":
      return {
        path: `/library/${id}`,
        query: `/articles/${id}`,
        load: () => import("@/pages/Learning"),
      };
  }
}
const TransitionContext = createContext<{
  selected: string | null;
  pending: string | null;
  native: boolean;
  loading: boolean;
  prepare: (target: CardDestination) => void;
  open: (target: CardDestination) => void;
}>({
  selected: null,
  pending: null,
  native: false,
  loading: false,
  prepare() {},
  open() {},
});
export const useCardTransition = () => useContext(TransitionContext);

export function CardTransitionProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const [loading, setLoading] = useState(false);
  const active = useRef<{
    controller: AbortController;
    origin: string;
    path: string;
    committed: boolean;
  } | null>(null);
  const currentLocation = useRef(location.key);
  currentLocation.current = location.key;
  const request = useRef(0);
  const transition = useRef<ViewTransition | null>(null);
  useEffect(
    () => () => {
      request.current++;
      active.current?.controller.abort();
      transition.current?.skipTransition();
      document.documentElement.style.removeProperty("--card-source-radius");
    },
    [],
  );

  function clear() {
    document.documentElement.style.removeProperty("--card-source-radius");
    transition.current = null;
    active.current = null;
    setSelected(null);
    setPending(null);
    setNative(false);
    setLoading(false);
  }
  useEffect(() => {
    const run = active.current;
    if (
      run &&
      (run.committed
        ? location.pathname !== run.path
        : location.key !== run.origin)
    ) {
      request.current++;
      run.controller.abort();
      transition.current?.skipTransition();
      clear();
    }
  }, [location.key, location.pathname]);

  function prepare(target: CardDestination) {
    const destination = cardDestination(target);
    void destination.load().catch(() => {});
    void cache.prefetchQuery({
      queryKey: [destination.query],
      queryFn: () => api(destination.query),
      staleTime: 10000,
    });
  }
  async function open(destination: ReturnType<typeof cardDestination>) {
    const path = destination.path,
      ticket = ++request.current,
      origin = currentLocation.current;
    active.current?.controller.abort();
    transition.current?.skipTransition();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!document.startViewTransition || reduced) {
      clear();
      navigate(path);
      return;
    }
    const run = {
      controller: new AbortController(),
      origin,
      path,
      committed: false,
    };
    active.current = run;
    flushSync(() => {
      setSelected(path);
      setNative(true);
      setPending(path);
      setLoading(false);
    });
    const source = document.querySelector<HTMLElement>("a[data-card-surface]");
    if (source)
      document.documentElement.style.setProperty(
        "--card-source-radius",
        getComputedStyle(source).borderRadius,
      );
    try {
      const vt = document.startViewTransition(() => {
        if (ticket !== request.current || origin !== currentLocation.current)
          return;
        run.committed = true;
        // Only commit the opaque shell here. Network, chunks and detail rendering
        // settle independently while the browser animates the captured surface.
        flushSync(() => {
          setPending(null);
          navigate(path);
        });
      });
      transition.current = vt;
      void vt.ready.catch(() => {});
      const ready = Promise.allSettled([
        destination.load(),
        cache.fetchQuery({
          queryKey: [destination.query],
          queryFn: () => api(destination.query),
          staleTime: 10000,
        }),
      ]).then(async (results) => {
        if (results.every((r) => r.status === "fulfilled"))
          await waitForDetail(path, run.controller.signal);
      });
      // The CSS duration includes the full-size hold. Reveal only when both the
      // animation and content are ready; slow requests wait on the expanded page.
      await waitForReveal(vt.finished, ready, run.controller.signal, () => {
        if (ticket === request.current) setLoading(true);
      });
    } catch {
      if (ticket === request.current && currentLocation.current === origin)
        navigate(path);
    } finally {
      if (ticket === request.current) clear();
    }
  }
  return (
    <TransitionContext.Provider
      value={{
        selected,
        pending,
        native,
        loading,
        prepare,
        open: (target) => void open(cardDestination(target)),
      }}
    >
      {children}
    </TransitionContext.Provider>
  );
}
