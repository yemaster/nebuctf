import Mdi from "@mdi/react";
import { mdiHexagonSlice6, mdiHexagonSlice4, mdiHexagonSlice2 } from "@mdi/js";
import { bloodColors } from "@/lib/scoreboard";
import { cn } from "@/lib/utils";

// MDI's CommonJS default is a namespace in Node and a component in Vite.
const Icon = ("Icon" in Mdi ? Mdi.Icon : Mdi) as typeof Mdi;
const paths = [mdiHexagonSlice6, mdiHexagonSlice4, mdiHexagonSlice2];

export function BloodMark({
  rank,
  muted = false,
  className,
}: {
  rank: number;
  muted?: boolean;
  className?: string;
}) {
  const path = paths[rank - 1];
  if (!path) return null;
  return (
    <Icon
      path={path}
      color="currentColor"
      aria-hidden="true"
      className={cn(
        "size-6 shrink-0",
        muted ? "text-muted-foreground/30" : bloodColors[rank - 1],
        className,
      )}
    />
  );
}
