import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { audit, type DB, type Row } from "./db.js";
import { requireAdmin } from "./auth.js";
import { id, page } from "./schemas.js";
import { flagHash, fail } from "./security.js";
import { flagForInstance } from "./flag-environment.js";
import { notifyContest } from "./activity-events.js";
import { submissionLog } from "./submission-log.js";

// Store fingerprints, never Flag values. Only private, successfully issued CTF resources qualify.
export async function recordIssuedFlags(db: DB, instance: Row) {
  if (
    !id.safeParse(instance.scope).success ||
    !instance.owner_key.startsWith("t:") ||
    (instance.spec.flag_mode ??
      (instance.kind.startsWith("dynamic") ? "dynamic" : "static")) !==
      "dynamic"
  )
    return;
  const [challenge] = await db.query(
    "SELECT challenge_type FROM challenges WHERE id=$1",
    [instance.challenge_id],
  );
  if (!challenge || challenge.challenge_type === "awd") return;
  const parts: (string | null)[] = instance.spec.parts?.length
    ? instance.spec.parts
    : [null];
  for (const part of parts)
    await db.query(
      "INSERT INTO issued_flags(contest_id,challenge_id,part_key,owner_key,flag_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        instance.scope,
        instance.challenge_id,
        part ?? "",
        instance.owner_key,
        flagHash(flagForInstance(instance, part ?? undefined)),
      ],
    );
}
export async function recordFlagAnomaly(
  db: DB,
  submission: string,
  scope: string,
  challenge: string,
  owner: string,
  hash: string,
) {
  if (scope === "practice") return;
  await db.query(
    `INSERT INTO integrity_events(id,contest_id,submission_id,source_team_id,part_key)
    SELECT $1,$2,s.id,t.id,f.part_key FROM issued_flags f JOIN teams t ON f.owner_key='t:'||t.id JOIN submissions s ON s.id=$3
    WHERE f.contest_id=$2 AND f.challenge_id=$4 AND f.flag_hash=$5 AND f.owner_key<>$6
    ORDER BY f.created_at LIMIT 1 ON CONFLICT(submission_id) DO NOTHING`,
    [crypto.randomUUID(), scope, submission, challenge, hash, owner],
  );
}
const events = `SELECT s.id,'submission'::text type,s.created_at,s.owner_key,s.user_id,s.challenge_id,s.part_id,s.correct,NULL::text detail FROM submissions s WHERE s.scope=$1
 UNION ALL SELECT r.id,'release',r.created_at,NULL,NULL,r.challenge_id,NULL,NULL,NULL FROM contest_releases r WHERE r.contest_id=$1::uuid
 UNION ALL SELECT n.id,n.type,n.created_at,NULL,NULL,n.challenge_id,NULL,NULL,NULL FROM contest_notices n WHERE n.contest_id=$1::uuid
 UNION ALL SELECT a.id,'registration',a.created_at,'t:'||split_part(a.target,':',2),a.actor_id,NULL,NULL,NULL,a.action FROM audit_logs a WHERE a.target LIKE $1||':%' AND a.action LIKE 'registration.%'
 UNION ALL SELECT j.id,'judge',j.updated_at,j.owner_key,j.requested_by,j.challenge_id,NULL,NULL,j.status FROM judge_jobs j WHERE j.scope=$1`;
