import { snapshotContestMembers } from "./writeup-config.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin } from "./auth.js";
import { id, page } from "./schemas.js";
import { fail } from "./security.js";
import { notifyContest } from "./activity-events.js";

export const registrationStatus = z.enum([
  "pending",
  "accepted",
  "rejected",
  "suspended",
]);
export function requireAccepted(status: string, scope: string) {
  if (status !== "accepted")
    fail(
      403,
      status === "pending"
        ? "报名正在审核中"
        : status === "suspended"
          ? "参赛资格已暂停"
          : "报名未通过审核",
      { label: "查看报名状态", href: `/contests/${scope}` },
    );
}
const summary = `SELECT r.*,t.name,t.captain_id,u.username captain,(SELECT count(*)::int FROM memberships m WHERE m.team_id=t.id) member_count,g.name group_name FROM registrations r JOIN teams t ON t.id=r.team_id JOIN users u ON u.id=t.captain_id LEFT JOIN contest_groups g ON g.id=r.group_id`;
export function registrationRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/admin/contests/:id/registrations", async (req) => {
    requireAdmin(req);
    const cid = id.parse((req.params as any).id),
      p = page
        .extend({ status: registrationStatus.optional(), group: id.optional() })
        .parse(req.query);
    const [contest] = await db.query(
      "SELECT id,title,starts_at,ends_at FROM contests WHERE id=$1",
      [cid],
    );
    if (!contest) fail(404, "比赛不存在");
    const params = [cid, p.q.trim(), p.status ?? null, p.group ?? null];
    const where = `r.contest_id=$1 AND ($2='' OR strpos(lower(t.name),lower($2))>0 OR strpos(lower(u.username),lower($2))>0) AND ($3::text IS NULL OR r.status=$3) AND ($4::uuid IS NULL OR r.group_id=$4)`;
    const [count] = await db.query(
      `SELECT count(*)::int total FROM registrations r JOIN teams t ON t.id=r.team_id JOIN users u ON u.id=t.captain_id WHERE ${where}`,
      params,
    );
    return {
      contest,
      page: p.page,
      page_size: 10,
      total: count!.total,
      counts: await db.query(
        "SELECT status,count(*)::int count FROM registrations WHERE contest_id=$1 GROUP BY status",
        [cid],
      ),
      items: await db.query(
        `${summary} WHERE ${where} ORDER BY r.created_at DESC,r.team_id LIMIT 10 OFFSET $5`,
        [...params, (p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/admin/contests/:id/registrations/:team", async (req) => {
    requireAdmin(req);
    const cid = id.parse((req.params as any).id),
      team = id.parse((req.params as any).team);
    const [row] = await db.query(
      `${summary} WHERE r.contest_id=$1 AND r.team_id=$2`,
      [cid, team],
    );
    if (!row) fail(404, "报名记录不存在");
    return {
      ...row,
      members: await db.query(
        `WITH roster AS (
          SELECT user_id FROM memberships WHERE team_id=$1
          UNION SELECT user_id FROM contest_members WHERE team_id=$1 AND contest_id=$2
        )
        SELECT u.id,u.username,u.avatar_id,u.email,u.disabled,u.created_at,u.role,
          u.real_name,u.student_number,u.phone,u.email_verified_at,
          u.id=t.captain_id captain,
          EXISTS(SELECT 1 FROM memberships m WHERE m.team_id=$1 AND m.user_id=u.id) current_member,
          EXISTS(SELECT 1 FROM contest_members m WHERE m.team_id=$1 AND m.contest_id=$2 AND m.user_id=u.id) registered
        FROM roster JOIN users u ON u.id=roster.user_id JOIN teams t ON t.id=$1
        ORDER BY captain DESC,u.username,u.id`,
        [team, cid],
      ),
    };
  });
  app.put("/api/admin/contests/:id/registrations", async (req) => {
    const admin = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    const input = z
      .object({
        team_ids: z.array(id).min(1).max(100),
        status: registrationStatus.optional(),
        group_id: id.nullable().optional(),
        review_note: z.string().trim().max(500).optional(),
      })
      .strict()
      .refine(
        (v) => v.status !== undefined || v.group_id !== undefined,
        "请选择要更改的状态或组别",
      )
      .parse(req.body);
    if (new Set(input.team_ids).size !== input.team_ids.length)
      fail(400, "战队不能重复");
    if (
      ["rejected", "suspended"].includes(input.status ?? "") &&
      !input.review_note
    )
      fail(400, "请填写原因");
    return db.transaction(async (tx) => {
      await lock(tx);
      const [contest] = await tx.query(
        "SELECT * FROM contests WHERE id=$1 FOR UPDATE",
        [cid],
      );
      if (!contest) fail(404, "比赛不存在");
      const rows = await tx.query(
        "SELECT * FROM registrations WHERE contest_id=$1 AND team_id=ANY($2::uuid[]) FOR UPDATE",
        [cid, input.team_ids],
      );
      if (rows.length !== input.team_ids.length)
        fail(404, "部分战队未报名本场比赛");
      const groups = await tx.query(
        "SELECT id FROM contest_groups WHERE contest_id=$1",
        [cid],
      );
      if (
        input.group_id !== undefined &&
        (groups.length
          ? !groups.some((g) => g.id === input.group_id)
          : input.group_id !== null)
      )
        fail(400, "请选择本场比赛的有效组别");
      for (const row of rows) {
        const status = input.status ?? row.status;
        if (
          input.group_id !== undefined &&
          input.group_id !== row.group_id &&
          new Date(contest!.starts_at).getTime() <= Date.now()
        )
          fail(409, "开赛后不能调整战队组别");
        if (
          (row.accepted_at || row.status === "accepted") &&
          ["pending", "rejected"].includes(status)
        )
          fail(409, "已通过审核的战队请使用暂停参赛");
        if (status === "accepted") {
          const [members] = await tx.query(
            "SELECT count(*)::int n,bool_or(u.disabled) disabled FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1",
            [row.team_id],
          );
          if (!members!.n || members!.n > contest!.team_limit)
            fail(409, "战队人数不符合比赛要求");
          if (members!.disabled) fail(409, "战队中有已禁用的账号");
          const overlap = await tx.query(
            "SELECT 1 FROM memberships a JOIN memberships b ON b.user_id=a.user_id JOIN registrations r ON r.team_id=b.team_id WHERE a.team_id=$1 AND r.contest_id=$2 AND r.team_id<>$1 AND r.status IN ('accepted','suspended') LIMIT 1",
            [row.team_id, cid],
          );
          if (overlap.length) fail(409, "队员已通过其他战队参加本场比赛");
        }
        await tx.query(
          "UPDATE registrations SET status=$3,group_id=$4,review_note=$5,reviewed_by=$6,reviewed_at=now(),accepted_at=CASE WHEN $3='accepted' THEN coalesce(accepted_at,now()) ELSE accepted_at END WHERE contest_id=$1 AND team_id=$2",
          [
            cid,
            row.team_id,
            status,
            input.group_id === undefined ? row.group_id : input.group_id,
            input.review_note ??
              (input.status === undefined ? row.review_note : ""),
            admin.id,
          ],
        );
        if (status === "accepted")
          await snapshotContestMembers(tx, cid, row.team_id);
        if (status !== "accepted")
          await tx.query(
            "UPDATE instances SET status='stopping',updated_at=now() WHERE scope=$1 AND owner_key=$2 AND status IN ('queued','starting','running','ready')",
            [cid, "t:" + row.team_id],
          );
        await audit(
          tx,
          admin.id,
          `registration.${status}`,
          `${cid}:${row.team_id}`,
        );
      }
      await notifyContest(tx, cid);
      return { ok: true, updated: rows.length };
    });
  });
}
