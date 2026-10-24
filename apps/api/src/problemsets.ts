import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin } from "./auth.js";
import { id, page } from "./schemas.js";
import { fail } from "./security.js";
import { challengeProgress } from "./challenge-parts.js";
const input = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(4000).default(""),
  published: z.boolean().default(false),
  challenge_ids: z
    .array(id)
    .max(500)
    .default([])
    .refine((v) => new Set(v).size === v.length, "题单内不能重复添加题目"),
});
const summary = `SELECT p.*,
 (SELECT count(*)::int FROM problemset_items i JOIN challenges c ON c.id=i.challenge_id WHERE i.problemset_id=p.id AND c.published AND c.practice) total,
 (SELECT count(*)::int FROM problemset_items i JOIN challenges c ON c.id=i.challenge_id JOIN solves s ON s.challenge_id=c.id AND s.scope='practice' AND s.owner_key=$1 WHERE i.problemset_id=p.id AND c.published AND c.practice) completed FROM problemsets p`;
export function problemsetRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/problemsets", async (req) => {
    const p = page.parse(req.query),
      owner = req.user ? `u:${req.user.id}` : "";
    const [count] = await db.query(
      "SELECT count(*)::int total FROM problemsets WHERE published AND ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    return {
      items: await db.query(
        `${summary} WHERE p.published AND ($2='' OR p.title ILIKE '%'||$2||'%') ORDER BY p.created_at DESC,p.id LIMIT 24 OFFSET $3`,
        [owner, p.q, (p.page - 1) * 24],
      ),
      total: count!.total,
      page: p.page,
    };
  });
  app.get("/api/problemsets/:id", async (req) => {
    const pid = id.parse((req.params as any).id),
      p = page.parse(req.query),
      owner = req.user ? `u:${req.user.id}` : "";
    const [set] = await db.query(
      `${summary} WHERE p.id=$2 AND (p.published OR $3)`,
      [owner, pid, req.user?.role === "admin"],
    );
    if (!set) fail(404, "题单不存在");
    const [count] = await db.query(
      `SELECT count(*)::int total FROM problemset_items i JOIN challenges c ON c.id=i.challenge_id
      WHERE i.problemset_id=$1 AND c.published AND c.practice
      AND strpos(lower(c.title),lower($2::text))>0 AND ($3='' OR c.category=$3)`,
      [pid, p.q.trim(), p.category],
    );
    const rows = await db.query(
      `SELECT c.*,
      (SELECT count(*)::int FROM solves s WHERE s.challenge_id=c.id AND s.scope='practice') solves,
      EXISTS(SELECT 1 FROM solves s WHERE s.challenge_id=c.id AND s.scope='practice' AND s.owner_key=$2) solved
      FROM problemset_items i JOIN challenges c ON c.id=i.challenge_id WHERE i.problemset_id=$1 AND c.published AND c.practice
      AND strpos(lower(c.title),lower($4::text))>0 AND ($5='' OR c.category=$5)
      ORDER BY i.position,c.id LIMIT 24 OFFSET $3`,
      [pid, owner, (p.page - 1) * 24, p.q.trim(), p.category],
    );
    return {
      ...set,
      filtered_total: count!.total,
      items: await challengeProgress(db, rows, "practice", owner, new Date()),
      page: p.page,
    };
  });
  const adminSummary = `SELECT p.*,coalesce((SELECT json_agg(json_build_object('id',c.id,'title',c.title) ORDER BY i.position) FROM problemset_items i JOIN challenges c ON c.id=i.challenge_id WHERE i.problemset_id=p.id),'[]') challenges FROM problemsets p`;
  app.get("/api/admin/problemsets", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM problemsets WHERE ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    return {
      items: await db.query(
        `${adminSummary} WHERE ($1='' OR p.title ILIKE '%'||$1||'%') ORDER BY p.created_at DESC,p.id LIMIT 24 OFFSET $2`,
        [p.q, (p.page - 1) * 24],
      ),
      total: count!.total,
      page: p.page,
    };
  });
  app.get("/api/admin/problemsets/:id", async (req) => {
    requireAdmin(req);
    const [set] = await db.query(`${adminSummary} WHERE p.id=$1`, [
      id.parse((req.params as any).id),
    ]);
    if (!set) fail(404, "题单不存在");
    return set;
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/problemsets${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const user = requireAdmin(req),
          data = input.parse(req.body),
          pid =
            method === "PUT"
              ? id.parse((req.params as any).id)
              : crypto.randomUUID();
        return db.transaction(async (tx) => {
          await lock(tx);
          if (
            method === "PUT" &&
            !(await tx.query("SELECT 1 FROM problemsets WHERE id=$1", [pid]))
              .length
          )
            fail(404, "题单不存在");
          const available = await tx.query(
            "SELECT id FROM challenges WHERE id=ANY($1::uuid[])",
            [data.challenge_ids],
          );
          if (available.length !== data.challenge_ids.length)
            fail(400, "题单包含不存在的题目");
          await tx.query(
            "INSERT INTO problemsets(id,title,description,published) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET title=$2,description=$3,published=$4",
            [pid, data.title, data.description, data.published],
          );
          await tx.query(
            "DELETE FROM problemset_items WHERE problemset_id=$1",
            [pid],
          );
          if (data.challenge_ids.length)
            await tx.query(
              "INSERT INTO problemset_items(problemset_id,challenge_id,position) SELECT $1,value,(ordinality-1)::int FROM unnest($2::uuid[]) WITH ORDINALITY AS ids(value,ordinality)",
              [pid, data.challenge_ids],
            );
          await audit(
            tx,
            user.id,
            method === "POST" ? "problemset.create" : "problemset.update",
            pid,
          );
          return { id: pid };
        });
      },
    });
}
