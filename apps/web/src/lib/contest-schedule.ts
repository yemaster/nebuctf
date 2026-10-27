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
