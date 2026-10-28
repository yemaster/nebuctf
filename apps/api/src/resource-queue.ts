import type { DB, Row } from "./db.js";

// Shared by the scheduler and the queue counter; no other participant's data is exposed.
export const queuePriority = (alias: string) =>
  `CASE WHEN ${alias}.kind='terminal' OR EXISTS(SELECT 1 FROM solves s WHERE s.challenge_id=${alias}.challenge_id AND s.scope=${alias}.scope AND s.owner_key=${alias}.owner_key) THEN 1 ELSE 0 END`;
export const queueReady = (alias: string) =>
  `${alias}.expires_at>now() AND NOT EXISTS(SELECT 1 FROM instances previous WHERE previous.id::text IN (SELECT jsonb_array_elements_text(coalesce(${alias}.spec->'replace_ids','[]'::jsonb))) AND previous.status NOT IN ('stopped','failed'))`;
export async function withQueuePositions(db: DB, items: Row[]) {
  const ids = items.filter((i) => i.status === "queued").map((i) => i.id);
  if (!ids.length) return items;
  const positions = await db.query(
    `WITH queue AS (
      SELECT i.id,(row_number() OVER(ORDER BY ${queuePriority("i")},i.created_at,i.id)-1)::int queue_ahead
      FROM instances i WHERE (i.status='queued' OR (i.status='starting' AND i.updated_at<now()-interval '2 minutes')) AND ${queueReady("i")}
    ) SELECT * FROM queue WHERE id=ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(positions.map((p) => [p.id, p.queue_ahead]));
  return items.map((i) =>
    i.status === "queued"
      ? {
          ...i,
          queue_ahead: byId.get(i.id) ?? null,
          queue_blocked: !byId.has(i.id),
        }
      : i,
  );
}
