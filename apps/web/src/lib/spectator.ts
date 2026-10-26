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
export function cityFacilities(challenges: SpectatorData["challenges"]) {
  const unique = new Map<string, SpectatorData["challenges"][number]>();
  for (const challenge of challenges)
    if (!unique.has(challenge.challenge_id))
      unique.set(challenge.challenge_id, challenge);
  const occupied = new Set<number>();
  return [...unique.values()]
    .sort((a, b) => a.challenge_id.localeCompare(b.challenge_id))
    .slice(0, 256)
    .map((c) => {
      const seed = cityHash(c.challenge_id);
      let slot = seed % 256;
      while (occupied.has(slot)) slot = (slot + 1) % 256;
      occupied.add(slot);
      const col = slot % 16,
        row = Math.floor(slot / 16);
      return {
        id: c.challenge_id,
        title: c.title,
        category: c.category || "Misc",
        slot,
        x: (Math.floor(col / 2) - 3.5) * 12 + (col % 2 ? 2.7 : -2.7),
        z: (Math.floor(row / 2) - 3.5) * 12 + (row % 2 ? 2.7 : -2.7),
        height: 4.5 + (seed % 4) * 0.8,
      };
    });
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
