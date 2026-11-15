import { emptyQuestionLogic, validateQuestionLogic } from "./contest-logic.js";
import { registrationFormInput } from "./registration-form-input.js";
import {
  submissionLimitsInput,
  submissionOverridesInput,
} from "./submission-policy.js";
import {
  hintInput,
  hintPolicyInput,
  hintOverridesInput,
} from "./hint-rules.js";
import { contestResourceLimitsInput } from "./contest-resource-limits.js";
import { writeupInput } from "./writeup-config.js";
import {
  flagEnvironmentName,
  partEnvironmentName,
} from "./flag-environment.js";
import { flagTemplateInput } from "./flag-template.js";
import {
  resourcesInput,
  objectiveInput,
  patchConfigInput,
  awdConfigInput,
} from "./challenge-model.js";
import { timingInput, contestChallengeInput } from "./competition-rules.js";
import { imageReference } from "./image-reference.js";
import { z } from "zod";
import {
  groupPermissionInput,
  groupOverridesInput,
} from "./group-permissions.js";
export const id = z.string().uuid();
export const scope = z.union([z.literal("practice"), id]).default("practice");
export const password = z.string().min(8, "密码至少 8 位").max(128);
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const credentials = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1, "请输入用户名或邮箱")
      .max(254)
      .optional(),
    // Keep existing clients and deployment scripts using { email, password } working.
    email: z.string().trim().pipe(email).optional(),
    password: z.string().min(1).max(128),
  })
  .refine(
    (data) => (data.identifier !== undefined) !== (data.email !== undefined),
    {
      message: "请提供用户名或邮箱",
      path: ["identifier"],
    },
  )
  .transform((data) => ({
    identifier: data.identifier ?? data.email!,
    password: data.password,
  }));
export const register = z.object({
  username: z
    .string()
    .regex(
      /^[\p{L}\p{N}_-]{2,32}$/u,
      "用户名为 2–32 位字母、数字、中文或下划线",
    ),
  email,
  password,
});
export const partInput = z
  .object({
    id: id.optional(),
    role: z.enum(["flag", "attack", "defense"]).default("flag"),
    flag_env: partEnvironmentName.nullable().optional(),
    flag_template: flagTemplateInput.nullable().optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().max(1000).default(""),
    flag: z.string().min(1).max(256).optional(),
    initial_points: z.number().int().min(1).max(10000),
    minimum_points: z.number().int().min(1),
  })
  .refine(
    (v) => v.minimum_points <= v.initial_points,
    "小题最低分不能超过初始分",
  );
export const challengeInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().max(20000).default(""),
    category: z.enum(["Web", "Pwn", "Reverse", "Crypto", "Misc", "Forensics"]),
    difficulty: z.enum(["入门", "简单", "中等", "困难"]),
    challenge_type: z.enum(["ctf", "objective", "awdp", "awd"]).default("ctf"),
    flag_mode: z.enum(["static", "dynamic"]).nullable().default(null),
    flag_env: flagEnvironmentName.optional(),
    flag_template: flagTemplateInput.optional(),
    resources: resourcesInput.nullable().default(null),
    objective: objectiveInput.nullable().default(null),
    patch_config: patchConfigInput.nullable().default(null),
    awd_config: awdConfigInput.nullable().default(null),
    kind: z
      .enum([
        "static_attachment",
        "dynamic_attachment",
        "static_container",
        "dynamic_container",
      ])
      .default("static_attachment"),
    flag: z.string().min(1).max(256).optional(),
    parts: z
      .array(partInput)
      .max(20)
      .refine((v) => v.length === 0 || v.length >= 2, "多小题至少配置两题")
      .optional(),
    initial_points: z.number().int().min(1).max(10000).default(500),
    minimum_points: z.number().int().min(1).default(100),
    decay: z.number().int().min(1).max(10000).default(20),
    dynamic_score: z.boolean().default(true),
    published: z.boolean().default(false),
    publish_at: z.iso.datetime().nullable().default(null),
    practice: z.boolean().default(false),
    hints: z
      .array(hintInput)
      .max(10)
      .default([])
      .refine((v) => {
        const ids = v.filter((h) => typeof h !== "string").map((h) => h.id);
        return new Set(ids).size === ids.length;
      }, "提示 ID 不能重复"),
    access_mode: z.enum(["port", "domain"]).default("port"),
    image: imageReference.or(z.literal("")).default(""),
    port: z.number().int().min(1024).max(65535).default(8080),
    cpu: z.number().int().min(100).max(4000).default(500),
    memory: z.number().int().min(32).max(4096).default(256),
    ttl: z.number().int().min(60).max(7200).default(1800),
  })
  .transform((v) => {
    if (v.resources) {
      const primary = v.resources.container ?? v.resources.attachment;
      v.kind = v.resources.container
        ? v.resources.container.mode === "public"
          ? "static_container"
          : "dynamic_container"
        : v.resources.attachment
          ? "dynamic_attachment"
          : "static_attachment";
      if (primary) {
        v.image = primary.image;
        v.cpu = primary.cpu;
        v.memory = primary.memory;
        v.ttl = primary.ttl;
        if (v.resources.container) {
          v.port = v.resources.container.port;
          v.access_mode = v.resources.container.access_mode;
        }
      } else v.image = "";
    }
    v.flag_mode ??= v.kind.startsWith("dynamic") ? "dynamic" : "static";
    if (v.challenge_type === "objective") {
      v.dynamic_score = false;
      v.minimum_points = v.initial_points;
    }
    return v;
  })
  .superRefine((v, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (v.challenge_type === "objective") {
      if (!v.objective) error("请配置客观题答案");
      if (v.parts?.length || v.kind !== "static_attachment")
        error("客观题不能配置 Flag 小题或执行环境");
    } else if (v.objective) error("只有客观题可以配置选项与填空答案");
    if (v.resources?.container?.mode === "public" && v.flag_mode === "dynamic")
      error("公共靶机需要使用静态 Flag");
    if (
      (v.flag_mode !== "dynamic" || v.challenge_type === "objective") &&
      (v.flag_template || v.parts?.some((p) => p.flag_template))
    )
      error("Flag 模板仅用于动态 Flag");
    if (v.parts?.some((p) => p.role === "defense" && p.flag_template))
      error("防守计分单元不配置 Flag 模板");
    if (v.challenge_type === "awdp" || v.challenge_type === "awd") {
      if (
        !v.resources?.container ||
        v.resources.container.mode !== "private" ||
        !v.patch_config ||
        v.flag_mode !== "dynamic"
      )
        error("攻防题需要独立靶机、动态 Flag 和检测镜像");
    }
    if (v.challenge_type === "awdp") {
      if (
        !v.parts ||
        v.parts.length !== 2 ||
        !v.parts.some((p) => p.role === "attack") ||
        !v.parts.some((p) => p.role === "defense")
      )
        error("AWDP 需要攻击与防守两个计分单元");
    } else if (v.parts?.some((p) => p.role !== "flag"))
      error("攻击与防守计分单元仅用于 AWDP 题");
    if (v.challenge_type === "awd" && !v.awd_config)
      error("AWD 需要配置巡检镜像");
    if (v.challenge_type === "awd" && v.practice) error("AWD 题仅用于比赛");
    if (v.challenge_type === "awd" && v.parts?.length)
      error("AWD 服务不使用 Flag 小题");
  })
  .refine((v) => v.minimum_points <= v.initial_points, "最低分不能超过初始分")
  .refine(
    (v) => v.kind === "static_attachment" || v.image.length > 0,
    "容器或动态附件需要镜像",
  );
