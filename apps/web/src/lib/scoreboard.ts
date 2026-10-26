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
// GZCTF SubmissionTypeColorMap with its custom gray palette and Mantine colors.
export const bloodColors = [
  "text-[#fcc419]",
  "text-[#a6a6a6] dark:text-[#cacaca]",
  "text-[#f98539] dark:text-[#b94d05]",
];

// Keep category hues subtle against the table surface in both themes.
export const categoryTextColors: Record<string, string> = {
  Web: "text-blue-950/70 dark:text-blue-100/75",
  Pwn: "text-red-950/70 dark:text-red-100/75",
  Reverse: "text-yellow-950/70 dark:text-yellow-100/75",
  Crypto: "text-violet-950/70 dark:text-violet-100/75",
  Misc: "text-teal-950/70 dark:text-teal-100/75",
  Forensics: "text-indigo-950/70 dark:text-indigo-100/75",
};
export const categoryHeaderColors: Record<string, string> = {
  Web: `bg-blue-500/10 dark:bg-blue-400/10 ${categoryTextColors.Web}`,
  Pwn: `bg-red-500/10 dark:bg-red-400/10 ${categoryTextColors.Pwn}`,
  Reverse: `bg-yellow-500/10 dark:bg-yellow-400/10 ${categoryTextColors.Reverse}`,
  Crypto: `bg-violet-500/10 dark:bg-violet-400/10 ${categoryTextColors.Crypto}`,
  Misc: `bg-teal-500/10 dark:bg-teal-400/10 ${categoryTextColors.Misc}`,
  Forensics: `bg-indigo-500/10 dark:bg-indigo-400/10 ${categoryTextColors.Forensics}`,
};
