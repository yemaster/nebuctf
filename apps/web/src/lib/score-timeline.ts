export type TimeRange = [number, number];
export type TimelineRow = { time: number } & Record<string, number>;

// Resolve an arbitrary instant to the last earned score, never the nearest future gain.
export function timelineAt(
  data: TimelineRow[],
  time: number,
): TimelineRow | null {
  if (
    !data.length ||
    !Number.isFinite(time) ||
    time < data[0]!.time ||
    time > data.at(-1)!.time
  )
    return null;
  let low = 0,
    high = data.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (data[middle]!.time <= time) low = middle;
    else high = middle - 1;
  }
  return { ...data[low]!, time };
}

// Keep the score already earned before a zoom boundary. Never interpolate gains.
export function timelineWindow(data: TimelineRow[], [from, to]: TimeRange) {
  if (!data.length || !Number.isFinite(from + to) || to <= from) return [];
  let start = data[0]!,
    end = data[0]!;
  const middle: TimelineRow[] = [];
  for (const point of data) {
    if (point.time <= from) start = point;
    if (point.time <= to) end = point;
    if (point.time > from && point.time < to) middle.push(point);
  }
  return [{ ...start, time: from }, ...middle, { ...end, time: to }];
}

export function timelineActivityRange(data: TimelineRow[]): TimeRange | null {
  if (data.length < 2) return null;
  const changes = data.filter(
    (point, index) =>
      index > 0 &&
      Object.keys(point).some(
        (key) => key !== "time" && point[key] !== data[index - 1]![key],
      ),
  );
  if (!changes.length) return null;
  const first = changes[0]!.time,
    last = changes.at(-1)!.time;
  const padding = Math.max(60_000, (last - first) * 0.08);
  return [
    Math.max(data[0]!.time, first - padding),
    Math.min(data.at(-1)!.time, last + padding),
  ];
}

export function timelineTicks([from, to]: TimeRange, count: number) {
  if (!Number.isFinite(from + to) || to <= from) return [];
  const interval = (to - from) / Math.max(2, count - 1);
  const steps = [
    1_000, 5_000, 15_000, 30_000, 60_000, 300_000, 900_000, 1_800_000,
    3_600_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000, 172_800_000,
    604_800_000, 2_592_000_000,
  ];
  const step = steps.find((value) => value >= interval) ?? interval;
  const ticks = [from];
  for (let time = Math.ceil(from / step) * step; time < to; time += step) {
    if (time - from >= step / 3 && to - time >= step / 3) ticks.push(time);
  }
  return [...ticks, to];
}

// Preserve colors when rankings change; an incoming team uses a vacated slot.
export function timelineColors(
  ids: string[],
  previous: Readonly<Record<string, number>>,
) {
  const colors: Record<string, number> = {};
  const used = new Set<number>();
  for (const id of ids) {
    const color = previous[id];
    if (color !== undefined) {
      colors[id] = color;
      used.add(color);
    }
  }
  for (const id of ids) {
    if (colors[id] !== undefined) continue;
    const color = [0, 1, 2, 3, 4].find((value) => !used.has(value)) ?? 0;
    colors[id] = color;
    used.add(color);
  }
  return colors;
}
