import type { DB } from "./db.js";
// Reserve queued work as well as running work. AWD services reserve one checker slot each.
export async function resourceUsage(db: DB, owner = "") {
  const [usage] = await db.query(
    `WITH reserved AS (
    SELECT owner_key,CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 2 ELSE 1 END n,
      (spec->>'cpu')::int+CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 250 ELSE 0 END cpu,
      (spec->>'memory')::int+CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 128 ELSE 0 END memory
    FROM instances WHERE status IN ('queued','starting','running','ready','stopping')
    UNION ALL
    SELECT '',0,100,64 FROM instance_traffic WHERE capture_status IN ('starting','running')
    UNION ALL
    SELECT owner_key,2,GREATEST(500,(spec->'container'->>'cpu')::int+(spec->'patch'->>'cpu')::int),GREATEST(256,(spec->'container'->>'memory')::int+(spec->'patch'->>'memory')::int)
    FROM judge_jobs WHERE status IN ('queued','building','checking')
  ) SELECT coalesce(sum(n),0)::int n,coalesce(sum(cpu),0)::int cpu,coalesce(sum(memory),0)::int memory,coalesce(sum(n) FILTER(WHERE owner_key=$1),0)::int owned FROM reserved`,
    [owner],
  );
  return usage!;
}