export const contestInput = z
  .object({
    registration_form: registrationFormInput.optional(),
    submission_limits: submissionLimitsInput.optional(),
    submission_overrides: submissionOverridesInput.optional(),
    hint_policy: hintPolicyInput.optional(),
    hint_overrides: hintOverridesInput.optional(),
    require_review: z.boolean().optional(),
    practice_mode: z.boolean().optional(),
    spectator_enabled: z.boolean().optional(),
    spectator_scoreboard: z.boolean().optional(),
    visibility: z.enum(["public", "private"]).optional(),
    resource_limits: contestResourceLimitsInput.optional(),
    registration_mode: z.enum(["public", "invite", "teams"]).optional(),
    registration_opens_at: z.iso.datetime().nullable().optional(),
    registration_closes_at: z.iso.datetime().nullable().optional(),
    registration_code: z
      .string()
      .trim()
      .max(128)
      .refine((v) => !v || v.length >= 6, "邀请码至少 6 位")
      .optional(),
    registration_team_ids: z.array(id).max(500).optional(),
    writeup: writeupInput.optional(),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(10000).default(""),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    freeze_at: z.iso.datetime().nullable().default(null),
    team_limit: z.number().int().min(1).max(20).default(4),
    published: z.boolean().default(false),
    challenge_ids: z.array(id).max(200).default([]),
    timing: timingInput.default({}),
    round_duration: z.number().int().min(60).max(3600).default(300),
    challenge_settings: z.array(contestChallengeInput).max(200).optional(),
    groups: z
      .array(
        z.object({
          id: id.optional(),
          name: z.string().trim().min(1).max(60),
          description: z.string().max(500).default(""),
          invite_code: z
            .string()
            .trim()
            .max(128)
            .refine((v) => !v || v.length >= 6, "组别邀请码至少 6 位")
            .optional(),
          review_mode: z.enum(["inherit", "auto", "required"]).optional(),
          permissions: groupPermissionInput.optional(),
          challenge_permissions: groupOverridesInput.optional(),
        }),
      )
      .max(21)
      .optional(),
  })
  .superRefine((v, ctx) => {
    const settings = v.challenge_settings ?? [];
    if (
      new Set(settings.map((s) => s.challenge_id)).size !== settings.length ||
      settings.some((s) => !v.challenge_ids.includes(s.challenge_id))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["challenge_settings"],
        message: "赛题配置必须属于当前比赛且不能重复",
      });
      return;
    }
    try {
      validateQuestionLogic(
        v.challenge_ids.map((challenge_id) => ({
          challenge_id,
          logic:
            settings.find((s) => s.challenge_id === challenge_id)?.logic ??
            emptyQuestionLogic(),
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "赛题逻辑无效";
      const index = settings.findIndex((s) => message.includes(s.challenge_id));
      ctx.addIssue({
        code: "custom",
        path:
          index < 0
            ? ["challenge_settings"]
            : ["challenge_settings", index, "logic"],
        message,
      });
    }
  })
  .refine((v) => v.ends_at > v.starts_at, "结束时间必须晚于开始时间")
  .refine(
    (v) =>
      !v.freeze_at || (v.freeze_at >= v.starts_at && v.freeze_at < v.ends_at),
    "封榜时间必须在比赛期间",
  );
export const page = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().max(100).default(""),
  category: z.string().max(30).default(""),
  scope,
});
