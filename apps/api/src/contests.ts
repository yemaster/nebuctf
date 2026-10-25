import { snapshotContestMembers } from "./writeup-config.js";
import { isContestPractice } from "./contest-practice.js";
import { publicContest, checkRegistrationScope } from "./contest-entry.js";
import { registrationRoutes } from "./registrations.js";
import { notifyContest } from "./activity-events.js";
import { timingRoutes } from "./contest-timing.js";
import { scoreboardRoutes } from "./scoreboard.js";
import { contestActivityRoutes } from "./contest-activity.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { audit, lock, type DB } from "./db.js";
import { requireUser } from "./auth.js";
import { contestAccess, getTeam } from "./context.js";
import { id, page, scope as scopeSchema } from "./schemas.js";
import { fail, rate } from "./security.js";
import { effectivePermissions } from "./group-permissions.js";
export function contestRoutes(app: FastifyInstance, db: DB) {
  registrationRoutes(app, db);
  contestActivityRoutes(app, db);
  timingRoutes(app, db);
  scoreboardRoutes(app, db);
  app.get("/api/contests", async (req) => {
    const p = page.parse(req.query);
    const filter = z
      .object({
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      })
      .parse(req.query);
    if (
      (filter.from && !filter.to) ||
      (!filter.from && filter.to) ||
      (filter.from &&
        filter.to &&
        (Date.parse(filter.to) <= Date.parse(filter.from) ||
          Date.parse(filter.to) - Date.parse(filter.from) > 42 * 86400000))
    )
      fail(400, "日历范围不得超过 42 天");
    const values = [filter.from ?? null, filter.to ?? null];
    const condition =
      "published AND ($1::timestamptz IS NULL OR ends_at>$1) AND ($2::timestamptz IS NULL OR starts_at<$2)";
    const [count] = await db.query(
      `SELECT count(*)::int total FROM contests WHERE ${condition}`,
      values,
    );
    return {
      total: count!.total,
      items: (
        await db.query(
          `SELECT c.*,(SELECT count(*)::int FROM registrations r WHERE r.contest_id=c.id) teams FROM contests c WHERE ${condition} ORDER BY starts_at DESC,id LIMIT 24 OFFSET $3`,
          [...values, (p.page - 1) * 24],
        )
      ).map((c) => publicContest(c)),
      page: p.page,
    };
  });
  app.get("/api/contests/calendar", async (req) => {
    const p = z
      .object({
        from: z.iso.date(),
        to: z.iso.date(),
        zone: z.string().max(80).default("Asia/Shanghai"),
      })
      .parse(req.query);
    if (
      Date.parse(p.to) < Date.parse(p.from) ||
      Date.parse(p.to) - Date.parse(p.from) > 41 * 86400000
    )
      fail(400, "日历范围不得超过 42 天");
    try {
      new Intl.DateTimeFormat("en", { timeZone: p.zone }).format();
    } catch {
      fail(400, "时区无效");
    }
    return {
      days: await db.query(
        `SELECT to_char(d.bucket,'YYYY-MM-DD') AS "day",count(c.id)::int count FROM generate_series($1::date::timestamp,$2::date::timestamp,interval '1 day') d(bucket)
      LEFT JOIN contests c ON c.published AND c.starts_at<((d.bucket+interval '1 day') AT TIME ZONE $3) AND c.ends_at>(d.bucket AT TIME ZONE $3)
      GROUP BY d.bucket ORDER BY d.bucket`,
        [p.from, p.to, p.zone],
      ),
    };
  });
  app.get("/api/contests/:id", async (req) => {
    const cid = id.parse((req.params as any).id);
    const c = await contestAccess(db, cid, req.user ?? undefined, false);
    const [count] = await db.query<{ teams: number }>(
      "SELECT count(*)::int teams FROM registrations WHERE contest_id=$1",
      [cid],
    );
    const [registration] = req.user
      ? await db.query(
          "SELECT r.team_id,r.group_id,r.status,r.practice_only,r.review_note,r.reviewed_at,t.captain_id=$2 is_captain,t.name team_name,g.name group_name FROM registrations r JOIN teams t ON t.id=r.team_id JOIN memberships m ON m.team_id=t.id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id=$1 AND m.user_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1",
          [cid, req.user.id],
        )
      : [];
    return {
      ...publicContest(c!),
      eligible_team_ids:
        c!.registration_mode === "teams" && req.user
          ? (
              await db.query(
                "SELECT team_id FROM memberships WHERE user_id=$1 AND team_id=ANY($2::uuid[])",
                [req.user.id, c!.registration_team_ids],
              )
            ).map((t) => t.team_id)
          : null,
      teams: count!.teams,
      registered: registration?.status === "accepted",
      viewer_role:
        req.user?.role === "admin"
          ? "staff"
          : registration?.status === "accepted"
            ? "participant"
            : "spectator",
      practice_active: isContestPractice(c),
      writeup_access:
        !!c!.writeup?.enabled &&
        !!req.user &&
        !!(
          await db.query(
            "SELECT 1 FROM contest_members m JOIN registrations r USING(contest_id,team_id) WHERE m.contest_id=$1 AND m.user_id=$2 AND r.status='accepted'",
            [cid, req.user?.id ?? null],
          )
        ).length,
      registration: registration ?? null,
      groups: await db.query(
        "SELECT id,name,description,coalesce((permissions->>'join')::boolean,true) joinable,coalesce((permissions->>'rank_overall')::boolean,true) rank_overall,coalesce((permissions->>'require_review')::boolean,false) require_review FROM contest_groups WHERE contest_id=$1 ORDER BY position",
        [cid],
      ),
    };
  });
  app.post("/api/contests/:id/register", async (req) => {
    const u = requireUser(req),
      cid = id.parse((req.params as any).id);
    await rate(db, `contest-register:${u.id}`, 10, 60);
    return db.transaction(async (tx) => {
      await lock(tx);
      const c = await contestAccess(tx, cid, u, false);
      if (new Date(c!.ends_at).getTime() <= Date.now() && !isContestPractice(c))
        fail(403, "比赛已经结束");
      const selection = z
        .object({
          team_id: id.optional(),
          group_id: id.nullable().optional(),
          invite_code: z.string().trim().max(128).optional(),
        })
        .parse(req.body ?? {});
      const mine = await tx.query(
        "SELECT team_id FROM memberships WHERE user_id=$1",
        [u.id],
      );
      if (!mine.length)
        fail(403, "请先创建或加入战队", {
          label: "创建或加入战队",
          href: "/team",
        });
      if (!selection.team_id && mine.length > 1) fail(400, "请选择参赛战队");
      const t = await getTeam(tx, u.id, selection.team_id);
      if (!t || t.captain_id !== u.id)
        fail(403, "请由所选战队的队长报名", {
          label: "查看我的战队",
          href: "/team",
        });
      const groups = await tx.query(
        "SELECT id,permissions FROM contest_groups WHERE contest_id=$1",
        [cid],
      );
      checkRegistrationScope(c!, t!.id, selection.invite_code);
      if (groups.length && !groups.some((g) => g.id === selection.group_id))
        fail(400, "请选择有效组别");
      if (!groups.length && selection.group_id) fail(400, "此比赛没有该组别");
      if (
        !effectivePermissions(groups.find((g) => g.id === selection.group_id))
          .join
      )
        fail(403, "该组别已关闭报名，请选择其他组别");
      const [previous] = await tx.query(
        "SELECT status FROM registrations WHERE contest_id=$1 AND team_id=$2",
        [cid, t!.id],
      );
      if (previous && previous.status !== "rejected")
        fail(
          409,
          previous.status === "suspended" ? "参赛资格已暂停" : "战队已经报名",
        );
      const overlap = await tx.query(
        "SELECT 1 FROM memberships a JOIN memberships b ON a.user_id=b.user_id JOIN registrations r ON r.team_id=b.team_id WHERE a.team_id=$1 AND r.contest_id=$2 AND r.status IN ('pending','accepted','suspended') LIMIT 1",
        [t!.id, cid],
      );
      if (overlap.length)
        fail(409, "战队中有成员已报名此比赛", {
          label: "查看战队成员",
          href: `/team?team=${t!.id}`,
        });
      const [n] = await tx.query(
        "SELECT count(*)::int n FROM memberships WHERE team_id=$1",
        [t!.id],
      );
      if (n!.n > c!.team_limit) fail(409, "战队人数超过比赛限制");
      const pending =
        c!.require_review ||
        effectivePermissions(groups.find((g) => g.id === selection.group_id))
          .require_review;
      await tx.query(
        "INSERT INTO registrations(contest_id,team_id,group_id,status,accepted_at,practice_only) VALUES($1,$2,$3,$4,CASE WHEN $4='accepted' THEN now() ELSE NULL END,$5) ON CONFLICT(contest_id,team_id) DO UPDATE SET group_id=$3,status=$4,practice_only=$5,created_at=now(),review_note='',reviewed_at=NULL,reviewed_by=NULL,accepted_at=CASE WHEN $4='accepted' THEN now() ELSE NULL END",
        [
          cid,
          t!.id,
          selection.group_id ?? null,
          pending ? "pending" : "accepted",
          isContestPractice(c),
        ],
      );
      if (!pending) await snapshotContestMembers(tx, cid, t!.id);
      await notifyContest(tx, cid);
      await audit(tx, u.id, "contest.register", cid);
      return { ok: true };
    });
  });
  app.post("/api/contests/:id/unregister", async (req) => {
    const u = requireUser(req),
      cid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      await lock(tx);
      const c = await contestAccess(tx, cid, u, false);
      const [t] = await tx.query(
        "SELECT t.*,r.status registration_status FROM teams t JOIN registrations r ON r.team_id=t.id JOIN memberships m ON m.team_id=t.id WHERE r.contest_id=$1 AND m.user_id=$2 ORDER BY CASE WHEN r.status='accepted' THEN 0 WHEN r.status='suspended' THEN 1 WHEN r.status='pending' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 1",
        [cid, u.id],
      );
      if (!t || t.captain_id !== u.id) fail(403, "仅队长可以取消报名");
      if (t!.registration_status === "suspended")
        fail(403, "参赛资格暂停期间不能撤回报名");
      if (
        t!.registration_status === "accepted" &&
        new Date(c!.starts_at).getTime() <= Date.now()
      )
        fail(403, "开赛后不能取消报名");
      await tx.query(
        "DELETE FROM registrations WHERE contest_id=$1 AND team_id=$2",
        [cid, t!.id],
      );
      await audit(tx, u.id, "contest.unregister", cid);
      await notifyContest(tx, cid);
      return { ok: true };
    });
  });
  app.get("/api/announcements", async (req) => {
    const scope = scopeSchema.parse((req.query as any).scope);
    if (scope !== "practice")
      await contestAccess(db, scope, req.user ?? undefined, false);
    return {
      items: await db.query(
        "SELECT id,title,body,created_at FROM announcements WHERE ($1='practice' AND contest_id IS NULL) OR contest_id::text=$1 ORDER BY created_at DESC LIMIT 30",
        [scope],
      ),
    };
  });
}
