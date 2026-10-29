import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "./auth.js";
import { audit, type DB } from "./db.js";
import { id, page } from "./schemas.js";
import { fail, rate } from "./security.js";

type Audience =
  | { kind: "all" }
  | { kind: "users"; ids: string[] }
  | { kind: "team"; team: string; contest?: string }
  | { kind: "contest"; contest: string; missingWriteup?: boolean };
type Notice = {
  kind: "system" | "contest" | "reminder";
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  sender?: string;
  eventKey?: string;
  audienceLabel?: string;
};
export const notifyInbox = (db: DB) =>
  db.query("SELECT pg_notify('nebuctf_activity','inbox')");

// Call inside the business transaction: a failed review cannot deliver a notice.
// Content is stored once, even for a broadcast; each recipient owns their state.
export async function deliverNotification(
  db: DB,
  notice: Notice,
  audience: Audience,
) {
  const [message] = await db.query(
    `INSERT INTO notifications(id,kind,title,body,href,action_label,sender_id,event_key,audience)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(event_key) DO UPDATE SET event_key=excluded.event_key RETURNING id,withdrawn_at`,
    [
      crypto.randomUUID(),
      notice.kind,
      notice.title,
      notice.body,
      notice.href ?? null,
      notice.actionLabel ?? null,
      notice.sender ?? null,
      notice.eventKey ?? null,
      notice.audienceLabel ?? "自动通知",
    ],
  );
  if (message!.withdrawn_at) return { id: message!.id, recipients: 0 };
  let selection = "SELECT id FROM users WHERE NOT disabled",
    params: unknown[] = [message!.id];
  if (audience.kind === "users") {
    selection += " AND id=ANY($2::uuid[])";
    params.push(audience.ids);
  } else if (audience.kind === "team") {
    selection += ` AND (EXISTS(SELECT 1 FROM contest_members m WHERE m.user_id=users.id AND m.team_id=$2 AND m.contest_id=$3)
      OR (NOT EXISTS(SELECT 1 FROM contest_members roster WHERE roster.team_id=$2 AND roster.contest_id=$3)
        AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.team_id=$2)))`;
    params.push(audience.team, audience.contest ?? null);
  } else if (audience.kind === "contest") {
    selection += ` AND EXISTS(SELECT 1 FROM registrations r WHERE r.contest_id=$2 AND r.status='accepted' AND NOT r.practice_only
      AND (EXISTS(SELECT 1 FROM contest_members m WHERE m.team_id=r.team_id AND m.contest_id=r.contest_id AND m.user_id=users.id)
        OR (NOT EXISTS(SELECT 1 FROM contest_members roster WHERE roster.team_id=r.team_id AND roster.contest_id=r.contest_id)
          AND EXISTS(SELECT 1 FROM memberships m WHERE m.team_id=r.team_id AND m.user_id=users.id)))
      ${audience.missingWriteup ? "AND NOT EXISTS(SELECT 1 FROM contest_writeups w WHERE w.contest_id=r.contest_id AND w.team_id=r.team_id AND w.status<>'changes_requested')" : ""})`;
    params.push(audience.contest);
  }
  const [result] = await db.query(
    `WITH delivered AS (INSERT INTO notification_recipients(notification_id,user_id)
     SELECT $1,recipient.id FROM (${selection}) recipient ON CONFLICT DO NOTHING RETURNING user_id)
     SELECT count(*)::int recipients FROM delivered`,
    params,
  );
  if (result!.recipients) await notifyInbox(db);
  return {
    id: message!.id as string,
    recipients: result!.recipients as number,
  };
}

export async function inboxSummary(db: DB, users: string[]) {
  return db.query(
    `SELECT requested.id user_id,
      (SELECT count(*)::int FROM notification_recipients r WHERE r.user_id=requested.id AND r.read_at IS NULL AND r.archived_at IS NULL) unread,
      (SELECT r.updated_at::text FROM notification_recipients r WHERE r.user_id=requested.id ORDER BY r.updated_at DESC LIMIT 1) revision
     FROM unnest($1::uuid[]) requested(id)`,
    [users],
  );
}

const kind = z.enum(["system", "contest", "reminder"]);
const inboxQuery = page.extend({
  kind: kind.optional(),
  state: z.enum(["all", "unread", "archived"]).default("all"),
});
const safePath = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value === "" ||
      (/^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value)),
    "请填写站内路径，例如 /contests",
  );
const composeInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(8000),
    href: safePath.default(""),
    action_label: z.string().trim().max(30).default("查看详情"),
    audience: z.enum(["all", "users", "contest"]),
    recipients: z.array(z.string().trim().min(1).max(254)).max(100).default([]),
    contest_id: id.optional(),
    request_id: id,
  })
  .strict();

