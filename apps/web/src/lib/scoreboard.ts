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
