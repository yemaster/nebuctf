export type CalendarContest = { id: string; title: string };
export type ContestCalendarDay = {
  day: string;
  count: number;
  contests?: CalendarContest[];
};
// GZCTF uses Mantine shade 4 in light timelines and shade 9 in dark timelines.
// Reuse its cool color families; custom gray stays visible on either surface.
// Source: GZTimeWalker/GZCTF, ClientApp/src/pages/games/Index.tsx (7e61deef).
const colors = [
  "bg-[#4dabf7] dark:bg-[#1864ab]",
  "bg-[#9775fa] dark:bg-[#5f3dc4]",
  "bg-[#38d9a9] dark:bg-[#087f5b]",
  "bg-[#748ffc] dark:bg-[#364fc7]",
  "bg-[#da77f2] dark:bg-[#862e9c]",
  "bg-[#7a7a7a] dark:bg-[#b3b3b3]",
];
export const calendarDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function contestCalendarRange(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  // Match the Monday–Sunday grid, including its visible adjacent-month dates.
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  last.setDate(last.getDate() + 6 - ((last.getDay() + 6) % 7));
  return { from: calendarDayKey(first), to: calendarDayKey(last) };
}

type Lane = (CalendarContest & { color: string }) | null;
export type CalendarBar = Exclude<Lane, null> & {
  lane: number;
  length: number;
  starts: boolean;
  ends: boolean;
};
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86400000;
const keyAt = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export function layoutContestCalendar(input: ContestCalendarDay[]) {
  const days = new Map<string, { count: number; lanes: Lane[] }>();
  const bars = new Map<string, CalendarBar[]>();
  const palette = new Map<string, string>();
  for (const entry of [...input].sort((a, b) => a.day.localeCompare(b.day))) {
    const contests = [
      ...new Map((entry.contests ?? []).map((c) => [c.id, c])).values(),
    ].slice(0, 3);
    const previous = days.get(keyAt(dayNumber(entry.day) - 1));
    // Keep continuing contests in their lane even after another one ends.
    const lanes: Lane[] = [null, null, null];
    previous?.lanes.forEach((c, lane) => {
      if (c && contests.some((next) => next.id === c.id)) lanes[lane] = c;
    });
    for (const c of contests) {
      if (lanes.some((current) => current?.id === c.id)) continue;
      const used = new Set(lanes.map((current) => current?.color));
      const hash = Array.from(c.id).reduce(
        (n, v) => (n * 31 + v.charCodeAt(0)) >>> 0,
        0,
      );
      const candidates = colors.map(
        (_, n) => colors[(hash + n) % colors.length]!,
      );
      const color =
        palette.get(c.id) ??
        candidates.find((value) => !used.has(value)) ??
        candidates[0]!;
      palette.set(c.id, color);
      lanes[lanes.indexOf(null)] = { ...c, color };
    }
    days.set(entry.day, { count: entry.count, lanes });
  }
  for (const [key, { lanes }] of days) {
    const n = dayNumber(key);
    const column = (new Date(n * 86400000).getUTCDay() + 6) % 7;
    const segments: CalendarBar[] = [];
    lanes.forEach((c, lane) => {
      if (!c) return;
      const starts = days.get(keyAt(n - 1))?.lanes[lane]?.id !== c.id;
      if (!starts && column !== 0) return;
      let length = 1;
      while (
        column + length < 7 &&
        days.get(keyAt(n + length))?.lanes[lane]?.id === c.id
      )
        length++;
      segments.push({
        ...c,
        lane,
        length,
        starts,
        ends: days.get(keyAt(n + length))?.lanes[lane]?.id !== c.id,
      });
    });
    if (segments.length) bars.set(key, segments);
  }
  return { days, bars };
}
