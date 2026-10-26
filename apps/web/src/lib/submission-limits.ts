export type SubmissionLimits = { flag: number | null; defense: number | null };
export type SubmissionOverride = {
  challenge_id: string;
  flag?: number | null;
  defense?: number | null;
};
export type SubmissionUsage = {
  limit: number | null;
  used: number;
  remaining: number | null;
};
export const validSubmissionLimit = (value: number | null | undefined) =>
  value == null || (Number.isInteger(value) && value >= 1 && value <= 100000);