export async function monitorRevision(db: DB, scope: string) {
  const [row] = await db.query(
    `SELECT
    (SELECT id FROM submissions WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 1) submission,
    (SELECT max(created_at) FROM contest_releases WHERE contest_id=$1::uuid) release,
    (SELECT max(created_at) FROM contest_notices WHERE contest_id=$1::uuid) notice,
    (SELECT max(reviewed_at) FROM registrations WHERE contest_id=$1::uuid) review,
    (SELECT max(created_at) FROM registrations WHERE contest_id=$1::uuid) registration,
    (SELECT count(*)::int FROM registrations WHERE contest_id=$1::uuid) teams,
    (SELECT max(updated_at) FROM integrity_events WHERE contest_id=$1::uuid) integrity,
    (SELECT max(updated_at) FROM judge_jobs WHERE scope=$1) judge,
    (SELECT max(updated_at) FROM contest_writeups WHERE contest_id=$1::uuid) writeup`,
    [scope],
  );
  return { revision: JSON.stringify(row) };
}
const clueSelect = `SELECT e.*,s.flag_cipher,s.user_id,s.challenge_id,s.created_at submitted_at,u.username,c.title challenge_title,p.title part_title,t.id team_id,t.name team_name,src.name source_team_name,reviewer.username reviewer FROM integrity_events e JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.user_id JOIN challenges c ON c.id=s.challenge_id LEFT JOIN challenge_parts p ON p.id::text=e.part_key JOIN teams t ON s.owner_key='t:'||t.id JOIN teams src ON src.id=e.source_team_id LEFT JOIN users reviewer ON reviewer.id=e.reviewed_by`;
export function contestMonitorRoutes(app: FastifyInstance, db: DB) {
  async function contest(cid: string) {
    const [c] = await db.query("SELECT id,title FROM contests WHERE id=$1", [
      cid,
    ]);
    if (!c) fail(404, "比赛不存在");
    return c;
  }
  app.get("/api/admin/contests/:id/activity", async (req) => {
    requireAdmin(req);
    const scope = id.parse((req.params as any).id),
      p = page
        .extend({
          type: z
            .enum([
              "submission",
              "release",
              "withdraw",
              "hint",
              "registration",
              "judge",
            ])
            .optional(),
          correct: z.enum(["true", "false"]).optional(),
        })
        .parse(req.query);
    const c = await contest(scope),
      params = [
        scope,
        p.type ?? null,
        p.q.trim(),
        p.correct === undefined ? null : p.correct === "true",
      ];
    const where = `($2::text IS NULL OR e.type=$2) AND ($3='' OR strpos(lower(coalesce(t.name,'')||' '||coalesce(u.username,'')||' '||coalesce(c.title,'')),lower($3))>0) AND ($4::boolean IS NULL OR e.correct=$4)`;
    const from = `FROM (${events}) e LEFT JOIN teams t ON e.owner_key='t:'||t.id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN challenges c ON c.id=e.challenge_id LEFT JOIN challenge_parts p ON p.id=e.part_id WHERE ${where}`;
    const [count] = await db.query(
      `SELECT count(*)::int total ${from}`,
      params,
    );
    return {
      contest: c,
      page: p.page,
      page_size: 10,
      total: count!.total,
      items: (
        await db.query(
          `SELECT e.*,(SELECT s.flag_cipher FROM submissions s WHERE s.id=e.id) flag_cipher,coalesce((SELECT s.contest_practice FROM submissions s WHERE s.id=e.id),false) contest_practice,t.name team_name,t.id team_id,u.username,c.title challenge_title,p.title part_title ${from} ORDER BY e.created_at DESC,e.id DESC LIMIT 10 OFFSET $5`,
          [...params, (p.page - 1) * 10],
        )
      ).map(submissionLog),
    };
  });
  app.get("/api/admin/contests/:id/integrity", async (req) => {
    requireAdmin(req);
    const scope = id.parse((req.params as any).id),
      p = page
        .extend({
          status: z.enum(["open", "confirmed", "dismissed"]).optional(),
        })
        .parse(req.query);
    const c = await contest(scope),
      params = [scope, p.status ?? null, p.q.trim()];
    const where = `e.contest_id=$1 AND ($2::text IS NULL OR e.status=$2) AND ($3='' OR strpos(lower(t.name||' '||src.name||' '||c.title||' '||u.username),lower($3))>0)`;
    const [count] = await db.query(
      `SELECT count(*)::int total FROM (${clueSelect} WHERE ${where}) entries`,
      params,
    );
    return {
      contest: c,
      page: p.page,
      page_size: 10,
      total: count!.total,
      items: (
        await db.query(
          `${clueSelect} WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT 10 OFFSET $4`,
          [...params, (p.page - 1) * 10],
        )
      ).map(submissionLog),
    };
  });
  app.get("/api/admin/contests/:id/integrity/:event", async (req) => {
    requireAdmin(req);
    const scope = id.parse((req.params as any).id),
      event = id.parse((req.params as any).event);
    const [row] = await db.query(
      `${clueSelect} WHERE e.contest_id=$1 AND e.id=$2`,
      [scope, event],
    );
    if (!row) fail(404, "线索不存在");
    return submissionLog(row!);
  });
  app.put("/api/admin/contests/:id/integrity/:event", async (req) => {
    const admin = requireAdmin(req),
      scope = id.parse((req.params as any).id),
      event = id.parse((req.params as any).event);
    const input = z
      .object({
        status: z.enum(["open", "confirmed", "dismissed"]),
        note: z.string().trim().min(1, "请填写核实说明").max(1000),
      })
      .strict()
      .parse(req.body);
    return db.transaction(async (tx) => {
      const rows = await tx.query(
        "UPDATE integrity_events SET status=$3,note=$4,reviewed_by=$5,updated_at=now() WHERE contest_id=$1 AND id=$2 RETURNING id",
        [scope, event, input.status, input.note, admin.id],
      );
      if (!rows.length) fail(404, "线索不存在");
      await tx.query(
        "INSERT INTO integrity_reviews(id,event_id,actor_id,status,note) VALUES($1,$2,$3,$4,$5)",
        [crypto.randomUUID(), event, admin.id, input.status, input.note],
      );
      await audit(
        tx,
        admin.id,
        `integrity.${input.status}`,
        `${scope}:${event}`,
      );
      await notifyContest(tx, scope);
      return { ok: true };
    });
  });
  app.get("/api/admin/contests/:id/integrity/:event/reviews", async (req) => {
    requireAdmin(req);
    const scope = id.parse((req.params as any).id),
      event = id.parse((req.params as any).event),
      p = page.parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM integrity_reviews r JOIN integrity_events e ON e.id=r.event_id WHERE e.contest_id=$1 AND e.id=$2",
      [scope, event],
    );
    return {
      total: count!.total,
      items: await db.query(
        "SELECT r.id,r.status,r.note,r.created_at,u.username FROM integrity_reviews r JOIN integrity_events e ON e.id=r.event_id JOIN users u ON u.id=r.actor_id WHERE e.contest_id=$1 AND e.id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 10 OFFSET $3",
        [scope, event, (p.page - 1) * 10],
      ),
    };
  });
}
