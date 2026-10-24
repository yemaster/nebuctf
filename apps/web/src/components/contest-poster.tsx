import { cn } from "@/lib/utils";
import type { Contest } from "@/lib/types";
export function ContestPoster({
  contest,
  priority = false,
  className,
}: {
  contest: Contest;
  priority?: boolean;
  className?: string;
}) {
  return (
    <img
      src={
        contest.poster_id
          ? `/api/contests/${contest.id}/poster?v=${contest.poster_id}`
          : "/images/contest-lab.jpg"
      }
      alt=""
      className={cn("aspect-video w-full object-cover", className)}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
