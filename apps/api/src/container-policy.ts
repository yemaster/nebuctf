import type { DB, Row } from "./db.js";
import { config } from "./config.js";
import { getSetting } from "./settings.js";
import { resourceUsage } from "./resource-usage.js";
import { contestResourcePolicy } from "./contest-resource-limits.js";
import { fail } from "./security.js";
import { containerFootprint } from "./container-topology.js";

// Invoked under the common resource lock. Only same-scope, same-owner ordinary containers qualify.
export async function allocationPlan(
  db: DB,
  scope: string,
  owner: string,
  c: Row,
) {
  const [policy, usage, quota] = await Promise.all([
    getSetting(db, "containers"),
    resourceUsage(db, owner),
    contestResourcePolicy(db, scope, owner, c.resource_type),
  ]);
  let removed = 0;
  const requested = containerFootprint({
    cpu: c.cpu,
    memory: c.memory,
    topology: c.topology,
  });
  const fits = () =>
    (policy.max_instances === null ||
      usage.n + requested.containers <= policy.max_instances) &&
    usage.cpu + requested.cpu <= config.MAX_CPU &&
    usage.memory + requested.memory <= config.MAX_MEMORY &&
    (owner === "shared" ||
      policy.max_owner_instances === null ||
      usage.owned + 1 <= policy.max_owner_instances) &&
    (!quota ||
      ((quota.team_limit === null ||
        quota.team_used - removed + 1 <= quota.team_limit) &&
        (quota.total_limit === null ||
          quota.total_used - removed + 1 <= quota.total_limit)));
  const replacements: Row[] = [];
  if (fits()) return { policy, replacements };
  if (
    policy.auto_destroy &&
    owner !== "shared" &&
    c.resource_type === "container"
  ) {
    const candidates = await db.query(
      `SELECT i.id,i.challenge_id,c.title,i.spec FROM instances i JOIN challenges c ON c.id=i.challenge_id WHERE i.owner_key=$1 AND i.scope=$2 AND i.resource_type='container' AND i.kind='dynamic_container' AND NOT coalesce((i.spec->>'awd')::boolean,false) AND i.status IN ('queued','starting','running') AND NOT EXISTS(SELECT 1 FROM rate_limits r WHERE r.key='resource:'||i.owner_key||':'||i.scope||':'||i.challenge_id AND r.expires_at>now()) ORDER BY i.created_at,i.id LIMIT 100`,
      [owner, scope],
    );
    for (const old of candidates) {
      replacements.push(old);
      const footprint = containerFootprint(old.spec);
      usage.n -= footprint.containers;
      usage.owned--;
      usage.cpu -= footprint.cpu;
      usage.memory -= footprint.memory;
      removed++;
      if (fits()) return { policy, replacements };
    }
  }
  if (quota?.blocked) fail(409, quota.blocked.message, quota.blocked.action);
  return fail(
    409,
    policy.max_owner_instances !== null &&
      usage.owned + removed >= policy.max_owner_instances
      ? "已达到个人或战队环境数量上限"
      : "资源池已满，请稍后重试",
    {
      label: "管理我的靶机",
      href:
        scope === "practice"
          ? "/instances?scope=practice"
          : `/contests/${scope}/instances`,
    },
  );
}
