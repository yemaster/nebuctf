import type { ScoreTimeline } from "./types";

// Merge step series on a shared time axis; carry each team's last known score
// instead of connecting missing samples with a misleading diagonal line.
export function scoreTimelineRows(
  series: ScoreTimeline[],
  start: string,
  cutoff: string,
) {
  const first = Date.parse(start),
    last = Math.max(first, Date.parse(cutoff));
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const changes = new Map<number, Record<string, number>>([
    [first, {}],
    [last, {}],
  ]);
  series.forEach((team, index) => {
    for (const point of team.points) {
      const time = Date.parse(point.time);
      if (!Number.isFinite(time) || time < first || time > last) continue;
      changes.set(time, {
        ...changes.get(time),
        [`team${index}`]: point.score,
      });
    }
    changes.set(last, { ...changes.get(last), [`team${index}`]: team.score });
  });
  let scores: Record<string, number> = Object.fromEntries(
    series.map((_, i) => [`team${i}`, 0]),
  );
  return [...changes]
    .sort(([a], [b]) => a - b)
    .map(([time, values]) => {
      scores = { ...scores, ...values };
      return { time, ...scores };
    });
}

export const bloodLabels = ["一血", "二血", "三血"];
export const bloodColors = [
  "text-amber-600 dark:text-amber-400",
  "text-slate-500 dark:text-slate-300",
  "text-orange-700 dark:text-orange-400",
];

// Keep category hues subtle against the table surface in both themes.
export const categoryHeaderColors: Record<string, string> = {
  Web: "bg-blue-500/10 text-blue-950/70 dark:bg-blue-400/10 dark:text-blue-100/75",
  Pwn: "bg-red-500/10 text-red-950/70 dark:bg-red-400/10 dark:text-red-100/75",
  Reverse:
    "bg-yellow-500/10 text-yellow-950/70 dark:bg-yellow-400/10 dark:text-yellow-100/75",
  Crypto:
    "bg-violet-500/10 text-violet-950/70 dark:bg-violet-400/10 dark:text-violet-100/75",
  Misc: "bg-teal-500/10 text-teal-950/70 dark:bg-teal-400/10 dark:text-teal-100/75",
  Forensics:
    "bg-indigo-500/10 text-indigo-950/70 dark:bg-indigo-400/10 dark:text-indigo-100/75",
};
