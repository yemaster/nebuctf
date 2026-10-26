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

// Match GZCTF's category hues using the platform's light/dark palette tokens.
export const categoryHeaderColors: Record<string, string> = {
  Web: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  Pwn: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  Reverse:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  Crypto:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  Misc: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  Forensics:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
};
