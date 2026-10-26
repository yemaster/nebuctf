import { Medal } from "lucide-react";
import type { ChallengeBlood } from "@/lib/types";
import { bloodColors, bloodLabels } from "@/lib/scoreboard";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ChallengeBloods({
  title,
  bloods = [],
}: {
  title: string;
  bloods?: ChallengeBlood[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-1.5 hover:bg-transparent"
          aria-label={`查看 ${title} 三血`}
        >
          {bloodLabels.map((label, i) => (
            <Medal
              key={label}
              className={`size-4 ${bloods.some((b) => b.rank === i + 1) ? bloodColors[i] : "text-muted-foreground/30"}`}
              aria-hidden
            />
          ))}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-4">
        <h3 className="break-words text-sm font-medium">{title}</h3>
        <ol className="space-y-3">
          {bloodLabels.map((label, i) => {
            const b = bloods.find((b) => b.rank === i + 1);
            return (
              <li key={label} className="flex items-center gap-3 text-sm">
                <Medal className={`size-5 shrink-0 ${bloodColors[i]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="min-w-0 break-words font-medium">
                      {b?.name ?? "暂无"}
                    </span>
                  </div>
                  {b && (
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={b.created_at}
                    >
                      {new Date(b.created_at).toLocaleString()}
                    </time>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
