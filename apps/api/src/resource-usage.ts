import type { DB } from "./db.js";
// Physical reservations include helpers, checkers and captures; owner limits count logical environments.
export async function resourceUsage(db: DB, owner = "") {
  const [usage] = await db.query(
    `WITH profiles AS (
      SELECT owner_key,spec profile,1 owned,
        CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 1 ELSE 0 END checker_n,
        CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 250 ELSE 0 END checker_cpu,
        CASE WHEN coalesce((spec->>'awd')::boolean,false) THEN 128 ELSE 0 END checker_memory,
        0 minimum_cpu,0 minimum_memory
      FROM instances WHERE status IN ('queued','starting','running','ready','stopping')
      UNION ALL
      SELECT '',jsonb_build_object('cpu',100,'memory',64),0,0,0,0,0,0
      FROM instance_traffic WHERE capture_status IN ('starting','running')
      UNION ALL
      SELECT owner_key,spec->'container',1,1,(spec->'patch'->>'cpu')::int,
        (spec->'patch'->>'memory')::int,500,256
      FROM judge_jobs WHERE status IN ('queued','building','checking') OR cleanup_pending
    ), reserved AS (
      SELECT owner_key,owned,1+checker_n+helpers.n n,
        GREATEST(minimum_cpu,(profile->>'cpu')::int+checker_cpu+helpers.cpu) cpu,
        GREATEST(minimum_memory,(profile->>'memory')::int+checker_memory+helpers.memory) memory
      FROM profiles CROSS JOIN LATERAL (
        SELECT count(*)::int n,coalesce(sum((service->>'cpu')::int),0)::int cpu,
          coalesce(sum((service->>'memory')::int),0)::int memory
        FROM jsonb_array_elements(coalesce(profile->'topology'->'services','[]'::jsonb)) service
      ) helpers
    ) SELECT coalesce(sum(n),0)::int n,coalesce(sum(cpu),0)::int cpu,
      coalesce(sum(memory),0)::int memory,
      coalesce(sum(owned) FILTER(WHERE owner_key=$1),0)::int owned FROM reserved`,
    [owner],
  );
  return usage!;
}
