import { getSetting } from "./settings.js";
import { notifyContest } from "./activity-events.js";
import { isContestPractice } from "./contest-practice.js";
import type { DB, Row } from "./db.js";
import { recordRoundSubmission } from "./rounds.js";
import { ownerPermissions, requirePermission } from "./group-permissions.js";

// Caller holds the per-owner challenge lock. Unique constraints are the final duplicate guard.
export async function creditSolve(
  db: DB,
  challenge: Row,
  scope: string,
  owner: string,
  user: string,
  unit?: Row,
) {
  const permissions = await ownerPermissions(db, scope, owner, challenge.id);
  requirePermission(permissions, "view");
  requirePermission(permissions, "submit");
  const [contest] =
    scope === "practice"
      ? []
      : await db.query(
          "SELECT practice_mode,ends_at FROM contests WHERE id=$1",
          [scope],
        );
  const practice = challenge.contest_practice ?? isContestPractice(contest);
  const parts = await db.query(
    "SELECT id FROM challenge_parts WHERE challenge_id=$1",
    [challenge.id],
  );
  let already = false;
  if (unit?.id) {
    const rows = await db.query(
      "INSERT INTO part_solves(id,part_id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
      [
        crypto.randomUUID(),
        unit.id,
        challenge.id,
        scope,
        owner,
        user,
        practice,
      ],
    );
    already = !rows.length;
  }
  const newRoundCredit =
    !practice &&
    (await recordRoundSubmission(
      db,
      challenge,
      scope,
      owner,
      user,
      unit?.id ?? challenge.id,
    ));
  const [progress] = await db.query(
    "SELECT count(*)::int n FROM part_solves WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3",
    [challenge.id, scope, owner],
  );
  const completed = !parts.length || progress!.n === parts.length;
  if (completed) {
    const rows = await db.query(
      "INSERT INTO solves(id,challenge_id,scope,owner_key,user_id,contest_practice) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
      [crypto.randomUUID(), challenge.id, scope, owner, user, practice],
    );
    if (!parts.length) already = !rows.length;
    if (
      rows.length &&
      challenge.challenge_type !== "awd" &&
      challenge.contest_scoring?.mode !== "round" &&
      (await getSetting(db, "containers")).destroy_on_solve
    ) {
      await db.query(
        "UPDATE instances SET status='stopping',updated_at=now() WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND owner_key<>'shared' AND resource_type='container' AND NOT coalesce((spec->>'awd')::boolean,false) AND status IN ('queued','starting','running')",
        [challenge.id, scope, owner],
      );
    }
  }
  if (!already) await notifyContest(db, scope);
  return {
    correct: true,
    already_solved:
      !practice &&
      challenge.contest_scoring?.mode === "round" &&
      challenge.contest_scoring.round?.carry === false
        ? !newRoundCredit
        : already,
    completed,
    part_id: unit?.id ?? null,
    part_title: unit?.title ?? null,
    solved_parts: parts.length ? progress!.n : 1,
    total_parts: parts.length || 1,
  };
}
