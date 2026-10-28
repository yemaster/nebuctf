export type SpectatorTeam = {
  id: string;
  name: string;
  rank: number;
  score: number;
  solves: number;
  group_name: string | null;
};
export type SpectatorEvent = {
  id: string;
  type: "solve" | "attack" | "release" | "withdraw" | "hint";
  team_id: string | null;
  team_name: string | null;
  target_team_id?: string;
  target_team_name?: string;
  challenge_id: string;
  challenge_title: string;
  part_title: string | null;
  blood_rank: number | null;
  created_at: string;
};
export type SpectatorEngagement = {
  challenge_id: string;
  challenge_title: string;
  last_seen: string;
  teams: { id: string; name: string; last_seen: string }[];
};
export type SpectatorData = {
  clock?: import("./contest-clock").ContestClock;
  engagements?: SpectatorEngagement[];
  contest: { id: string; title: string; starts_at: string; ends_at: string };
  started: boolean;
  frozen: boolean;
  cutoff: string;
  stats: { teams: number; challenges: number; solves: number; attacks: number };
  leaders: SpectatorTeam[];
  challenges: {
    id: string;
    challenge_id: string;
    title: string;
    part_title: string | null;
    category: string;
    solves: number;
    points?: number;
    challenge_solves?: number;
  }[];
  events: SpectatorEvent[];
  groups: { id: string; name: string }[];
};

export function eventLabel(event: SpectatorEvent) {
  if (event.type === "attack") return "攻击成功";
  if (event.type === "solve")
    return event.blood_rank
      ? (["", "一血", "二血", "三血"][event.blood_rank] ?? "解出")
      : "解出";
  return { release: "题目上线", withdraw: "题目下线", hint: "新增提示" }[
    event.type
  ];
}

// The initial snapshot and reconnection history seed the list, never a fake live attack.
export class SpectatorEvents {
  private seen = new Set<string>();
  private initialized = false;
  ingest(events: SpectatorEvent[], live: boolean, now = Date.now()) {
    const fresh =
      this.initialized && live
        ? events.filter(
            (e) =>
              !this.seen.has(e.id) &&
              now - Date.parse(e.created_at) < 20000 &&
              Date.parse(e.created_at) <= now + 5000,
          )
        : [];
    this.initialized = true;
    for (const event of events) this.seen.add(event.id);
    if (this.seen.size > 400) this.seen = new Set([...this.seen].slice(-200));
    return fresh.slice(0, 12);
  }
}

