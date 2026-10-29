import { z } from "zod";

export const messagePath = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value === "" ||
      (/^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value)),
    "请填写站内路径，例如 /account",
  );
export const messageAction = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .refine((v) => !/[\u0000-\u001f]/.test(v), "按钮文字包含无效字符"),
    href: messagePath.refine(Boolean, "请填写跳转地址"),
  })
  .strict();
export const welcomeInput = z
  .object({
    enabled: z.boolean(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => !/[\u0000-\u001f]/.test(v), "标题包含无效字符"),
    body: z
      .string()
      .trim()
      .min(1)
      .max(7000)
      .refine((v) => !v.includes("\0"), "内容包含无效字符"),
    actions: z.array(messageAction).max(3),
  })
  .strict();
