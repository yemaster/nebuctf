export type HintPolicy =
  | { mode: "free" }
  | { mode: "fixed"; points: number }
  | { mode: "factor"; factor: number };
export type HintDefinition = { id: string; content: string };
export type ChallengeHint = {
  id: string;
  content?: string;
  unlocked?: boolean;
  policy?: HintPolicy;
  quote?: string;
};
export type HintOverride = {
  challenge_id: string;
  hint_id: string;
  policy: HintPolicy;
};
export function hintPrice(policy: HintPolicy) {
  return policy.mode === "fixed"
    ? `扣 ${policy.points} 分`
    : policy.mode === "factor"
      ? `本题 × ${policy.factor}`
      : "免费";
}

export function validHintPolicy(policy: HintPolicy) {
  return (
    policy.mode === "free" ||
    (policy.mode === "fixed"
      ? Number.isInteger(policy.points) &&
        policy.points >= 1 &&
        policy.points <= 10000
      : Number.isFinite(policy.factor) &&
        policy.factor >= 0.01 &&
        policy.factor <= 0.99 &&
        Math.abs(policy.factor * 100 - Math.round(policy.factor * 100)) < 1e-8)
  );
}