// One facility per challenge, including questions with several flags. A fixed
// street grid keeps ranking/solve updates from moving the city underneath viewers.
export function cityHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
type CityRect = { col: number; row: number; width: number; depth: number };
export type CityDistrict = CityRect & {
  category: string;
  grid: number;
  count: number;
  x: number;
  z: number;
};
const categoryOrder = ["Web", "Pwn", "Reverse", "Crypto", "Misc", "Forensics"];
export function cityPosition(col: number, row: number, grid = 16) {
  if (grid === 16)
    return {
      x: (Math.floor(col / 2) - 3.5) * 12 + (col % 2 ? 2.7 : -2.7),
      z: (Math.floor(row / 2) - 3.5) * 12 + (row % 2 ? 2.7 : -2.7),
    };
  return {
    x: ((col + 0.5 - grid / 2) * 96) / grid,
    z: ((row + 0.5 - grid / 2) * 96) / grid,
  };
}
export function cityLayout(challenges: SpectatorData["challenges"]) {
  const unique = new Map<
    string,
    {
      id: string;
      title: string;
      category: string;
      solves: number;
      points: number;
    }
  >();
  const units = new Set<string>();
  for (const c of challenges) {
    if (units.has(c.id)) continue;
    units.add(c.id);
    const previous = unique.get(c.challenge_id);
    if (previous) previous.points += c.points ?? 0;
    else
      unique.set(c.challenge_id, {
        id: c.challenge_id,
        title: c.title,
        category:
          categoryOrder.find(
            (category) => category.toLowerCase() === c.category.toLowerCase(),
          ) ??
          (c.category || "Misc"),
        solves: c.challenge_solves ?? (c.part_title ? 0 : c.solves),
        points: c.points ?? 0,
      });
  }
  const questions = [...unique.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 256);
  const groups = [...new Set(questions.map((c) => c.category))]
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a),
        bi = categoryOrder.indexOf(b);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.localeCompare(b);
    })
    .map((category) => ({
      category,
      items: questions.filter((c) => c.category === category),
    }));
  // Weighted rectangular districts keep related facilities together. Try exact
  // street blocks first; the larger grid handles unusually uneven 256-item feeds.
  const partition = (
    entries: typeof groups,
    rect: CityRect,
  ): (CityRect & (typeof groups)[number])[] | null => {
    if (!entries.length) return [];
    if (entries.length === 1)
      return entries[0]!.items.length <= rect.width * rect.depth
        ? [{ ...rect, ...entries[0]! }]
        : null;
    const total = entries.reduce((n, g) => n + g.items.length, 0),
      choices: {
        i: number;
        axis: "width" | "depth";
        cut: number;
        cost: number;
      }[] = [];
    for (let i = 1; i < entries.length; i++) {
      const left = entries.slice(0, i).reduce((n, g) => n + g.items.length, 0);
      for (const axis of ["width", "depth"] as const) {
        const side = rect[axis],
          other = axis === "width" ? rect.depth : rect.width;
        for (let cut = 1; cut < side; cut++)
          if (cut * other >= left && (side - cut) * other >= total - left)
            choices.push({
              i,
              axis,
              cut,
              cost:
                Math.abs(cut / side - left / total) + (side < other ? 0.2 : 0),
            });
      }
    }
    choices.sort((a, b) => a.cost - b.cost);
    for (const { i, axis, cut } of choices) {
      const first = { ...rect, [axis]: cut },
        second = {
          ...rect,
          [axis]: rect[axis] - cut,
          [axis === "width" ? "col" : "row"]:
            rect[axis === "width" ? "col" : "row"] + cut,
        };
      const left = partition(entries.slice(0, i), first);
      if (!left) continue;
      const right = partition(entries.slice(i), second);
      if (right) return [...left, ...right];
    }
    return null;
  };
  let grid = 16,
    regions = partition(groups, { col: 0, row: 0, width: 16, depth: 16 });
  if (!regions) {
    grid = 20;
    regions = partition(groups, { col: 0, row: 0, width: 20, depth: 20 });
  }
  const districts: CityDistrict[] = [];
  const facilities = (regions ?? []).flatMap((region) => {
    const cells: { col: number; row: number }[] = [];
    for (let row = region.row; row < region.row + region.depth; row++)
      for (let col = region.col; col < region.col + region.width; col++)
        cells.push({ col, row });
    // Start at the centre, then spread facilities across their own district so
    // neighbouring question labels do not all occupy the same screen position.
    const distance = (c: { col: number; row: number }) =>
      (c.col + 0.5 - region.col - region.width / 2) ** 2 +
      (c.row + 0.5 - region.row - region.depth / 2) ** 2;
    cells.sort(
      (a, b) => distance(a) - distance(b) || a.row - b.row || a.col - b.col,
    );
    const remaining = cells.map((cell) => ({ ...cell, nearest: Infinity })),
      ordered: typeof cells = [];
    let selected = remaining.shift();
    while (selected && ordered.length < region.items.length) {
      ordered.push(selected);
      for (const cell of remaining)
        cell.nearest = Math.min(
          cell.nearest,
          (cell.col - selected.col) ** 2 + (cell.row - selected.row) ** 2,
        );
      remaining.sort(
        (a, b) =>
          b.nearest - a.nearest ||
          distance(a) - distance(b) ||
          a.row - b.row ||
          a.col - b.col,
      );
      selected = remaining.shift();
    }
    const start = cityPosition(region.col, region.row, grid),
      end = cityPosition(
        region.col + region.width - 1,
        region.row + region.depth - 1,
        grid,
      );
    districts.push({
      category: region.category,
      col: region.col,
      row: region.row,
      width: region.width,
      depth: region.depth,
      grid,
      count: region.items.length,
      x: (start.x + end.x) / 2,
      z: (start.z + end.z) / 2,
    });
    return region.items.map((c, i) => {
      const cell = ordered[i]!,
        seed = cityHash(c.id);
      return {
        ...c,
        slot: cell.row * grid + cell.col,
        grid,
        ...cityPosition(cell.col, cell.row, grid),
        height: 4.5 + (seed % 4) * 0.8,
      };
    });
  });
  return { facilities, districts, grid };
}
export function cityFacilities(challenges: SpectatorData["challenges"]) {
  return cityLayout(challenges).facilities;
}
export type CityFacility = ReturnType<typeof cityFacilities>[number];

export function activeEngagements(data: SpectatorData, now = Date.now()) {
  if (!data.started || data.frozen || Date.parse(data.contest.ends_at) <= now)
    return [];
  const visible = new Set(data.challenges.map((c) => c.challenge_id));
  return (data.engagements ?? [])
    .filter(
      (e) =>
        visible.has(e.challenge_id) &&
        Date.parse(e.last_seen) > now - 90000 &&
        Date.parse(e.last_seen) <= now + 5000,
    )
    .map((e) => ({
      ...e,
      teams: e.teams.filter((t) => Date.parse(t.last_seen) > now - 90000),
    }))
    .filter((e) => e.teams.length > 0)
    .slice(0, 12);
}
