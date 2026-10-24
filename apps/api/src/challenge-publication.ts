import { lock, type DB } from "./db.js";
import { recordContestReleases } from "./contest-activity.js";

// Visibility everywhere follows published. The scheduler flips it atomically
// with the activity event, so a scheduled challenge cannot leak before release.
export async function publishScheduledChallenges(db: DB) {
  const links = await db.query(
    "SELECT cc.contest_id,array_agg(cc.challenge_id) ids FROM contest_challenges cc JOIN challenges c ON c.id=cc.challenge_id JOIN contests g ON g.id=cc.contest_id WHERE cc.published AND c.published AND g.published AND g.ends_at>now() AND cc.release_at<=now() AND cc.release_announced_at IS NULL GROUP BY cc.contest_id LIMIT 100",
  );
  for (const link of links)
    await db.transaction(async (tx) => {
      await lock(tx);
      const due = await tx.query(
        "SELECT challenge_id FROM contest_challenges WHERE contest_id=$1 AND challenge_id=ANY($2::uuid[]) AND release_announced_at IS NULL",
        [link.contest_id, link.ids],
      );
      await recordContestReleases(
        tx,
        link.contest_id,
        due.map((d) => d.challenge_id),
      );
    });
  const due = await db.query(
    "SELECT 1 FROM challenges WHERE NOT published AND publish_at<=now() LIMIT 1",
  );
  if (!due.length) return 0;
  return db.transaction(async (tx) => {
    await lock(tx);
    const rows = await tx.query(
      "SELECT id FROM challenges WHERE NOT published AND publish_at<=now() ORDER BY publish_at,id LIMIT 100 FOR UPDATE",
    );
    for (const row of rows) {
      await tx.query(
        "UPDATE challenges SET published=true,publish_at=NULL WHERE id=$1",
        [row.id],
      );
      const contests = await tx.query(
        "SELECT contest_id FROM contest_challenges WHERE challenge_id=$1",
        [row.id],
      );
      for (const contest of contests)
        await recordContestReleases(tx, contest.contest_id, [row.id]);
      await tx.query(
        "INSERT INTO audit_logs(id,actor_id,action,target) VALUES($1,NULL,'challenge.publish_scheduled',$2)",
        [crypto.randomUUID(), row.id],
      );
    }
    return rows.length;
  });
}
