import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function NavigationIndicator({ activeKey }: { activeKey: string }) {
  const indicator = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    x: number;
    visible: boolean;
    animate: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const root = indicator.current?.parentElement;
    if (!root) return;
    const current = root.querySelector<HTMLElement>("[data-nav-active=true]");
    const update = () => {
      const bounds = current?.getBoundingClientRect();
      const visible = !!bounds?.width;
      setPosition((previous) => {
        const x = visible
          ? bounds.left - root.getBoundingClientRect().left + bounds.width / 2
          : (previous?.x ?? 0);
        if (!visible && !previous) return null;
        if (previous?.x === x && previous.visible === visible) return previous;
        return { x, visible, animate: !!previous };
      });
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(root);
    if (current) observer?.observe(current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeKey]);

  return (
    <span
      ref={indicator}
      aria-hidden="true"
      data-slot="navigation-indicator"
      className={cn(
        "pointer-events-none absolute bottom-0 left-0 -ml-3 h-0.5 w-6 rounded-full bg-primary",
        position?.animate &&
          "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{
        transform: `translateX(${position?.x ?? 0}px)`,
        opacity: position?.visible ? 1 : 0,
      }}
    />
  );
}
