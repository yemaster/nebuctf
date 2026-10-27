import { z } from "zod";
import { imageReference } from "./image-reference.js";
import type { Row } from "./db.js";

const resourceLimits = {
  image: imageReference,
  cpu: z.number().int().min(100).max(4000).default(500),
  memory: z.number().int().min(32).max(4096).default(256),
  ttl: z.number().int().min(60).max(7200).default(1800),
};
export const containerInput = z.object({
  ...resourceLimits,
  use_platform_ttl: z.boolean().optional(),
  mode: z.enum(["private", "public"]).default("private"),
  access_mode: z.enum(["port", "domain"]).default("port"),
  port: z.number().int().min(1024).max(65535).default(8080),
});
export const generatorInput = z.object(resourceLimits);
export const resourcesInput = z.object({
  container: containerInput.nullable().default(null),
  attachment: generatorInput.nullable().default(null),
});
export type ResourceProfiles = z.infer<typeof resourcesInput>;
export function resourceProfiles(c: Row): ResourceProfiles {
  if (c.resources) return c.resources;
  const limits = { image: c.image, cpu: c.cpu, memory: c.memory, ttl: c.ttl };
  return {
    container: ["static_container", "dynamic_container"].includes(c.kind)
      ? {
          ...limits,
          access_mode: c.access_mode,
          port: c.port,
          mode: c.kind === "static_container" ? "public" : "private",
        }
      : null,
    attachment: c.kind === "dynamic_attachment" ? limits : null,
  };
}
export const flagMode = (c: Row): "static" | "dynamic" =>
  c.flag_mode ?? (c.kind.startsWith("dynamic") ? "dynamic" : "static");
export function resourceChallenge(
  c: Row,
  type?: "container" | "attachment",
): Row | null {
  const profiles = resourceProfiles(c);
  const selectedType =
    type ?? (profiles.container ? "container" : "attachment");
  const profile = profiles[selectedType];
  if (!profile) return null;
  return {
    ...c,
    ...profile,
    resource_type: selectedType,
    flag_mode: flagMode(c),
    kind:
      selectedType === "attachment"
        ? "dynamic_attachment"
        : (profile as z.infer<typeof containerInput>).mode === "public"
          ? "static_container"
          : "dynamic_container",
  };
}

const answerId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export const objectiveInput = z
  .object({
    type: z.enum(["single", "multiple", "blank"]),
    options: z
      .array(
        z.object({ id: answerId, text: z.string().trim().min(1).max(2000) }),
      )
      .max(12)
      .default([]),
    correct_options: z.array(answerId).max(12).default([]),
    blanks: z
      .array(
        z.object({
          id: answerId,
          label: z.string().trim().min(1).max(100),
          answers: z.array(z.string().min(1).max(500)).min(1).max(10),
        }),
      )
      .max(10)
      .default([]),
    case_sensitive: z.boolean().default(true),
    trim: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (v.type === "blank") {
      if (!v.blanks.length || v.options.length || v.correct_options.length)
        error("填空题需要空位与答案，不能配置选项");
      if (new Set(v.blanks.map((b) => b.id)).size !== v.blanks.length)
        error("填空标识不能重复");
      if (
        v.blanks.some((b) =>
          b.answers.some((answer) => !(v.trim ? answer.trim() : answer).length),
        )
      )
        error("填空答案不能为空");
    } else {
      if (v.options.length < 2 || v.blanks.length)
        error("选择题至少需要两个选项，不能配置空位");
      if (new Set(v.options.map((o) => o.id)).size !== v.options.length)
        error("选项标识不能重复");
      if (
        !v.correct_options.length ||
        (v.type === "single" && v.correct_options.length !== 1)
      )
        error("请设置正确选项");
      if (
        new Set(v.correct_options).size !== v.correct_options.length ||
        v.correct_options.some((id) => !v.options.some((o) => o.id === id))
      )
        error("正确答案必须使用有效且不重复的选项");
    }
  });
export type ObjectiveDefinition = z.infer<typeof objectiveInput>;
export const objectiveAnswer = z
  .object({
    choices: z.array(answerId).max(12).optional(),
    blanks: z.record(answerId, z.string().max(500)).optional(),
  })
  .strict();
export type ObjectiveAnswer = z.infer<typeof objectiveAnswer>;
export function publicObjective(value: ObjectiveDefinition) {
  return {
    type: value.type,
    options: value.options,
    blanks: value.blanks.map(({ id, label }) => ({ id, label })),
    case_sensitive: value.case_sensitive,
    trim: value.trim,
  };
}
export function gradeObjective(
  definition: ObjectiveDefinition,
  answer: ObjectiveAnswer,
) {
  if (definition.type === "blank") {
    if (
      answer.choices?.length ||
      !answer.blanks ||
      Object.keys(answer.blanks).length !== definition.blanks.length
    )
      return false;
    const normalize = (s: string) => {
      const value = definition.trim ? s.trim() : s;
      return definition.case_sensitive ? value : value.toLowerCase();
    };
    return definition.blanks.every((blank) => {
      const supplied = answer.blanks![blank.id];
      return (
        typeof supplied === "string" &&
        blank.answers.some(
          (expected) => normalize(expected) === normalize(supplied),
        )
      );
    });
  }
  const choices = answer.choices ?? [];
  if (answer.blanks && Object.keys(answer.blanks).length) return false;
  return (
    choices.length === definition.correct_options.length &&
    new Set(choices).size === choices.length &&
    choices.every((choice) => definition.correct_options.includes(choice))
  );
}

// Expose option IDs and per-blank verdicts only after this team has finalized.
// Never include accepted fill-in answers in the review payload.
export function objectiveReview(
  definition: ObjectiveDefinition,
  answer: ObjectiveAnswer,
) {
  return definition.type === "blank"
    ? {
        blanks: Object.fromEntries(
          definition.blanks.map((blank) => [
            blank.id,
            gradeObjective(
              { ...definition, blanks: [blank] },
              { blanks: { [blank.id]: answer.blanks?.[blank.id] ?? "" } },
            ),
          ]),
        ),
      }
    : { choices: definition.correct_options };
}

export const patchConfigInput = z.object({
  checker_image: imageReference,
  patch_root: z
    .string()
    .regex(
      /^\/(?:app|srv|opt)(?:\/[a-zA-Z0-9_-]+)*$/,
      "补丁目录必须位于 /app、/srv 或 /opt 内",
    )
    .default("/app"),
  timeout: z.number().int().min(10).max(120).default(60),
  cpu: z.number().int().min(100).max(2000).default(500),
  memory: z.number().int().min(64).max(1024).default(256),
});
export const awdConfigInput = z.object({
  checker_image: imageReference,
  timeout: z.number().int().min(5).max(60).default(20),
});
