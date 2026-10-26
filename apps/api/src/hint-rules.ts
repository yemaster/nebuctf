import { config } from "./config.js";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";

export const hintPolicyInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("free") }),
  z.object({
    mode: z.literal("fixed"),
    points: z.number().int().min(1).max(10000),
  }),
  z.object({
    mode: z.literal("factor"),
    factor: z.number().min(0.01).max(0.99).multipleOf(0.01),
  }),
]);
export type HintPolicy = z.infer<typeof hintPolicyInput>;
export const hintInput = z.union([
  z.string().max(2000),
  z.object({ id: z.string().uuid(), content: z.string().max(2000) }),
]);
export const hintOverridesInput = z
  .array(
    z.object({
      challenge_id: z.string().uuid(),
      hint_id: z.string().uuid(),
      policy: hintPolicyInput,
    }),
  )
  .max(2000)
  .refine(
    (v) =>
      new Set(v.map((h) => `${h.challenge_id}:${h.hint_id}`)).size === v.length,
    "提示规则不能重复",
  );
export type HintDefinition = { id: string; content: string };
// Legacy string hints get deterministic IDs, so upgrading and reordering do not repurchase hints.
export function hintDefinitions(challenge: {
  id: string;
  hints?: (string | HintDefinition)[];
}): HintDefinition[] {
  return (challenge.hints ?? []).map((hint, i) => {
    if (typeof hint !== "string") return hint;
    const h = createHash("sha256")
      .update(`${challenge.id}:hint:${i}`)
      .digest("hex");
    return {
      id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`,
      content: hint,
    };
  });
}
export function hintQuote(
  id: string,
  content: string,
  policy: HintPolicy,
  context: string[] = [],
) {
  return createHmac("sha256", config.APP_SECRET)
    .update(JSON.stringify(["hint-quote", id, content, policy, context]))
    .digest("hex");
}
