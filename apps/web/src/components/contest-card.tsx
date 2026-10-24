import { DetailLink } from "./detail-link";
import { ArrowRight, Loader2 } from "lucide-react";
import type { Contest } from "@/lib/types";
import { date } from "@/lib/utils";
import { ContestStatusBadge } from "./contest-status-badge";
import { Card, CardContent } from "./ui/card";
import { ContestPoster } from "./contest-poster";
import { useCardTransition } from "./card-transition";

export function ContestCard({ contest: c }: { contest: Contest }) {
  const transition = useCardTransition();
  const pending = transition.pending === `/contests/${c.id}`;
  return (
    <DetailLink
      destination={{ kind: "contest", id: c.id }}
      className="group block overflow-hidden rounded-xl bg-card shadow-sm motion-safe:transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring dark:shadow-black/20"
    >
      <Card className="h-full gap-0 overflow-hidden border-0 py-0 shadow-none transition-colors group-hover:bg-muted">
        <div className="relative">
          <ContestPoster contest={c} className="h-44" />
          <ContestStatusBadge
            contest={c}
            className="absolute top-3 right-3 shadow-sm"
          />
          {pending && (
            <span className="absolute top-3 left-3 rounded-md bg-card/95 p-1.5 animate-in fade-in duration-150 delay-200 [animation-fill-mode:both]">
              <Loader2
                className="size-4 motion-safe:animate-spin"
                aria-label="正在打开比赛"
              />
            </span>
          )}
        </div>
        <CardContent className="space-y-3 p-4">
          <h2 className="line-clamp-2 text-lg font-semibold leading-6">
            {c.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={c.starts_at}>{date(c.starts_at)}</time>
            <ArrowRight className="size-3 shrink-0" aria-label="至" />
            <time dateTime={c.ends_at}>{date(c.ends_at)}</time>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{c.teams} 支战队</span>
            <span>{c.team_limit} 人制</span>
          </div>
        </CardContent>
      </Card>
    </DetailLink>
  );
}
