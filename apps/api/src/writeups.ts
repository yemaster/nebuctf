import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "./auth.js";
import { contestAccess, type User } from "./context.js";
import { audit, type DB, type Row } from "./db.js";
import { fail, rate } from "./security.js";
import { id, page } from "./schemas.js";
import { requireAccepted } from "./registrations.js";
import { notifyContest } from "./activity-events.js";
import { writeupInput, writeupWindow } from "./writeup-config.js";
import {
  receiveWriteup,
  removeWriteup,
  sendWriteup,
  sendWriteupArchive,
} from "./writeup-storage.js";
const fields = `w.contest_id,w.team_id,w.name,w.size,w.format,w.version,w.submitted_at,w.status,w.review_note,w.reviewed_at,u.username submitted_by,reviewer.username reviewed_by`;
const select = `SELECT ${fields} FROM contest_writeups w JOIN users u ON u.id=w.submitted_by LEFT JOIN users reviewer ON reviewer.id=w.reviewed_by`;
async function participant(db: DB, contest: string, user: User) {
  const [row] = await db.query(
    "SELECT r.team_id,r.status,t.name team_name,t.captain_id=$2 is_captain FROM contest_members m JOIN registrations r USING(contest_id,team_id) JOIN teams t ON t.id=r.team_id WHERE m.contest_id=$1 AND m.user_id=$2",
    [contest, user.id],
  );
  if (!row)
    fail(403, "仅本场比赛报名通过时的队员可以提交和查看 WriteUp", {
      label: "查看比赛报名",
      href: `/contests/${contest}`,
    });
  requireAccepted(row!.status, contest);
  return row!;
}
function assertWindow(contest: Row, current?: Row) {
  const config = writeupInput.parse(contest.writeup),
    window = writeupWindow(contest, config, current);
  if (window !== "open")
    fail(
      403,
      {
        disabled: "此比赛未开放 WriteUp 提交",
        upcoming: "尚未到 WriteUp 开始提交时间",
        closed: "WriteUp 提交已截止",
        submitted: "已提交 WriteUp，此比赛不允许替换",
      }[window],
    );
  return config;
}
function assertSubmitter(config: { submitter: string }, team: Row) {
  if (config.submitter === "captain" && !team.is_captain)
    fail(403, "本场比赛仅允许队长提交 WriteUp，请联系队长提交");
}
const filters = page.extend({
  group: id.optional(),
  status: z
    .enum(["missing", "submitted", "accepted", "changes_requested"])
    .optional(),
});
const listFrom = `FROM registrations r JOIN teams t ON t.id=r.team_id LEFT JOIN contest_groups g ON g.id=r.group_id LEFT JOIN contest_writeups w ON w.contest_id=r.contest_id AND w.team_id=r.team_id LEFT JOIN users u ON u.id=w.submitted_by LEFT JOIN users reviewer ON reviewer.id=w.reviewed_by`;
const listWhere = `r.contest_id=$1 AND (r.accepted_at IS NOT NULL OR r.status IN ('accepted','suspended')) AND ($2='' OR strpos(lower(t.name),lower($2))>0) AND ($3::uuid IS NULL OR r.group_id=$3) AND ($4::text IS NULL OR ($4='missing' AND w.team_id IS NULL) OR w.status=$4)`;
export function writeupRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/contests/:id/writeup", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      contest = await contestAccess(db, cid, user, false),
      team = await participant(db, cid, user);
    const [current] = await db.query(
      `${select} WHERE w.contest_id=$1 AND w.team_id=$2`,
      [cid, team.team_id],
    );
    const config = writeupInput.parse(contest!.writeup);
    return {
      config,
      team,
      can_submit: config.submitter === "members" || team.is_captain,
      submission: current ?? null,
      window: writeupWindow(contest!, config, current),
      opens_at: config.opens_at ?? contest!.ends_at,
    };
  });
  app.post("/api/contests/:id/writeup", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      { version } = z
        .object({ version: z.coerce.number().int().min(0) })
        .parse(req.query);
    await rate(db, `writeup:${user.id}`, 10, 300);
    const contest = await contestAccess(db, cid, user, false),
      team = await participant(db, cid, user);
    const [current] = await db.query(
      "SELECT version,status FROM contest_writeups WHERE contest_id=$1 AND team_id=$2",
      [cid, team.team_id],
    );
    const config = assertWindow(contest!, current);
    assertSubmitter(config, team);
    if ((current?.version ?? 0) !== version)
      fail(409, "队友已更新 WriteUp，请刷新后重试");
    const upload = await receiveWriteup(req, config);
    let previous: string | undefined;
    try {
      await db.transaction(async (tx) => {
        const [fresh] = await tx.query(
          "SELECT * FROM contests WHERE id=$1 FOR SHARE",
          [cid],
        );
        if (!fresh || (!fresh.published && user.role !== "admin"))
          fail(404, "比赛不存在");
        await tx.query(
          "SELECT team_id FROM registrations WHERE contest_id=$1 AND team_id=$2 FOR UPDATE",
          [cid, team.team_id],
        );
        await tx.query("SELECT id FROM teams WHERE id=$1 FOR SHARE", [
          team.team_id,
        ]);
        const member = await participant(tx, cid, user);
        if (member.team_id !== team.team_id)
          fail(409, "报名信息已变更，请刷新后重试");
        const [old] = await tx.query(
          "SELECT * FROM contest_writeups WHERE contest_id=$1 AND team_id=$2 FOR UPDATE",
          [cid, team.team_id],
        );
        const policy = assertWindow(fresh!, old);
        assertSubmitter(policy, member);
        if ((old?.version ?? 0) !== version)
          fail(409, "队友已更新 WriteUp，请刷新后重试");
        if (
          !policy.formats.includes(upload.format as "pdf" | "zip") ||
          upload.size > policy.max_size_mb * 1024 * 1024
        )
          fail(409, "提交设置已变更，请刷新后重试");
        await tx.query(
          `INSERT INTO contest_writeups(contest_id,team_id,file_id,name,size,format,version,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(contest_id,team_id) DO UPDATE SET file_id=$3,name=$4,size=$5,format=$6,version=$7,submitted_by=$8,submitted_at=now(),status='submitted',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=now()`,
          [
            cid,
            team.team_id,
            upload.file_id,
            upload.name,
            upload.size,
            upload.format,
            version + 1,
            user.id,
          ],
        );
        await tx.query(
          "INSERT INTO writeup_history(id,contest_id,team_id,version,actor_id,action,name) VALUES($1,$2,$3,$4,$5,'submitted',$6)",
          [
            crypto.randomUUID(),
            cid,
            team.team_id,
            version + 1,
            user.id,
            upload.name,
          ],
        );
        await audit(tx, user.id, "writeup.submit", `${cid}:${team.team_id}`);
        await notifyContest(tx, cid);
        previous = old?.file_id;
      });
    } catch (error) {
      await removeWriteup(upload.file_id);
      throw error;
    }
    if (previous) await removeWriteup(previous);
    return { ok: true, version: version + 1 };
  });
  app.get("/api/contests/:id/writeup/file", async (req, reply) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id);
    await contestAccess(db, cid, user, false);
    const team = await participant(db, cid, user),
      [row] = await db.query(
        "SELECT * FROM contest_writeups WHERE contest_id=$1 AND team_id=$2",
        [cid, team.team_id],
      );
    if (!row) fail(404, "尚未提交 WriteUp");
    return sendWriteup(reply, row!);
  });
  app.get("/api/admin/contests/:id/writeups", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id),
      p = filters.parse(req.query);
    const contest = await contestAccess(db, cid, user, false),
      params = [cid, p.q.trim(), p.group ?? null, p.status ?? null];
    const [count] = await db.query(
      `SELECT count(*)::int total ${listFrom} WHERE ${listWhere}`,
      params,
    );
    return {
      contest: {
        id: cid,
        title: contest!.title,
        writeup: writeupInput.parse(contest!.writeup),
      },
      groups: await db.query(
        "SELECT id,name FROM contest_groups WHERE contest_id=$1 ORDER BY position,id",
        [cid],
      ),
      total: count!.total,
      page: p.page,
      page_size: 10,
      counts: await db.query(
        `SELECT coalesce(w.status,'missing') status,count(*)::int count ${listFrom} WHERE ${listWhere} GROUP BY coalesce(w.status,'missing')`,
        [cid, p.q.trim(), p.group ?? null, null],
      ),
      items: await db.query(
        `SELECT ${fields},r.team_id,t.name team_name,r.status registration_status,g.name group_name ${listFrom} WHERE ${listWhere} ORDER BY t.name,r.team_id LIMIT 10 OFFSET $5`,
        [...params, (p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/admin/contests/:id/writeups/archive", async (req, reply) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id),
      p = filters
        .extend({ teams: z.string().max(4000).optional() })
        .parse(req.query);
    await contestAccess(db, cid, user, false);
    await rate(db, `writeup-export:${user.id}`, 6, 60);
    const teams = p.teams?.split(",").map((v) => id.parse(v));
    if (
      teams &&
      (!teams.length ||
        teams.length > 100 ||
        new Set(teams).size !== teams.length)
    )
      fail(400, "每次最多选择 100 支战队");
    const rows = await db.query(
      `SELECT w.*,t.name team_name,g.name group_name ${listFrom} WHERE ${listWhere} AND w.team_id IS NOT NULL AND ($5::uuid[] IS NULL OR r.team_id=ANY($5::uuid[])) ORDER BY r.team_id LIMIT 101`,
      [cid, p.q.trim(), p.group ?? null, p.status ?? null, teams ?? null],
    );
    await audit(db, user.id, "writeup.export", cid);
    return sendWriteupArchive(reply, rows);
  });
  app.get("/api/admin/contests/:id/writeups/:team", async (req) => {
    requireAdmin(req);
    const cid = id.parse((req.params as any).id),
      team = id.parse((req.params as any).team),
      p = page.parse(req.query);
    const [row] = await db.query(
      `${select.replace(" FROM", ",t.name team_name,g.name group_name FROM")} JOIN teams t ON t.id=w.team_id LEFT JOIN registrations r ON r.contest_id=w.contest_id AND r.team_id=w.team_id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE w.contest_id=$1 AND w.team_id=$2`,
      [cid, team],
    );
    if (!row) fail(404, "此战队尚未提交 WriteUp");
    const [count] = await db.query(
      "SELECT count(*)::int total FROM writeup_history WHERE contest_id=$1 AND team_id=$2",
      [cid, team],
    );
    return {
      ...row,
      history_total: count!.total,
      history: await db.query(
        "SELECT h.id,h.version,h.action,h.name,h.note,h.created_at,u.username FROM writeup_history h JOIN users u ON u.id=h.actor_id WHERE h.contest_id=$1 AND h.team_id=$2 ORDER BY h.created_at DESC,h.id DESC LIMIT 10 OFFSET $3",
        [cid, team, (p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/admin/contests/:id/writeups/:team/file", async (req, reply) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id),
      team = id.parse((req.params as any).team),
      [row] = await db.query(
        "SELECT * FROM contest_writeups WHERE contest_id=$1 AND team_id=$2",
        [cid, team],
      );
    if (!row) fail(404, "此战队尚未提交 WriteUp");
    const { version } = z
      .object({ version: z.coerce.number().int().min(1).optional() })
      .parse(req.query);
    if (version !== undefined && row!.version !== version)
      fail(409, "WriteUp 已更新，请刷新后查看当前版本");
    await audit(db, user.id, "writeup.download", `${cid}:${team}`);
    return sendWriteup(reply, row!);
  });
  app.put("/api/admin/contests/:id/writeups/:team", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id),
      team = id.parse((req.params as any).team),
      input = z
        .object({
          version: z.number().int().min(1),
          status: z.enum(["accepted", "changes_requested"]),
          note: z.string().trim().max(1000).default(""),
        })
        .strict()
        .parse(req.body);
    if (input.status === "changes_requested" && !input.note)
      fail(400, "请填写修改意见");
    return db.transaction(async (tx) => {
      const [row] = await tx.query(
        "UPDATE contest_writeups SET status=$3,review_note=$4,reviewed_by=$5,reviewed_at=now(),updated_at=now() WHERE contest_id=$1 AND team_id=$2 AND version=$6 RETURNING name",
        [cid, team, input.status, input.note, user.id, input.version],
      );
      if (!row) fail(409, "WriteUp 已更新或不存在，请刷新后核对当前版本");
      await tx.query(
        "INSERT INTO writeup_history(id,contest_id,team_id,version,actor_id,action,name,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          crypto.randomUUID(),
          cid,
          team,
          input.version,
          user.id,
          input.status,
          row!.name,
          input.note,
        ],
      );
      await audit(tx, user.id, `writeup.${input.status}`, `${cid}:${team}`);
      await notifyContest(tx, cid);
      return { ok: true };
    });
  });
}
