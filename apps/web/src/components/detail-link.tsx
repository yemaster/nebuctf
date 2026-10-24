import { cn } from "@/lib/utils";
import { Link, type LinkProps } from "react-router-dom";
import {
  cardDestination,
  useCardTransition,
  type CardDestination,
} from "./card-transition";

// A single focusable link covers the entire card/row. Modified clicks retain
// normal browser semantics; only an ordinary activation starts the expansion.
export function DetailLink({
  destination,
  children,
  ...props
}: Omit<LinkProps, "to"> & { destination: CardDestination }) {
  const transition = useCardTransition(),
    path = cardDestination(destination).path;
  const selected = transition.selected === path && transition.pending === path,
    pending = transition.pending === path;
  return (
    <Link
      {...props}
      to={path}
      className={cn(props.className, "aria-busy:cursor-progress")}
      onPointerEnter={(event) => {
        props.onPointerEnter?.(event);
        transition.prepare(destination);
      }}
      onFocus={(event) => {
        props.onFocus?.(event);
        transition.prepare(destination);
      }}
      onClick={(event) => {
        props.onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target === "_blank"
        )
          return;
        event.preventDefault();
        if (!pending) transition.open(destination);
      }}
      aria-busy={pending || undefined}
      data-card-surface={selected ? path : undefined}
      style={{
        ...props.style,
        viewTransitionName: selected ? "card-surface" : undefined,
      }}
    >
      {children}
    </Link>
  );
}
