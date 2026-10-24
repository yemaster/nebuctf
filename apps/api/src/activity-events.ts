import type { DB } from "./db.js";
export async function notifyContest(db: DB, scope: string) {
  if (scope !== "practice")
    await db.query("SELECT pg_notify('nebuctf_activity',$1)", [scope]);
}
export async function recordContestNotice(
  db: DB,
  contest: string,
  challenge: string,
  type: "withdraw" | "hint",
) {
  const [c] = await db.query(
    `SELECT c.title,jsonb_array_length(c.hints) hint_count FROM challenges c JOIN contests g ON g.id=$1 WHERE c.id=$2 AND g.published AND g.starts_at<=now() AND g.ends_at>now()`,
    [contest, challenge],
  );
  if (!c) return;
  if (type === "hint") {
    const [visible] = await db.query(
      "SELECT 1 FROM contest_challenges cc JOIN challenges c ON c.id=cc.challenge_id WHERE cc.contest_id=$1 AND cc.challenge_id=$2 AND cc.published AND c.published AND (cc.release_at IS NULL OR cc.release_at<=now())",
      [contest, challenge],
    );
    if (!visible) return;
  }
  await db.query(
    "INSERT INTO contest_notices(id,contest_id,challenge_id,type,challenge_title,hint_count) VALUES($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), contest, challenge, type, c.title, c.hint_count],
  );
  await notifyContest(db, contest);
}
