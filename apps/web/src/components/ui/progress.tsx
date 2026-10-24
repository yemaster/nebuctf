"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";

function Progress({
  className,
  value,
  activity = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  activity?: boolean;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={activity ? null : value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-primary transition-all",
          value == null ? "w-1/3 motion-safe:animate-pulse" : "w-full",
        )}
        style={
          value == null
            ? undefined
            : { transform: `translateX(-${100 - value}%)` }
        }
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
