import { SpectatorEvents, type SpectatorData } from "./spectator";

export type SpectatorHighlight = {
  id: string;
  teamId: string;
  teamName: string;
  createdAt: number;
} & (
  | {
      kind: "blood";
      challengeCategory: string | null;
      challengeTitle: string;
      partTitle: string | null;
    }
  | { kind: "leader"; score: number }
);
export type SpectatorHighlightBatch = { items: SpectatorHighlight[] };

// Only consecutive live WebSocket snapshots can produce a broadcast. HTTP
// loads, reconnect snapshots and unfreezing establish a new baseline.
export class SpectatorHighlightTracker {
  private events = new SpectatorEvents();
  private previous: { eligible: boolean; leader: string | null } | undefined;
  private sequence = 0;

  ingest(data: SpectatorData, continuous: boolean, now = Date.now()) {
    const eligible =
      data.started && !data.frozen && Date.parse(data.contest.ends_at) > now;
    const leader = data.leaders.find(
      (team) => team.rank === 1 && team.score > 0,
    );
    const previous = this.previous;
    this.previous = { eligible, leader: leader?.id ?? null };
    const fresh = this.events.ingest(data.events, continuous, now);
    if (!continuous || !eligible || !previous?.eligible) return [];
    const items: SpectatorHighlight[] = fresh
      .filter(
        (e) =>
          e.type === "solve" && e.blood_rank === 1 && e.team_id && e.team_name,
      )
      .sort(
        (a, b) =>
          Date.parse(a.created_at) - Date.parse(b.created_at) ||
          a.id.localeCompare(b.id),
      )
      .map((e) => ({
        id: `blood:${e.id}`,
        kind: "blood",
        teamId: e.team_id!,
        teamName: e.team_name!,
        challengeCategory:
          data.challenges
            .find((challenge) => challenge.challenge_id === e.challenge_id)
            ?.category.trim() || null,
        challengeTitle: e.challenge_title,
        partTitle: e.part_title,
        createdAt: now,
      }));
    if (leader && previous.leader && leader.id !== previous.leader)
      items.push({
        id: `leader:${++this.sequence}`,
        kind: "leader",
        teamId: leader.id,
        teamName: leader.name,
        score: leader.score,
        createdAt: now,
      });
    return items;
  }
}

export function enqueueSpectatorHighlights(
  current: SpectatorHighlight[],
  incoming: SpectatorHighlight[],
  now = Date.now(),
) {
  const [active, ...pending] = current;
  const ids = new Set(current.map((item) => item.id));
  const fresh = incoming.filter((item) => !ids.has(item.id));
  const next = [...pending, ...fresh].filter(
    (item) => now - item.createdAt < 20000,
  );
  // Keep the currently displayed event; replace superseded pending leaders and
  // bound a burst so the city is not hidden behind a long announcement backlog.
  const latestLeader = [...next]
    .reverse()
    .find((item) => item.kind === "leader");
  const waiting = next.filter(
    (item) => item.kind !== "leader" || item === latestLeader,
  );
  return active ? [active, ...waiting.slice(-4)] : waiting.slice(0, 5);
}
