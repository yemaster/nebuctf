import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { requireUser, requireAdmin } from "./auth.js";
import { id, page } from "./schemas.js";
import { getTeam } from "./context.js";
import { digest, fail, rate, token } from "./security.js";
import { consumeCaptcha } from "./captcha.js";
async function unlocked(db: DB, team: string) {
  if (
    (
      await db.query(
        "SELECT 1 FROM registrations r JOIN contests c ON c.id=r.contest_id WHERE r.team_id=$1 AND r.status IN ('accepted','suspended') AND c.ends_at>now() LIMIT 1",
        [team],
      )
    ).length
  )
    fail(409, "已报名未结束的比赛，暂不能变更成员");
}
export function teamRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/admin/teams", async (req) => {
    requireAdmin(req);
    const p = page
      .extend({ ids: z.string().max(19000).optional() })
      .parse(req.query);
    const ids = p.ids ? z.array(id).max(500).parse(p.ids.split(",")) : null;
    const args = [p.q.trim(), ids];
    const where =
      "($1='' OR strpos(lower(t.name),lower($1))>0) AND ($2::uuid[] IS NULL OR t.id=ANY($2::uuid[]))";
    const [count] = await db.query(
      `SELECT count(*)::int total FROM teams t WHERE ${where}`,
      args,
    );
    return {
      total: count!.total,
      page: p.page,
      page_size: ids ? 500 : 10,
      items: await db.query(
        `SELECT t.id,t.name,u.username captain,(SELECT count(*)::int FROM memberships m WHERE m.team_id=t.id) members FROM teams t JOIN users u ON u.id=t.captain_id WHERE ${where} ORDER BY t.name,t.id LIMIT $3 OFFSET $4`,
        [...args, ids ? 500 : 10, ids ? 0 : (p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/team", async (req) => {
    const u = requireUser(req),
      team = await getTeam(
        db,
        u.id,
        z.object({ team: id.optional() }).parse(req.query).team,
      );
    if (!team) return { team: null };
    const { invite_hash: _, ...safe } = team;
    return {
      team: {
        ...safe,
        members: await db.query(
          "SELECT u.id,u.username,u.avatar_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.created_at",
          [team.id],
        ),
      },
    };
  });
  app.get("/api/teams/mine", async (req) => {
    const user = requireUser(req);
    return {
      items: await db.query(
        "SELECT t.id,t.name,t.captain_id,(SELECT count(*)::int FROM memberships x WHERE x.team_id=t.id) members FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY t.created_at,t.id",
        [user.id],
      ),
    };
  });
  app.post("/api/teams", async (req) => {
    const u = requireUser(req),
      data = z
        .object({ name: z.string().trim().min(2).max(48) })
        .parse(req.body);
    await consumeCaptcha(db, req, "team-create");
    await rate(db, `team:${u.id}`, 10, 3600);
    const invite = token(),
      tid = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await lock(tx);
      const [membershipCount] = await tx.query(
        "SELECT count(*)::int n FROM memberships WHERE user_id=$1",
        [u.id],
      );
      if (membershipCount!.n >= 20)
        fail(409, "最多加入 20 支战队", { label: "管理战队", href: "/team" });
      await tx.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [tid, data.name, u.id, digest(invite)],
      );
      await tx.query("INSERT INTO memberships VALUES($1,$2)", [u.id, tid]);
      await audit(tx, u.id, "team.create", tid);
    });
    return { id: tid, invite };
  });
  app.post("/api/team/join", async (req) => {
    const u = requireUser(req),
      { invite } = z
        .object({ invite: z.string().min(20).max(100) })
        .parse(req.body);
    await consumeCaptcha(db, req, "team-join");
    await rate(db, `join:${u.id}`, 10, 600);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [membershipCount] = await tx.query(
        "SELECT count(*)::int n FROM memberships WHERE user_id=$1",
        [u.id],
      );
      if (membershipCount!.n >= 20)
        fail(409, "最多加入 20 支战队", { label: "管理战队", href: "/team" });
      const [t] = await tx.query(
        "SELECT * FROM teams WHERE invite_hash=$1 FOR UPDATE",
        [digest(invite)],
      );
      if (!t) fail(404, "邀请码无效");
      await unlocked(tx, t!.id);
      const [n] = await tx.query(
        "SELECT count(*)::int AS n FROM memberships WHERE team_id=$1",
        [t!.id],
      );
      if (n!.n >= 20) fail(409, "战队人数已满");
      await tx.query("INSERT INTO memberships VALUES($1,$2)", [u.id, t!.id]);
      await audit(tx, u.id, "team.join", t!.id);
      return { ok: true, id: t!.id };
    });
  });
  app.post("/api/team/invite", async (req) => {
    const u = requireUser(req);
    const invite = token();
    return db.transaction(async (tx) => {
      await lock(tx);
      const t = await getTeam(
        tx,
        u.id,
        z.object({ team_id: id.optional() }).parse(req.body ?? {}).team_id,
      );
      if (!t || t.captain_id !== u.id) fail(403, "仅队长可以更新邀请码");
      await tx.query("UPDATE teams SET invite_hash=$1 WHERE id=$2", [
        digest(invite),
        t!.id,
      ]);
      await audit(tx, u.id, "team.invite.rotate", t!.id);
      return { invite };
    });
  });
  app.post("/api/team/leave", async (req) => {
    const u = requireUser(req);
    return db.transaction(async (tx) => {
      await lock(tx);
      const t = await getTeam(
        tx,
        u.id,
        z.object({ team_id: id.optional() }).parse(req.body ?? {}).team_id,
      );
      if (!t) fail(404, "尚未加入战队");
      await unlocked(tx, t!.id);
      if (t!.captain_id === u.id) fail(409, "队长需先转让队长身份");
      await tx.query(
        "DELETE FROM memberships WHERE user_id=$1 AND team_id=$2",
        [u.id, t!.id],
      );
      await audit(tx, u.id, "team.leave", t!.id);
      return { ok: true };
    });
  });
  app.post("/api/team/captain", async (req) => {
    const u = requireUser(req);
    const { user_id } = z.object({ user_id: z.uuid() }).parse(req.body);
    return db.transaction(async (tx) => {
      await lock(tx);
      const t = await getTeam(
        tx,
        u.id,
        z.object({ team_id: id.optional() }).parse(req.body ?? {}).team_id,
      );
      if (!t || t.captain_id !== u.id) fail(403, "仅队长可以转让");
      await unlocked(tx, t!.id);
      if (
        !(
          await tx.query(
            "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",
            [t!.id, user_id],
          )
        ).length
      )
        fail(400, "目标用户不在战队");
      await tx.query("UPDATE teams SET captain_id=$1 WHERE id=$2", [
        user_id,
        t!.id,
      ]);
      await audit(tx, u.id, "team.captain", t!.id);
      return { ok: true };
    });
  });
}
