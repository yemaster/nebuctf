import { z } from "zod";
export const registrationField = z
  .object({
    id: z.uuid(),
    label: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((v) => !/[\u0000-\u001f]/.test(v), "字段名称不能包含控制字符"),
    type: z.enum([
      "text",
      "textarea",
      "email",
      "phone",
      "address",
      "select",
      "multi",
    ]),
    scope: z.enum(["team", "member"]),
    required: z.boolean(),
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((v) => !/[\u0000-\u001f]/.test(v), "选项不能包含控制字符"),
      )
      .max(30)
      .default([]),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (["select", "multi"].includes(f.type) && f.options.length < 2)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "选项至少填写两个",
      });
    if (new Set(f.options).size !== f.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "选项不能重复",
      });
  });
export const registrationFormInput = z
  .array(registrationField)
  .max(20)
  .refine(
    (fields) => new Set(fields.map((f) => f.id)).size === fields.length,
    "字段不能重复",
  );
const value = z.union([
  z
    .string()
    .trim()
    .max(1000)
    .refine((v) => !v.includes("\0"), "内容包含无效字符"),
  z
    .array(
      z
        .string()
        .trim()
        .max(100)
        .refine((v) => !v.includes("\0"), "内容包含无效字符"),
    )
    .max(30),
]);
export const registrationAnswers = z
  .object({
    team: z.record(z.uuid(), value).default({}),
    members: z.record(z.uuid(), z.record(z.uuid(), value)).default({}),
  })
  .strict()
  .default({ team: {}, members: {} })
  .refine(
    (v) => JSON.stringify(v).length <= 150000,
    "报名资料过长，请精简长文本",
  );
