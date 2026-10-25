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
export type SpectatorData = {
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

export function arenaNodes(teams: SpectatorTeam[]) {
  const visible = teams.slice(0, 60).sort((a, b) => a.id.localeCompare(b.id));
  const max = Math.max(1, ...visible.map((t) => t.score));
  return visible.map((team, index) => {
    const ring = Math.floor(index / 20),
      count = Math.min(20, visible.length - ring * 20);
    const angle = ((index % 20) / count) * Math.PI * 2 + ring * 0.12;
    const radius = 18 + ring * 3.8;
    return {
      ...team,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      height: 1 + Math.sqrt(Math.max(0, team.score) / max) * 3.8,
    };
  });
}

// Multipart questions occupy one location. Keep positions stable when solve counts change.
export function arenaSectors(challenges: SpectatorData["challenges"]) {
  const categories = [
    ...new Set(challenges.map((c) => c.category || "其他")),
  ].sort();
  const names =
    categories.length > 8
      ? [...categories.slice(0, 7), "更多分类"]
      : categories;
  return names.map((name, index) => {
    const members = challenges.filter((c) =>
      categories.length > 8 && index === 7
        ? !categories.slice(0, 7).includes(c.category || "其他")
        : (c.category || "其他") === name,
    );
    const angle = (index / names.length) * Math.PI * 2 - Math.PI / 2;
    return {
      name,
      challengeIds: [...new Set(members.map((c) => c.challenge_id))].sort(),
      solves: members.reduce((sum, c) => sum + c.solves, 0),
      x: Math.cos(angle) * 10.5,
      z: Math.sin(angle) * 10.5,
    };
  });
}
