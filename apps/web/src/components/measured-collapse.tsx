import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";

// Measure the inner flow, not the animated wrapper. A late response can change
// its height while an open/close animation is running without snapping the row.
export function MeasuredCollapse({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null),
    [height, setHeight] = useState(0),
    reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = inner.current!;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <m.div
      initial={false}
      animate={{ height: open ? height : 0 }}
      transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-expanded={open}
    >
      <div ref={inner}>{children}</div>
    </m.div>
  );
}
