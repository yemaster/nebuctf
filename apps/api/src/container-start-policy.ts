import { z } from "zod";
import type { DB } from "./db.js";
import { fail } from "./security.js";
export const containerStartLimitInput = z
  .object({
    mode: z.enum(["inherit", "unlimited", "custom"]),
    count: z.number().int().min(0).max(10000).nullable().default(null),
  })
  .strict()
  .refine(
    (value) => value.mode !== "custom" || value.count !== null,
    "请设置靶机开启次数",
  );
export async function containerStartPolicy(
  db: DB,
  scope: string,
  owner: string,
  challenge: string,
) {
  if (scope === "practice" || scope === "test" || owner === "shared")
    return null;
  const [setting] = await db.query(
    `SELECT cc.container_start_limit,c.resource_limits FROM contest_challenges cc JOIN contests c ON c.id=cc.contest_id WHERE cc.contest_id=$1 AND cc.challenge_id=$2`,
    [scope, challenge],
  );
  if (!setting) return null;
  const override = setting.container_start_limit;
  const limit: number | null =
    override?.mode === "custom"
      ? override.count
      : override?.mode === "unlimited"
        ? null
        : (setting.resource_limits?.container_starts_per_team ?? null);
  if (limit === null) return null;
  // Pending starts reserve a use. Failed/cancelled provisioning releases it;
  // a successfully started instance remains counted even after later failure.
  const [usage] = await db.query(
    `SELECT count(*) FILTER(WHERE started_at IS NOT NULL)::int used,
    count(*) FILTER(WHERE started_at IS NULL AND status IN ('queued','starting','stopping'))::int pending
    FROM instances WHERE scope=$1 AND owner_key=$2 AND challenge_id=$3 AND resource_type='container'`,
    [scope, owner, challenge],
  );
  const remaining = Math.max(0, limit - usage!.used - usage!.pending);
  return {
    limit,
    used: usage!.used as number,
    pending: usage!.pending as number,
    remaining,
    blocked: remaining === 0,
  };
}
export async function requireContainerStart(
  db: DB,
  scope: string,
  owner: string,
  challenge: string,
) {
  const policy = await containerStartPolicy(db, scope, owner, challenge);
  if (policy?.blocked)
    fail(
      409,
      policy.limit === 0 ? "本题未开放靶机开启" : "本题靶机开启次数已用完",
    );
  return policy;
}
