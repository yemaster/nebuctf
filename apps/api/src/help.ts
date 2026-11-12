import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "./auth.js";
import { audit, lock, type DB } from "./db.js";
import { id, page } from "./schemas.js";
import { fail } from "./security.js";

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const documentParams = z.object({ id });
const slugParams = z.object({ slug });
const helpInput = z.object({
  slug,
  title: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(40),
  position: z.number().int().min(0).max(100000),
  body: z.string().max(200000),
  published: z.boolean(),
});
const metadata = "d.id,d.slug,d.title,d.category,d.position,d.updated_at";
const order = "ORDER BY d.position,d.title,d.id";
const search =
  "($1='' OR d.title ILIKE '%'||$1||'%' OR d.slug ILIKE '%'||$1||'%' OR d.category ILIKE '%'||$1||'%' OR d.body ILIKE '%'||$1||'%')";
const attribution =
  "CASE WHEN creator.id IS NULL THEN NULL ELSE jsonb_build_object('id',creator.id,'username',creator.username,'avatar_id',creator.avatar_id) END author,CASE WHEN editor.id IS NULL THEN NULL ELSE jsonb_build_object('id',editor.id,'username',editor.username,'avatar_id',editor.avatar_id) END editor";
const people =
  "LEFT JOIN users creator ON creator.id=d.created_by LEFT JOIN users editor ON editor.id=d.updated_by";

export function helpRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/help", async () => ({
    items: await db.query(
      `SELECT ${metadata} FROM help_documents d WHERE d.published ${order}`,
    ),
  }));
  app.get("/api/help/:slug", async (req) => {
    const value = slugParams.parse(req.params).slug;
    const [document] = await db.query(
      `SELECT d.*,${attribution} FROM help_documents d ${people} WHERE d.slug=$1 AND d.published`,
      [value],
    );
    if (!document) fail(404, "帮助文档不存在");
    return document;
  });
  app.get("/api/admin/help", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    return db.transaction(async (tx) => {
      const [count] = await tx.query(
        `SELECT count(*)::int total FROM help_documents d WHERE ${search}`,
        [p.q],
      );
      const items = await tx.query(
        `SELECT ${metadata},d.published,d.created_at,${attribution} FROM help_documents d ${people} WHERE ${search} ${order} LIMIT 24 OFFSET $2`,
        [p.q, (p.page - 1) * 24],
      );
      return { items, total: count!.total, page: p.page };
    });
  });
  app.get("/api/admin/help/:id", async (req) => {
    requireAdmin(req);
    const documentId = documentParams.parse(req.params).id;
    const [document] = await db.query(
      `SELECT d.*,${attribution} FROM help_documents d ${people} WHERE d.id=$1`,
      [documentId],
    );
    if (!document) fail(404, "帮助文档不存在");
    return document;
  });
  for (const method of ["POST", "PUT"] as const) {
    app.route({
      method,
      url: `/api/admin/help${method === "PUT" ? "/:id" : ""}`,
      bodyLimit: 1300000,
      handler: async (req) => {
        const user = requireAdmin(req);
        const data = helpInput.parse(req.body);
        const documentId =
          method === "PUT"
            ? documentParams.parse(req.params).id
            : crypto.randomUUID();
        await db.transaction(async (tx) => {
          await lock(tx);
          const values = [
            data.slug,
            data.title,
            data.category,
            data.position,
            data.body,
            data.published,
            documentId,
            user.id,
          ];
          if (method === "PUT") {
            const rows = await tx.query(
              "UPDATE help_documents SET slug=$1,title=$2,category=$3,position=$4,body=$5,published=$6,updated_at=now(),updated_by=$8 WHERE id=$7 RETURNING id",
              values,
            );
            if (!rows.length) fail(404, "帮助文档不存在");
          } else {
            await tx.query(
              "INSERT INTO help_documents(slug,title,category,position,body,published,id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
              values,
            );
          }
          await audit(tx, user.id, "help.save", documentId);
        });
        return { id: documentId };
      },
    });
  }
  app.delete("/api/admin/help/:id", async (req) => {
    const user = requireAdmin(req);
    const documentId = documentParams.parse(req.params).id;
    await db.transaction(async (tx) => {
      await lock(tx);
      const rows = await tx.query(
        "DELETE FROM help_documents WHERE id=$1 RETURNING id",
        [documentId],
      );
      if (!rows.length) fail(404, "帮助文档不存在");
      await audit(tx, user.id, "help.delete", documentId);
    });
    return { ok: true };
  });
}
