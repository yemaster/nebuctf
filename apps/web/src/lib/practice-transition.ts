import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { waitForReveal, waitForDetail } from "./view-transition";

export function usePracticeTransition(
  selected: string | null,
  select: (id: string | null) => void,
) {
  const cache = useQueryClient();
  const [view, setView] = useState<{
    phase:
      | "idle"
      | "source"
      | "shrinking"
      | "loading"
      | "return-source"
      | "returning";
    id: string | null;
  }>({ phase: "idle", id: null });
  const active = useRef<{
    id: string | null;
    origin: string | null;
    committed: boolean;
    controller: AbortController;
    transition?: ViewTransition;
  } | null>(null);
  const clear = () => {
    active.current = null;
    setView({ phase: "idle", id: null });
  };
  useEffect(() => {
    const run = active.current;
    if (
      run &&
      (run.committed ? selected !== run.id : selected !== run.origin)
    ) {
      run.controller.abort();
      run.transition?.skipTransition();
      clear();
    }
  }, [selected]);
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current?.transition?.skipTransition();
      active.current = null;
    },
    [],
  );
  async function enter(id: string | null) {
    active.current?.controller.abort();
    active.current?.transition?.skipTransition();
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      clear();
      select(id);
      return;
    }
    const run: NonNullable<typeof active.current> = {
      id,
      origin: selected,
      committed: false,
      controller: new AbortController(),
    };
    active.current = run;
    flushSync(() => setView({ phase: id ? "source" : "return-source", id }));
    try {
      const vt = document.startViewTransition(() => {
        if (active.current !== run) return;
        run.committed = true;
        flushSync(() => {
          // Router updates can be concurrent. Commit the destination directory
          // now so the native snapshot never captures the hidden old workspace.
          setView({ phase: id ? "shrinking" : "returning", id });
          select(id);
        });
      });
      run.transition = vt;
      void vt.ready.catch(() => {});
      if (!id) {
        await waitForReveal(
          vt.finished,
          Promise.resolve(),
          run.controller.signal,
          () => {},
        );
        return;
      }
      const ready = cache
        .fetchQuery({
          queryKey: [`/challenges/${id}?scope=practice`],
          queryFn: () => api(`/challenges/${id}?scope=practice`),
          staleTime: 10000,
        })
        .then(
          () => waitForDetail(`practice:${id}`, run.controller.signal),
          () => {},
        );
      await waitForReveal(vt.finished, ready, run.controller.signal, () => {
        if (active.current === run) setView({ phase: "loading", id });
      });
    } catch {
      if (active.current === run && !run.committed) select(id);
    } finally {
      if (active.current === run) clear();
    }
  }
  return {
    phase: view.phase,
    selected:
      view.phase === "shrinking" ||
      view.phase === "loading" ||
      view.phase === "returning"
        ? view.id
        : selected,
    enter: (id: string) => void enter(id),
    returnToList: () => void enter(null),
  };
}
