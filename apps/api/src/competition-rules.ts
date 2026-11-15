import { z } from "zod";
import type { Row } from "./db.js";
import { fail } from "./security.js";
import { questionLogicInput } from "./contest-logic.js";

export const phaseName = z.enum(["objective", "practical"]);
export type PhaseName = z.infer<typeof phaseName>;
export const phaseInput = z
  .object({
    mode: z.enum(["inherit", "fixed", "flexible"]).default("inherit"),
    opens_at: z.iso.datetime().nullable().default(null),
    closes_at: z.iso.datetime().nullable().default(null),
    duration_seconds: z
      .number()
      .int()
      .min(60)
      .max(604800)
      .nullable()
      .default(null),
  })
  .superRefine((v, ctx) => {
    if (
      v.mode !== "inherit" &&
      (!v.opens_at || !v.closes_at || v.closes_at <= v.opens_at)
    )
      ctx.addIssue({ code: "custom", message: "请设置有效的阶段起止时间" });
    if (v.mode === "flexible" && !v.duration_seconds)
      ctx.addIssue({ code: "custom", message: "自由开始需要设置作答时长" });
  });
export const timingInput = z.object({
  objective: phaseInput.optional(),
  practical: phaseInput.optional(),
});
export const pointOverride = z
  .object({
    initial_points: z.number().int().min(1).max(10000),
    minimum_points: z.number().int().min(1).max(10000),
    decay: z.number().int().min(1).max(10000),
  })
  .refine((v) => v.minimum_points <= v.initial_points, "最低分不能超过初始分");
export const contestScoringInput = z
  .object({
    mode: z.enum(["inherit", "fixed", "dynamic", "round"]).default("inherit"),
    points: pointOverride.optional(),
    parts: z
      .array(z.object({ id: z.string().uuid(), points: pointOverride }))
      .max(20)
      .default([]),
    round: z
      .object({
        dynamic: z.boolean().default(false),
        carry: z.boolean().default(true),
        flag_lifetime: z.number().int().min(1).max(5).default(1),
        defense_points: z.number().int().min(0).max(10000).default(100),
        availability_points: z.number().int().min(0).max(10000).default(100),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== "inherit" && !v.points)
      ctx.addIssue({ code: "custom", message: "覆盖计分需要设置分值" });
    if (v.mode === "round" && !v.round)
      ctx.addIssue({ code: "custom", message: "多轮计分需要设置轮次参数" });
    if (new Set(v.parts.map((p) => p.id)).size !== v.parts.length)
      ctx.addIssue({ code: "custom", message: "小题计分设置不能重复" });
  });
export type ContestScoring = z.infer<typeof contestScoringInput>;
export const contestChallengeInput = z.object({
  challenge_id: z.string().uuid(),
  published: z.boolean().default(true),
  release_at: z.iso.datetime().nullable().default(null),
  scoring: contestScoringInput.default({ mode: "inherit", parts: [] }),
  logic: questionLogicInput.default({
    exclusive_group: null,
    dependency: null,
  }),
});

export function validateTiming(contest: Row, hasAwd: boolean) {
  const start = Date.parse(contest.starts_at),
    end = Date.parse(contest.ends_at);
  for (const [section, rule] of Object.entries(contest.timing ?? {}) as [
    string,
    z.infer<typeof phaseInput>,
  ][]) {
    if (rule.mode === "inherit") continue;
    const opens = Date.parse(rule.opens_at!),
      closes = Date.parse(rule.closes_at!);
    if (opens < start || closes > end || closes <= opens)
      fail(400, "阶段时间必须在比赛有效范围内");
    if (rule.mode === "flexible" && section === "practical" && hasAwd)
      fail(400, "轮次计分需要统一的实操时间，不能自由开始");
  }
}

export function phaseWindow(
  contest: Row,
  section: PhaseName,
  attempt?: Row,
  now = Date.now(),
) {
  const rule = contest.timing?.[section];
  const mode: "inherit" | "fixed" | "flexible" = rule?.mode ?? "inherit";
  const opens = new Date(
    mode === "inherit" ? contest.starts_at : rule.opens_at,
  ).getTime();
  const closes = new Date(
    mode === "inherit" ? contest.ends_at : rule.closes_at,
  ).getTime();
  const started =
    mode === "flexible"
      ? attempt
        ? new Date(attempt.started_at).getTime()
        : null
      : opens;
  const deadline =
    mode === "flexible" && attempt
      ? Math.min(new Date(attempt.deadline_at).getTime(), closes)
      : closes;
  const status =
    now < opens
      ? "scheduled"
      : now >= deadline
        ? "ended"
        : started === null
          ? "ready"
          : "active";
  return {
    section,
    mode,
    opens_at: new Date(opens).toISOString(),
    closes_at: new Date(closes).toISOString(),
    duration_seconds: mode === "flexible" ? rule.duration_seconds : null,
    started_at: started === null ? null : new Date(started).toISOString(),
    deadline_at:
      mode === "flexible" && !attempt ? null : new Date(deadline).toISOString(),
    status,
  };
}
export const challengePhase = (c: Row): PhaseName =>
  c.challenge_type === "objective" ? "objective" : "practical";
export function effectivePoints(
  challenge: Row,
  scoring?: ContestScoring,
  partId?: string,
): Row {
  if (!scoring || scoring.mode === "inherit") return challenge;
  const points = partId
    ? (scoring.parts ?? []).find((p) => p.id === partId)?.points
    : scoring.points;
  return {
    ...challenge,
    ...(points ?? {}),
    dynamic_score:
      scoring.mode === "dynamic" ||
      (scoring.mode === "round" && !!scoring.round?.dynamic),
    scoring_mode: scoring.mode,
  };
}
