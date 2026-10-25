import type { DB, Row } from "./db.js";
import { notifyContest } from "./activity-events.js";
import { effectivePoints, phaseWindow } from "./competition-rules.js";
import { score } from "./security.js";
import { permissionSQL } from "./group-permissions.js";

// Rounds are wall-clock intervals, anchored at this challenge's release inside the practical window.
export function roundWindow(
  contest: Row,
  link: Row,
  number?: number,
  now = Date.now(),
) {
  const phase = phaseWindow(contest, "practical");
  const start = Math.max(
    Date.parse(phase.opens_at),
    link.release_at ? new Date(link.release_at).getTime() : 0,
  );
  const end = Date.parse(phase.closes_at),
    duration = link.scoring.round.interval * 1000;
  const n = number ?? Math.floor((now - start) / duration) + 1;
  const opens = start + (n - 1) * duration;
  if (n < 1 || opens >= end || opens > now) return null;
  return {
    number: n,
    starts_at: new Date(opens),
    ends_at: new Date(Math.min(opens + duration, end)),
  };
}
export async function ensureRound(
  db: DB,
  contest: Row,
  link: Row,
  number?: number,
  now = Date.now(),
) {
  const window = roundWindow(contest, link, number, now);
  if (!window) return null;
  const [round] = await db.query(
    `INSERT INTO contest_rounds(id,contest_id,challenge_id,number,starts_at,ends_at,settings) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(contest_id,challenge_id,number) DO UPDATE SET number=excluded.number RETURNING *`,
    [
      crypto.randomUUID(),
      contest.id,
      link.challenge_id,
      window.number,
      window.starts_at,
      window.ends_at,
      JSON.stringify(link.scoring),
    ],
  );
  return round!;
}
export async function recordRoundSubmission(
  db: DB,
  challenge: Row,
  scope: string,
  owner: string,
  user: string,
  unit: string,
) {
  if (scope === "practice" || challenge.contest_scoring?.mode !== "round")
    return;
  const [contest] = await db.query("SELECT * FROM contests WHERE id=$1", [
    scope,
  ]);
  const [link] = await db.query(
    "SELECT * FROM contest_challenges WHERE contest_id=$1 AND challenge_id=$2",
    [scope, challenge.id],
  );
  const round = await ensureRound(db, contest!, link!);
  if (
    !round ||
    new Date(round.ends_at).getTime() <= Date.now() ||
    round.status !== "open"
  )
    return;
  const inserted = await db.query(
    "INSERT INTO round_submissions(id,round_id,unit_id,owner_key,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
    [crypto.randomUUID(), round.id, unit, owner, user],
  );
  return inserted.length > 0;
}

export async function settleRound(
  db: DB,
  round: Row,
  challenge: Row,
  now = Date.now(),
) {
  await db.query("SELECT id FROM contest_rounds WHERE id=$1 FOR UPDATE", [
    round.id,
  ]);
  const [state] = await db.query(
    "SELECT status FROM contest_rounds WHERE id=$1",
    [round.id],
  );
  if (state!.status === "settled" || new Date(round.ends_at).getTime() > now)
    return false;
  if (challenge.challenge_type === "awd") return false; // The AWD controller settles only after checks and the flag lifetime expire.
  const units = await db.query(
    "SELECT * FROM challenge_parts WHERE challenge_id=$1 ORDER BY position",
    [challenge.id],
  );
  for (const raw of units.length ? units : [challenge]) {
    const part = raw.id !== challenge.id;
    const eligible =
      round.settings.round.carry !== false
        ? await db.query(
            `SELECT s.owner_key,s.user_id,${permissionSQL("g", "$4::uuid", "score")} get_score,${permissionSQL("g", "$4::uuid", "dynamic")} affect_dynamic FROM ${part ? "part_solves" : "solves"} s JOIN ranked_registrations r ON 't:'||r.team_id=s.owner_key AND r.contest_id=$2 LEFT JOIN contest_groups g ON g.id=r.group_id WHERE s.${part ? "part_id" : "challenge_id"}=$1 AND s.scope=$2::text AND NOT s.contest_practice AND s.created_at<$3 AND r.created_at<$3`,
            [raw.id, round.contest_id, round.ends_at, challenge.id],
          )
        : await db.query(
            `SELECT s.owner_key,s.user_id,${permissionSQL("g", "$4::uuid", "score")} get_score,${permissionSQL("g", "$4::uuid", "dynamic")} affect_dynamic FROM round_submissions s JOIN ranked_registrations r ON 't:'||r.team_id=s.owner_key AND r.contest_id=$3 LEFT JOIN contest_groups g ON g.id=r.group_id WHERE s.round_id=$1 AND s.unit_id=$2`,
            [round.id, raw.id, round.contest_id, challenge.id],
          );
    const points = effectivePoints(
      {
        ...raw,
        decay: challenge.decay,
        dynamic_score: challenge.dynamic_score,
      },
      round.settings,
      part ? raw.id : undefined,
    );
    const earned = score(
      points.initial_points,
      points.minimum_points,
      points.decay,
      eligible.filter((t) => t.affect_dynamic).length,
      points.dynamic_score,
    );
    for (const owner of eligible) {
      // A team's flexible deadline applies to every scoring tick, including carried solves.
      const [attempt] = await db.query(
        "SELECT deadline_at FROM contest_attempts WHERE contest_id=$1 AND team_id=$2 AND section='practical'",
        [round.contest_id, owner.owner_key.slice(2)],
      );
      if (
        attempt &&
        new Date(attempt.deadline_at).getTime() <
          new Date(round.ends_at).getTime()
      )
        continue;
      await db.query(
        "INSERT INTO round_results(id,round_id,owner_key,unit_id,points,details,user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [
          crypto.randomUUID(),
          round.id,
          owner.owner_key,
          raw.id,
          owner.get_score ? earned : 0,
          JSON.stringify({
            kind: part ? raw.role : "solve",
            solves: eligible.filter((t) => t.affect_dynamic).length,
            mode: round.settings.round.carry === false ? "submit" : "carry",
          }),
          owner.user_id,
          new Date(now),
        ],
      );
    }
  }
  await db.query(
    "UPDATE contest_rounds SET status='settled',settled_at=$2 WHERE id=$1",
    [round.id, new Date(now)],
  );
  await notifyContest(db, round.contest_id);
  return true;
}

export async function tickRounds(db: DB, now = Date.now()) {
  const links = await db.query(
    `SELECT cc.*,row_to_json(c) challenge,row_to_json(g) contest FROM contest_challenges cc JOIN contests g ON g.id=cc.contest_id JOIN challenges c ON c.id=cc.challenge_id WHERE cc.scoring->>'mode'='round' AND cc.published AND g.published AND c.published AND g.starts_at<=$1`,
    [new Date(now)],
  );
  for (const link of links) {
    if (link.challenge.challenge_type === "awd") continue;
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `rounds:${link.contest_id}:${link.challenge_id}`,
      ]);
      const [last] = await tx.query(
        "SELECT coalesce(max(number),0)::int n FROM contest_rounds WHERE contest_id=$1 AND challenge_id=$2 AND status='settled'",
        [link.contest_id, link.challenge_id],
      );
      for (let n = last!.n + 1; n <= last!.n + 64; n++) {
        const round = await ensureRound(tx, link.contest, link, n, now);
        if (!round || !(await settleRound(tx, round, link.challenge, now)))
          break;
      }
    });
  }
}
