import type { Contest } from "./types";

export function contestProgress(
  contest: Pick<Contest, "starts_at" | "ends_at">,
  now: number,
) {
  const start = Date.parse(contest.starts_at),
    end = Date.parse(contest.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

export function contestStages(contest: Contest, now: number) {
  const windows = [
    {
      id: "registration",
      title: "报名阶段",
      start: contest.registration_opens_at ?? null,
      end: contest.registration_closes_at ?? contest.ends_at,
      active: "报名中",
      ended: "已截止",
    },
    {
      id: "contest",
      title: "比赛阶段",
      start: contest.starts_at,
      end: contest.ends_at,
      active: "进行中",
      ended: "已结束",
    },
    ...(contest.writeup?.enabled && contest.writeup.deadline
      ? [
          {
            id: "writeup",
            title: "WriteUp 提交",
            start: contest.writeup.opens_at ?? contest.ends_at,
            end: contest.writeup.deadline,
            active: "提交中",
            ended: "已截止",
          },
        ]
      : []),
    ...(contest.practice_mode
      ? [
          {
            id: "practice",
            title: "赛后练习",
            start: contest.ends_at,
            end: null,
            active: "已开放",
            ended: "",
          },
        ]
      : []),
  ];
  return windows.map((stage) => {
    const state =
      stage.start && now < Date.parse(stage.start)
        ? "upcoming"
        : stage.end && now >= Date.parse(stage.end)
          ? "ended"
          : "active";
    return {
      ...stage,
      state,
      label:
        state === "upcoming"
          ? "未开始"
          : state === "ended"
            ? stage.ended
            : stage.active,
    };
  });
}

type TimelineEvent = { id: string; title: string; detail?: string };
export type ContestTimelineNode = {
  id: string;
  at: string | null;
  state: "past" | "current" | "future";
  events: TimelineEvent[];
};

export function contestTimeline(
  contest: Contest,
  now: number,
): ContestTimelineNode[] {
  const stages = contestStages(contest, now);
  const groups = new Map<number, { at: string; events: TimelineEvent[] }>();
  const names: Record<string, [string, string, string]> = {
    registration: ["报名开放", "报名截止", "报名中"],
    contest: ["比赛开始", "比赛结束", "比赛中"],
    writeup: ["WriteUp 开放提交", "WriteUp 截止", "WriteUp 提交中"],
    practice: ["赛后练习开放", "", "练习开放"],
  };
  const add = (at: string | null, event: TimelineEvent) => {
    if (!at) return;
    const stamp = Date.parse(at);
    if (!Number.isFinite(stamp)) return;
    const group = groups.get(stamp) ?? { at, events: [] };
    group.events.push(event);
    groups.set(stamp, group);
  };
  for (const stage of stages) {
    add(stage.start, { id: `${stage.id}-start`, title: names[stage.id][0] });
    add(stage.end, { id: `${stage.id}-end`, title: names[stage.id][1] });
  }
  for (const [key, title] of [
    ["objective", "客观题"],
    ["practical", "实操题"],
  ] as const) {
    const phase = contest.timing?.[key];
    if (!phase || phase.mode === "inherit") continue;
    add(phase.opens_at, {
      id: `${key}-start`,
      title: `${title}开放`,
      detail:
        phase.mode === "flexible"
          ? `自由开始，限时 ${(phase.duration_seconds ?? 0) / 60} 分钟`
          : undefined,
    });
    add(phase.closes_at, { id: `${key}-end`, title: `${title}截止` });
  }
  add(contest.freeze_at, { id: "freeze", title: "排行榜封榜" });
  const nodes: ContestTimelineNode[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stamp, group]) => ({
      id: `time-${stamp}`,
      ...group,
      state: stamp <= now ? "past" : "future",
    }));
  if (!contest.registration_opens_at) {
    nodes.unshift({
      id: "publication",
      at: null,
      state: "past",
      events: [{ id: "registration-start", title: "报名开放" }],
    });
  }
  const next = nodes.findIndex((node) => node.state === "future");
  nodes.splice(next === -1 ? nodes.length : next, 0, {
    id: "now",
    at: new Date(now).toISOString(),
    state: "current",
    events: stages
      .filter((stage) => stage.state === "active")
      .map((stage) => ({ id: stage.id, title: names[stage.id][2] })),
  });
  return nodes;
}