export function notificationRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/notifications/summary", async (req) => {
    const user = requireUser(req);
    return (await inboxSummary(db, [user.id]))[0];
  });
  app.get("/api/notifications", async (req) => {
    const asOf = new Date().toISOString();
    const user = requireUser(req),
      input = inboxQuery.parse(req.query);
    const where = `r.user_id=$1 AND n.withdrawn_at IS NULL
      AND ($2::text IS NULL OR n.kind=$2)
      AND CASE WHEN $3='archived' THEN r.archived_at IS NOT NULL ELSE r.archived_at IS NULL END
      AND ($3<>'unread' OR r.read_at IS NULL)
      AND ($4='' OR strpos(lower(n.title||' '||n.body),lower($4))>0)`;
    const params = [user.id, input.kind ?? null, input.state, input.q.trim()];
    const [count] = await db.query(
      `SELECT count(*)::int total FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE ${where}`,
      params,
    );
    const items = await db.query(
      `SELECT n.id,n.kind,n.title,left(n.body,160) excerpt,n.created_at,r.read_at,r.archived_at
       FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE ${where}
       ORDER BY r.created_at DESC,n.id DESC LIMIT 10 OFFSET $5`,
      [...params, (input.page - 1) * 10],
    );
    return {
      items,
      total: count!.total,
      page: input.page,
      page_size: 10,
      as_of: asOf,
    };
  });
  app.get("/api/notifications/:id", async (req) => {
    const user = requireUser(req),
      nid = id.parse((req.params as any).id);
    const [row] = await db.query(
      `SELECT n.id,n.kind,n.title,n.body,n.href,n.action_label,n.created_at,r.read_at,r.archived_at,
       u.username sender FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id
       LEFT JOIN users u ON u.id=n.sender_id WHERE r.user_id=$1 AND n.id=$2 AND n.withdrawn_at IS NULL`,
      [user.id, nid],
    );
    if (!row) fail(404, "消息不存在或已撤回");
    return row;
  });
  app.put("/api/notifications/read-all", async (req) => {
    const user = requireUser(req),
      input = z
        .object({ before: z.iso.datetime(), kind: kind.optional() })
        .strict()
        .parse(req.body);
    const cutoff = new Date(
      Math.min(Date.now(), Date.parse(input.before)),
    ).toISOString();
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE notification_recipients r SET read_at=now(),updated_at=now() FROM notifications n
        WHERE r.notification_id=n.id AND r.user_id=$1 AND r.read_at IS NULL AND r.archived_at IS NULL
        AND r.created_at<=$2 AND n.withdrawn_at IS NULL AND ($3::text IS NULL OR n.kind=$3)`,
        [user.id, cutoff, input.kind ?? null],
      );
      await notifyInbox(tx);
    });
    return { ok: true };
  });
  app.put("/api/notifications/:id", async (req) => {
    const user = requireUser(req),
      nid = id.parse((req.params as any).id);
    const input = z
      .object({
        read: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine(
        (v) => v.read !== undefined || v.archived !== undefined,
        "请选择操作",
      )
      .parse(req.body);
    await db.transaction(async (tx) => {
      const rows = await tx.query(
        `UPDATE notification_recipients r SET
        read_at=CASE WHEN $3::boolean IS NULL THEN read_at WHEN $3 THEN coalesce(read_at,now()) ELSE NULL END,
        archived_at=CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN coalesce(archived_at,now()) ELSE NULL END,
        updated_at=now() FROM notifications n WHERE r.notification_id=n.id AND n.id=$2 AND r.user_id=$1 AND n.withdrawn_at IS NULL RETURNING r.user_id`,
        [user.id, nid, input.read ?? null, input.archived ?? null],
      );
      if (!rows.length) fail(404, "消息不存在或已撤回");
      await notifyInbox(tx);
    });
    return { ok: true };
  });
  app.get("/api/admin/notifications", async (req) => {
    requireAdmin(req);
    const input = page.parse(req.query),
      params = [input.q.trim()];
    const where =
      "n.sender_id IS NOT NULL AND n.kind='system' AND ($1='' OR strpos(lower(n.title),lower($1))>0)";
    const [count] = await db.query(
      `SELECT count(*)::int total FROM notifications n WHERE ${where}`,
      params,
    );
    return {
      total: count!.total,
      items: await db.query(
        `SELECT n.id,n.title,n.body,n.href,n.action_label,n.audience,n.created_at,n.withdrawn_at,u.username sender,
       (SELECT count(*)::int FROM notification_recipients r WHERE r.notification_id=n.id) recipients,
       (SELECT count(*)::int FROM notification_recipients r WHERE r.notification_id=n.id AND r.read_at IS NOT NULL) read_count
       FROM notifications n LEFT JOIN users u ON u.id=n.sender_id WHERE ${where}
       ORDER BY n.created_at DESC,n.id DESC LIMIT 10 OFFSET $2`,
        [...params, (input.page - 1) * 10],
      ),
    };
  });
  app.post("/api/admin/notifications", async (req) => {
    const admin = requireAdmin(req),
      input = composeInput.parse(req.body);
    await rate(db, `notice-send:${admin.id}`, 20, 60);
    return db.transaction(async (tx) => {
      const key = `manual:${admin.id}:${input.request_id}`;
      await tx.query("SELECT pg_advisory_xact_lock(760020)");
      const [previous] = await tx.query(
        "SELECT id FROM notifications WHERE event_key=$1",
        [key],
      );
      if (previous) return { id: previous.id };
      let audience: Audience = { kind: "all" },
        label = "全体用户";
      if (input.audience === "users") {
        const names = [
          ...new Set(input.recipients.map((s) => s.toLowerCase())),
        ];
        if (!names.length) fail(400, "请填写接收用户");
        const users = await tx.query(
          "SELECT id,lower(username) username,lower(email) email FROM users WHERE NOT disabled AND (lower(username)=ANY($1::text[]) OR lower(email)=ANY($1::text[]))",
          [names],
        );
        if (
          names.some(
            (n) => !users.some((u) => u.username === n || u.email === n),
          )
        )
          fail(400, "部分用户不存在或已禁用");
        audience = { kind: "users", ids: users.map((u) => u.id) };
        label = `${users.length} 位指定用户`;
      } else if (input.audience === "contest") {
        if (!input.contest_id) fail(400, "请选择比赛");
        const [contest] = await tx.query(
          "SELECT title FROM contests WHERE id=$1",
          [input.contest_id],
        );
        if (!contest) fail(404, "比赛不存在");
        audience = { kind: "contest", contest: input.contest_id! };
        label = contest!.title;
      }
      const result = await deliverNotification(
        tx,
        {
          kind: "system",
          title: input.title,
          body: input.body,
          href: input.href || undefined,
          actionLabel: input.action_label || "查看详情",
          sender: admin.id,
          eventKey: key,
          audienceLabel: label,
        },
        audience,
      );
      if (!result.recipients) fail(400, "没有符合条件的接收用户");
      await audit(tx, admin.id, "notification.send", result.id);
      return result;
    });
  });
  app.delete("/api/admin/notifications/:id", async (req) => {
    const admin = requireAdmin(req),
      nid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      const rows = await tx.query(
        "UPDATE notifications SET withdrawn_at=coalesce(withdrawn_at,now()) WHERE id=$1 AND kind='system' AND sender_id IS NOT NULL RETURNING id",
        [nid],
      );
      if (!rows.length) fail(404, "消息不存在");
      await tx.query(
        "UPDATE notification_recipients SET archived_at=coalesce(archived_at,now()),updated_at=now() WHERE notification_id=$1",
        [nid],
      );
      await audit(tx, admin.id, "notification.withdraw", nid);
      await notifyInbox(tx);
      return { ok: true };
    });
  });
}

// A repeated scan adds only missing recipients, including late registrations.
export async function publishNotificationReminders(db: DB) {
  await db.transaction(async (tx) => {
    const [locked] = await tx.query(
      "SELECT pg_try_advisory_xact_lock(760019) acquired",
    );
    if (!locked!.acquired) return;
    const contests =
      await tx.query(`SELECT id,title,starts_at,ends_at,writeup FROM contests WHERE published AND
      ((starts_at>now() AND starts_at<=now()+interval '15 minutes') OR
       (writeup->>'enabled'='true' AND (writeup->>'deadline')::timestamptz>now() AND (writeup->>'deadline')::timestamptz<=now()+interval '1 hour'))`);
    for (const c of contests) {
      const starts = new Date(c.starts_at).toISOString();
      if (
        Date.parse(starts) > Date.now() &&
        Date.parse(starts) <= Date.now() + 900000
      )
        await deliverNotification(
          tx,
          {
            kind: "reminder",
            title: "比赛即将开始",
            body: `${c.title}\n开赛时间：${new Date(starts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）`,
            href: `/contests/${c.id}`,
            actionLabel: "进入比赛",
            eventKey: `start:${c.id}:${starts}`,
          },
          { kind: "contest", contest: c.id },
        );
      const deadline = c.writeup?.deadline;
      if (
        c.writeup?.enabled &&
        deadline &&
        Date.parse(deadline) > Date.now() &&
        Date.parse(deadline) <= Date.now() + 3600000 &&
        Date.parse(c.writeup.opens_at ?? c.ends_at) <= Date.now()
      )
        await deliverNotification(
          tx,
          {
            kind: "reminder",
            title: "WriteUp 即将截止",
            body: `${c.title}\n截止时间：${new Date(deadline).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）`,
            href: `/contests/${c.id}/writeup`,
            actionLabel: "提交 WriteUp",
            eventKey: `writeup-deadline:${c.id}:${new Date(deadline).toISOString()}`,
          },
          { kind: "contest", contest: c.id, missingWriteup: true },
        );
    }
  });
}
