// Matches the API and scoreboard SQL. Keep curve previews aligned with awards.
export function challengePoints(
  initial: number,
  minimum: number,
  decay: number,
  solves: number,
  dynamic = true,
) {
  return dynamic
    ? Math.max(
        minimum,
        Math.ceil(initial + (minimum - initial) * (solves / decay) ** 2),
      )
    : initial;
}
export function scoreCurve(initial: number, minimum: number, decay: number) {
  if (
    !Number.isFinite(initial + minimum + decay) ||
    initial < 1 ||
    minimum < 1 ||
    minimum > initial ||
    decay < 1
  )
    return [];
  const end = Math.ceil(decay * 1.2);
  return [
    ...new Set(
      Array.from({ length: Math.min(120, end) + 1 }, (_, i) =>
        Math.round((i * end) / Math.min(120, end)),
      ),
    ),
  ].map((solves) => ({
    solves,
    points: challengePoints(initial, minimum, decay, solves),
  }));
}
