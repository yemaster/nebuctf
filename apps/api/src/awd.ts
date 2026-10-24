import { permissionSQL, ownerPermissions } from "./group-permissions.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "./db.js";
import { requireUser } from "./auth.js";
import { challengeAccess, ownerFor } from "./context.js";
import { id, scope as scopeSchema } from "./schemas.js";
import { fail, flagHash, rate } from "./security.js";
import { resourceCooldown } from "./resources.js";
export function awdRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/challenges/:id/rounds", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = id.parse((req.query as any).scope);
    const c = await challengeAccess(db, cid, scope, user);
    if (c.contest_scoring?.mode !== "round") fail(400, "此题未启用轮次计分");
    const owner = await ownerFor(db, scope, user);
    const [round] = await db.query(
      "SELECT id,number,starts_at,ends_at,status FROM contest_rounds WHERE contest_id=$1 AND challenge_id=$2 ORDER BY number DESC LIMIT 1",
      [scope, cid],
    );
    const [total] = await db.query(
      "SELECT coalesce(sum(s.points),0)::int points FROM round_results s JOIN contest_rounds r ON r.id=s.round_id WHERE r.contest_id=$1 AND r.challenge_id=$2 AND s.owner_key=$3 AND r.status='settled'",
      [scope, cid, owner],
    );
    const history = await db.query(
      "SELECT r.number,sum(s.points)::int points,max(s.created_at) created_at FROM round_results s JOIN contest_rounds r ON r.id=s.round_id WHERE r.contest_id=$1 AND r.challenge_id=$2 AND s.owner_key=$3 AND r.status='settled' GROUP BY r.number ORDER BY r.number DESC LIMIT 20",
      [scope, cid, owner],
    );
    return { round: round ?? null, total: total!.points, history };
  });
  app.get("/api/challenges/:id/arena", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = id.parse((req.query as any).scope);
    const c = await challengeAccess(db, cid, scope, user, true, "resources");
    if (c.challenge_type !== "awd") fail(400, "此题不是 AWD 题");
    const owner = await ownerFor(db, scope, user);
    const [round] = await db.query(
      "SELECT number,starts_at,ends_at,status FROM contest_rounds WHERE contest_id=$1 AND challenge_id=$2 ORDER BY number DESC LIMIT 1",
      [scope, cid],
    );
    const items = await db.query(
      `SELECT t.id team_id,t.name,i.id instance_id,i.endpoint,i.status,i.owner_key=$3 own,k.status health FROM accepted_registrations r JOIN teams t ON t.id=r.team_id LEFT JOIN contest_groups g ON g.id=r.group_id LEFT JOIN LATERAL (SELECT id,endpoint,status,owner_key FROM instances WHERE challenge_id=$2 AND scope=$1::text AND owner_key='t:'||t.id AND status IN ('queued','starting','running','stopping','failed') ORDER BY created_at DESC LIMIT 1) i ON true LEFT JOIN awd_checks k ON k.owner_key='t:'||t.id AND k.round_id=(SELECT id FROM contest_rounds WHERE contest_id=$1::uuid AND challenge_id=$2 ORDER BY number DESC LIMIT 1) WHERE r.contest_id=$1::uuid AND ${permissionSQL("g", "$2::uuid", "view")} AND ${permissionSQL("g", "$2::uuid", "resources")} ORDER BY t.name,t.id`,
      [scope, cid, owner],
    );
    const history = await db.query(
      "SELECT r.number,s.points,s.details,s.created_at FROM round_results s JOIN contest_rounds r ON r.id=s.round_id WHERE r.contest_id=$1 AND r.challenge_id=$2 AND s.owner_key=$3 ORDER BY r.number DESC LIMIT 20",
      [scope, cid, owner],
    );
    return { round: round ?? null, items, history };
  });
  app.post("/api/challenges/:id/attack", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      input = z
        .object({ scope: id, flag: z.string().min(1).max(256) })
        .parse(req.body);
    await rate(db, `awd-submit:${user.id}`, 60, 60);
    return db.transaction(async (tx) => {
      const c = await challengeAccess(
        tx,
        cid,
        input.scope,
        user,
        true,
        "submit",
      );
      if (c.challenge_type !== "awd") fail(400, "此题不是 AWD 题");
      const owner = await ownerFor(tx, input.scope, user),
        hash = flagHash(input.flag);
      const [flag] = await tx.query(
        "SELECT f.*,r.status FROM awd_flags f JOIN contest_rounds r ON r.id=f.round_id WHERE f.flag_hash=$1 AND r.contest_id=$2 AND r.challenge_id=$3 AND f.expires_at>now() AND r.status='open' FOR SHARE OF r",
        [hash, input.scope, cid],
      );
      if (!flag || flag.owner_key === owner)
        return { correct: false, already_solved: false };
      const target = await ownerPermissions(
        tx,
        input.scope,
        flag.owner_key,
        cid,
      );
      if (!target.view || !target.resources)
        return { correct: false, already_solved: false };
      const inserted = await tx.query(
        "INSERT INTO awd_attacks(id,flag_hash,attacker_key,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
        [crypto.randomUUID(), hash, owner, user.id],
      );
      return {
        correct: true,
        already_solved: !inserted.length,
        completed: false,
      };
    });
  });
  app.post("/api/challenges/:id/restart", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.body as any)?.scope);
    return db.transaction(async (tx) => {
      const c = await challengeAccess(tx, cid, scope, user, true, "resources");
      if (c.challenge_type !== "awd") fail(400, "此题不是 AWD 题");
      const owner = await ownerFor(tx, scope, user);
      await tx.query("SELECT pg_advisory_xact_lock(760002)");
      await resourceCooldown(tx, owner, scope, cid);
      await tx.query(
        "UPDATE instances SET status='stopping',updated_at=now() WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND status IN ('queued','starting','running')",
        [cid, scope, owner],
      );
      return { ok: true };
    });
  });
}
