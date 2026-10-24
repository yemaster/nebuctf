import type { DB } from "./db.js";
import { fail } from "./security.js";
import {
  effectivePermissions,
  permissionSQL,
  type GroupPermissions,
} from "./group-permissions.js";
import { notifyContest } from "./activity-events.js";
export async function saveContestGroups(
  db: DB,
  contest: string,
  input:
    | {
        id?: string;
        name: string;
        description: string;
        permissions?: Partial<GroupPermissions>;
        challenge_permissions?: Record<string, Partial<GroupPermissions>>;
      }[]
    | undefined,
) {
  if (input === undefined) return;
  const old = await db.query(
    "SELECT * FROM contest_groups WHERE contest_id=$1 ORDER BY position",
    [contest],
  );
  if (new Set(input.map((g) => g.name)).size !== input.length)
    fail(400, "组别名称不能重复");
  if (
    new Set(input.filter((g) => g.id).map((g) => g.id)).size !==
    input.filter((g) => g.id).length
  )
    fail(400, "组别 ID 不能重复");
  if (input.some((g) => g.id && !old.some((o) => o.id === g.id)))
    fail(400, "组别不属于此比赛");
  const registered =
    (
      await db.query(
        "SELECT 1 FROM registrations WHERE contest_id=$1 LIMIT 1",
        [contest],
      )
    ).length > 0;
  if (
    registered &&
    (input.length !== old.length ||
      input.some((g) => !g.id || !old.some((o) => o.id === g.id)))
  )
    fail(409, "已有报名，不能增删组别");
  const ids = input.map((g) => g.id ?? crypto.randomUUID());
  const selected = await db.query(
    "SELECT challenge_id FROM contest_challenges WHERE contest_id=$1",
    [contest],
  );
  const [event] = await db.query("SELECT starts_at FROM contests WHERE id=$1", [
    contest,
  ]);
  const started = new Date(event!.starts_at).getTime() <= Date.now();
  const normalized = input.map((g) => {
    const previous = old.find((o) => o.id === g.id);
    if (
      Object.keys(g.challenge_permissions ?? {}).some(
        (id) => !selected.some((c) => c.challenge_id === id),
      )
    )
      fail(400, "单题权限只能配置本场比赛的赛题");
    const next = {
      ...g,
      permissions: { ...effectivePermissions(previous), ...g.permissions },
      challenge_permissions: Object.fromEntries(
        Object.entries(
          g.challenge_permissions ?? previous?.challenge_permissions ?? {},
        ).filter(([id]) => selected.some((c) => c.challenge_id === id)),
      ),
    };
    if (started && previous) {
      if (
        (["rank_overall", "score", "blood", "dynamic"] as const).some(
          (key) =>
            effectivePermissions(previous)[key] !== next.permissions[key],
        ) ||
        selected.some((c) =>
          ["score", "blood", "dynamic"].some(
            (key) =>
              effectivePermissions(previous, c.challenge_id)[
                key as keyof GroupPermissions
              ] !==
              effectivePermissions(next, c.challenge_id)[
                key as keyof GroupPermissions
              ],
          ),
        )
      )
        fail(409, "开赛后不能更改分组的计分、全局排名、三血或动态分值权限");
    }
    return next;
  });
  await db.query(
    "DELETE FROM contest_groups WHERE contest_id=$1 AND NOT(id=ANY($2::uuid[]))",
    [contest, ids],
  );
  for (const [i, g] of normalized.entries())
    await db.query(
      "INSERT INTO contest_groups(id,contest_id,name,description,position,permissions,challenge_permissions) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=$3,description=$4,position=$5,permissions=$6,challenge_permissions=$7",
      [
        ids[i],
        contest,
        g.name,
        g.description,
        i,
        JSON.stringify(g.permissions),
        JSON.stringify(g.challenge_permissions),
      ],
    );
  await db.query(
    `UPDATE instances i SET status='stopping',updated_at=now() FROM registrations r LEFT JOIN contest_groups g ON g.id=r.group_id WHERE i.scope=$1::text AND r.contest_id=$1::uuid AND i.owner_key='t:'||r.team_id AND i.status IN ('queued','starting','running','ready') AND (NOT ${permissionSQL("g", "i.challenge_id", "view")} OR NOT ${permissionSQL("g", "i.challenge_id", "resources")})`,
    [contest],
  );
  await notifyContest(db, contest);
}
