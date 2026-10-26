import { useRef, useState } from "react";
import { BloodMark } from "./blood-mark";
import type { ChallengeBlood } from "@/lib/types";
import { bloodLabels } from "@/lib/scoreboard";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

export function ChallengeBloods({
  title,
  bloods = [],
}: {
  title: string;
  bloods?: ChallengeBlood[];
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const touch = useRef(false);
  return (
    <TooltipProvider>
      <span
        className="inline-flex shrink-0 items-center gap-0.5"
        role="group"
        aria-label={`${title} 三血`}
      >
        {bloodLabels.map((label, index) => {
          const blood = bloods.find((b) => b.rank === index + 1);
          return (
            <Tooltip
              key={label}
              delayDuration={120}
              open={opened === index}
              onOpenChange={(open) =>
                setOpened((old) => (open ? index : old === index ? null : old))
              }
            >
              <TooltipTrigger asChild>
                <Button
                  onPointerDown={(event) => {
                    touch.current = event.pointerType === "touch";
                  }}
                  onClick={(event) => {
                    if (touch.current) {
                      event.preventDefault();
                      setOpened((old) => (old === index ? null : index));
                    }
                  }}
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 shrink-0 rounded-sm p-0 hover:bg-transparent dark:hover:bg-transparent"
                  aria-label={`${title} ${label}：${blood?.name ?? "暂无"}`}
                >
                  <BloodMark
                    rank={index + 1}
                    muted={!blood}
                    className="size-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="max-w-64 space-y-1 text-left"
              >
                <p className="break-words font-medium">
                  {label} {blood?.name ?? "暂无"}
                </p>
                {blood && (
                  <time
                    dateTime={blood.created_at}
                    className="block tabular-nums opacity-80"
                  >
                    {new Date(blood.created_at).toLocaleString()}
                  </time>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </span>
    </TooltipProvider>
  );
}
