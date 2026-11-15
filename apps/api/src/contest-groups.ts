import type { DB } from "./db.js";
import { fail } from "./security.js";
import {
  effectivePermissions,
  allPermissions,
  permissionSQL,
  type GroupPermissions,
} from "./group-permissions.js";
import { seal } from "./settings.js";
import { notifyContest } from "./activity-events.js";

export async function ensureDefaultContestGroup(db: DB, contest: string) {
  await db.query(
    "INSERT INTO contest_groups(id,contest_id,name,description,position,is_default) VALUES($1,$2,'默认组别','',-1,true) ON CONFLICT DO NOTHING",
    [crypto.randomUUID(), contest],
  );
  const [group] = await db.query(
    "SELECT * FROM contest_groups WHERE contest_id=$1 AND is_default",
    [contest],
  );
  await db.query(
    "UPDATE registrations SET group_id=$2 WHERE contest_id=$1 AND group_id IS NULL",
    [contest, group!.id],
  );
  return group!;
}

export async function saveContestGroups(
  db: DB,
  contest: string,
  input:
    | {
        id?: string;
        invite_code?: string;
        review_mode?: "inherit" | "auto" | "required";
        name: string;
        description: string;
        permissions?: Partial<GroupPermissions>;
        challenge_permissions?: Record<string, Partial<GroupPermissions>>;
      }[]
    | undefined,
) {
  const defaultGroup = await ensureDefaultContestGroup(db, contest);
  if (input === undefined) return;
  const defaultInput = input.find((g) => g.id === defaultGroup.id);
  if (
    defaultInput &&
    (!!defaultInput.invite_code ||
      defaultInput.name !== defaultGroup.name ||
      defaultInput.description !== "" ||
      (defaultInput.review_mode !== undefined &&
        defaultInput.review_mode !== "inherit") ||
      Object.entries(defaultInput.permissions ?? {}).some(
        ([key, value]) =>
          value !== allPermissions[key as keyof GroupPermissions],
      ) ||
      Object.keys(defaultInput.challenge_permissions ?? {}).length > 0)
  )
    fail(400, "默认组别沿用比赛设置，不能单独修改");
  input = input.filter((g) => g.id !== defaultGroup.id);
  if (input.length > 20) fail(400, "自定义组别最多 20 个");
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
      invite_code_cipher:
        g.invite_code === undefined
          ? (previous?.invite_code_cipher ?? "")
          : seal(g.invite_code.trim()),
      review_mode:
        g.review_mode ??
        (g.permissions?.require_review === undefined
          ? (previous?.review_mode ?? "inherit")
          : g.permissions.require_review
            ? "required"
            : "inherit"),
      permissions: { ...effectivePermissions(previous), ...g.permissions },
      challenge_permissions: Object.fromEntries(
        Object.entries(
          g.challenge_permissions ?? previous?.challenge_permissions ?? {},
        ).filter(([id]) => selected.some((c) => c.challenge_id === id)),
      ),
    };
    next.permissions.require_review = next.review_mode === "required";
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
  // Keep the registration and its review/form history; only its group changes.
  await db.query(
    "UPDATE registrations SET group_id=$3 WHERE contest_id=$1 AND group_id<>$3 AND NOT(group_id=ANY($2::uuid[]))",
    [contest, ids, defaultGroup.id],
  );
  await db.query(
    "DELETE FROM contest_groups WHERE contest_id=$1 AND NOT is_default AND NOT(id=ANY($2::uuid[]))",
    [contest, ids],
  );
  for (const [i, g] of normalized.entries())
    await db.query(
      "INSERT INTO contest_groups(id,contest_id,name,description,position,permissions,challenge_permissions,review_mode,invite_code_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=$3,description=$4,position=$5,permissions=$6,challenge_permissions=$7,review_mode=$8,invite_code_cipher=$9",
      [
        ids[i],
        contest,
        g.name,
        g.description,
        i,
        JSON.stringify(g.permissions),
        JSON.stringify(g.challenge_permissions),
        g.review_mode,
        g.invite_code_cipher,
      ],
    );
  await db.query(
    `UPDATE instances i SET status='stopping',updated_at=now() FROM registrations r LEFT JOIN contest_groups g ON g.id=r.group_id WHERE i.scope=$1::text AND r.contest_id=$1::uuid AND i.owner_key='t:'||r.team_id AND i.status IN ('queued','starting','running','ready') AND (NOT ${permissionSQL("g", "i.challenge_id", "view")} OR NOT ${permissionSQL("g", "i.challenge_id", "resources")})`,
    [contest],
  );
  await notifyContest(db, contest);
}
