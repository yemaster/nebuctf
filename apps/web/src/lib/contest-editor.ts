import type { ContestQuestion, Points } from "./competition";

// Validate saved state as well as mounted inputs: rows can be collapsed or on another page.
export function validateContestQuestions(
  settings: ContestQuestion[],
  starts: string,
  ends: string,
) {
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  const validPoints = (p: Points) =>
    integer(p.initial_points, 1, 10000) &&
    integer(p.minimum_points, 1, p.initial_points) &&
    integer(p.decay, 1, 10000);
  for (const s of settings) {
    const error = (message: string) => ({ id: s.challenge_id, message });
    if (
      s.release_at !== null &&
      (!s.release_at || !Number.isFinite(Date.parse(s.release_at)))
    )
      return error("请选择上线时间，或改为随阶段开放。");
    if (
      s.release_at &&
      (Date.parse(s.release_at) < Date.parse(starts) ||
        Date.parse(s.release_at) >= Date.parse(ends))
    )
      return error("上线时间须在比赛开始之后、结束之前。");
    const v = s.scoring;
    if (
      (v.mode !== "inherit" && !v.points) ||
      (v.points && !validPoints(v.points)) ||
      v.parts.some((p) => !validPoints(p.points))
    )
      return error(
        "分值须为 1–10000 的整数，最低分不能超过初始分，衰减人数须为 1–10000 的整数。",
      );
    if (
      v.mode === "round" &&
      (!v.round ||
        !integer(v.round.flag_lifetime, 1, 5) ||
        !integer(v.round.defense_points, 0, 10000) ||
        !integer(v.round.availability_points, 0, 10000))
    )
      return error("检查轮次计分：Flag 有效 1–5 轮，得分为 0–10000 的整数。");
  }
  return null;
}
