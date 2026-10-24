import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin, requireUser } from "./auth.js";
import { fail } from "./security.js";
import { id, page } from "./schemas.js";
export const articleInput = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  category: z.string().trim().min(1).max(40),
  kind: z.enum(["document", "tutorial"]),
  body: z.string().max(200000),
  published: z.boolean().default(false),
});
const nodeInput = z
  .object({
    id,
    title: z.string().trim().min(1).max(120),
    article_id: id.nullable(),
    challenge_id: id.nullable(),
    prerequisites: z.array(id).max(100),
    position: z
      .object({
        x: z.number().min(-100000).max(100000),
        y: z.number().min(-100000).max(100000),
      })
      .optional(),
  })
  .refine(
    (n) => n.article_id || n.challenge_id,
    "节点至少关联一篇文档或一道题目",
  );
export const treeInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  published: z.boolean().default(false),
  nodes: z.array(nodeInput).min(1).max(100),
});
export type LearningNode = z.infer<typeof nodeInput>;
export function orderNodes(nodes: LearningNode[]): LearningNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length) fail(400, "节点 ID 重复");
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    ordered: LearningNode[] = [];
  function visit(node: LearningNode) {
    if (visiting.has(node.id)) fail(400, "技能节点存在循环依赖");
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const parent of node.prerequisites) {
      const p = byId.get(parent);
      if (!p) fail(400, "前置技能不存在");
      visit(p!);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    ordered.push(node);
  }
  nodes.forEach(visit);
  return ordered;
}
export function learningProgress(
  nodes: LearningNode[],
  articles: Set<string>,
  challenges: Set<string>,
) {
  const computed = new Map<
    string,
    { completed: boolean; unlocked: boolean; level: number }
  >();
  for (const node of orderNodes(nodes)) {
    const parents = node.prerequisites.map((p) => computed.get(p)!);
    const unlocked = parents.every((p) => p.completed);
    computed.set(node.id, {
      unlocked,
      completed:
        unlocked &&
        (!node.article_id || articles.has(node.article_id)) &&
        (!node.challenge_id || challenges.has(node.challenge_id)),
      level: parents.length ? 1 + Math.max(...parents.map((p) => p.level)) : 0,
    });
  }
  return nodes.map((n) => ({ ...n, ...computed.get(n.id)! }));
}
export function learningRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/articles/categories", async () => ({
    items: await db.query(
      "SELECT DISTINCT category FROM articles WHERE published ORDER BY category",
    ),
  }));
  app.get("/api/articles", async (req) => {
    const q = z
      .object({
        q: z.string().max(100).default(""),
        kind: z.enum(["", "document", "tutorial"]).default(""),
        category: z.string().max(40).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const items = await db.query(
      "SELECT a.id,a.title,a.slug,a.category,a.kind,a.updated_at,count(*) OVER()::int total,EXISTS(SELECT 1 FROM article_progress p WHERE p.article_id=a.id AND p.user_id::text=$4) completed FROM articles a WHERE a.published AND ($1='' OR a.title ILIKE '%'||$1||'%') AND ($2='' OR a.kind=$2) AND ($3='' OR a.category=$3) ORDER BY a.updated_at DESC LIMIT 24 OFFSET $5",
      [q.q, q.kind, q.category, req.user?.id ?? "", (q.page - 1) * 24],
    );
    return { items, total: items[0]?.total ?? 0 };
  });
  app.get("/api/articles/:slug", async (req) => {
    const slug = z.object({ slug: z.string().max(80) }).parse(req.params).slug;
    const [a] = await db.query("SELECT * FROM articles WHERE slug=$1", [slug]);
    if (!a || (!a.published && req.user?.role !== "admin"))
      fail(404, "文档不存在");
    const completed =
      !!req.user &&
      (
        await db.query(
          "SELECT 1 FROM article_progress WHERE user_id=$1 AND article_id=$2",
          [req.user.id, a!.id],
        )
      ).length > 0;
    return { ...a, completed };
  });
  app.post("/api/articles/:id/complete", async (req) => {
    const u = requireUser(req),
      aid = z.object({ id }).parse(req.params).id;
    const [a] = await db.query(
      "SELECT 1 FROM articles WHERE id=$1 AND published",
      [aid],
    );
    if (!a) fail(404, "文档不存在");
    await db.query(
      "INSERT INTO article_progress(user_id,article_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [u.id, aid],
    );
    return { ok: true };
  });
  app.get("/api/learning/trees", async () => ({
    items: await db.query(
      "SELECT t.id,t.title,t.description,count(n.id)::int nodes FROM learning_trees t LEFT JOIN learning_nodes n ON n.tree_id=t.id WHERE t.published GROUP BY t.id ORDER BY t.created_at",
    ),
  }));
  app.get("/api/learning/trees/:id", async (req) => {
    const tid = z.object({ id }).parse(req.params).id;
    const [t] = await db.query("SELECT * FROM learning_trees WHERE id=$1", [
      tid,
    ]);
    if (!t || (!t.published && req.user?.role !== "admin"))
      fail(404, "技能路线不存在");
    const nodes = await db.query<LearningNode>(
      "SELECT id,title,article_id,challenge_id,prerequisites,CASE WHEN position_x IS NOT NULL THEN json_build_object('x',position_x,'y',position_y) END position FROM learning_nodes WHERE tree_id=$1 ORDER BY learning_nodes.position",
      [tid],
    );
    const articles = req.user
      ? await db.query(
          "SELECT p.article_id FROM article_progress p JOIN articles a ON a.id=p.article_id WHERE p.user_id=$1 AND a.published",
          [req.user.id],
        )
      : [];
    const challenges = req.user
      ? await db.query(
          "SELECT s.challenge_id FROM solves s JOIN challenges c ON c.id=s.challenge_id WHERE s.scope='practice' AND s.owner_key=$1 AND c.published AND c.practice",
          [`u:${req.user.id}`],
        )
      : [];
    const progress = learningProgress(
      nodes,
      new Set(articles.map((a) => a.article_id)),
      new Set(challenges.map((c) => c.challenge_id)),
    );
    const links = await db.query(
      "SELECT n.id,a.slug,a.title article_title,c.title challenge_title,a.published article_published,c.published challenge_published,c.practice FROM learning_nodes n LEFT JOIN articles a ON a.id=n.article_id LEFT JOIN challenges c ON c.id=n.challenge_id WHERE n.tree_id=$1",
      [tid],
    );
    return {
      ...t,
      nodes: progress.map((n) => {
        const link = links.find((l) => l.id === n.id)!;
        return {
          ...n,
          slug: link.article_published ? link.slug : null,
          article_title: link.article_published ? link.article_title : null,
          challenge_title:
            link.challenge_published && link.practice
              ? link.challenge_title
              : null,
        };
      }),
      completed: progress.filter((n) => n.completed).length,
    };
  });
  app.get("/api/admin/articles", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM articles WHERE ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    return {
      items: await db.query(
        "SELECT id,title,slug,category,kind,published,updated_at FROM articles WHERE ($1='' OR title ILIKE '%'||$1||'%') ORDER BY updated_at DESC,id LIMIT 24 OFFSET $2",
        [p.q, (p.page - 1) * 24],
      ),
      total: count!.total,
      page: p.page,
    };
  });
  app.get("/api/admin/articles/:id", async (req) => {
    requireAdmin(req);
    const [article] = await db.query("SELECT * FROM articles WHERE id=$1", [
      id.parse((req.params as any).id),
    ]);
    if (!article) fail(404, "文档不存在");
    return article;
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/articles${method === "PUT" ? "/:id" : ""}`,
      bodyLimit: 256000,
      handler: async (req) => {
        const u = requireAdmin(req),
          data = articleInput.parse(req.body),
          aid =
            method === "PUT"
              ? z.object({ id }).parse(req.params).id
              : crypto.randomUUID();
        await db.transaction(async (tx) => {
          await lock(tx);
          if (method === "PUT") {
            const rows = await tx.query(
              "UPDATE articles SET title=$1,slug=$2,category=$3,kind=$4,body=$5,published=$6,updated_at=now() WHERE id=$7 RETURNING id",
              [
                data.title,
                data.slug,
                data.category,
                data.kind,
                data.body,
                data.published,
                aid,
              ],
            );
            if (!rows.length) fail(404, "文档不存在");
          } else
            await tx.query(
              "INSERT INTO articles(id,title,slug,category,kind,body,published) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                aid,
                data.title,
                data.slug,
                data.category,
                data.kind,
                data.body,
                data.published,
              ],
            );
          await audit(tx, u.id, "article.save", aid);
        });
        return { id: aid };
      },
    });
  const adminNodes =
    "SELECT n.*,c.title challenge_title,a.title article_title,CASE WHEN position_x IS NOT NULL THEN json_build_object('x',position_x,'y',position_y) END position FROM learning_nodes n LEFT JOIN challenges c ON c.id=n.challenge_id LEFT JOIN articles a ON a.id=n.article_id WHERE tree_id=ANY($1::uuid[]) ORDER BY n.position";
  app.get("/api/admin/learning/trees", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM learning_trees WHERE ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    const items = await db.query(
      "SELECT * FROM learning_trees WHERE ($1='' OR title ILIKE '%'||$1||'%') ORDER BY created_at DESC,id LIMIT 24 OFFSET $2",
      [p.q, (p.page - 1) * 24],
    );
    const nodes = await db.query(adminNodes, [items.map((item) => item.id)]);
    for (const item of items)
      item.nodes = nodes.filter((node) => node.tree_id === item.id);
    return { items, total: count!.total, page: p.page };
  });
  app.get("/api/admin/learning/trees/:id", async (req) => {
    requireAdmin(req);
    const tid = id.parse((req.params as any).id);
    const [tree] = await db.query("SELECT * FROM learning_trees WHERE id=$1", [
      tid,
    ]);
    if (!tree) fail(404, "技能树不存在");
    return { ...tree, nodes: await db.query(adminNodes, [[tid]]) };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/learning/trees${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const u = requireAdmin(req),
          data = treeInput.parse(req.body),
          tid =
            method === "PUT"
              ? z.object({ id }).parse(req.params).id
              : crypto.randomUUID();
        orderNodes(data.nodes);
        await db.transaction(async (tx) => {
          await lock(tx);
          for (const n of data.nodes) {
            if (
              n.article_id &&
              !(
                await tx.query(
                  "SELECT 1 FROM articles WHERE id=$1 AND (published OR NOT $2)",
                  [n.article_id, data.published],
                )
              ).length
            )
              fail(400, "请先发布关联文档");
            if (
              n.challenge_id &&
              !(
                await tx.query(
                  "SELECT 1 FROM challenges WHERE id=$1 AND practice AND (published OR NOT $2)",
                  [n.challenge_id, data.published],
                )
              ).length
            )
              fail(400, "技能节点只能关联已开放的练习题");
          }
          if (method === "PUT") {
            const rows = await tx.query(
              "UPDATE learning_trees SET title=$1,description=$2,published=$3 WHERE id=$4 RETURNING id",
              [data.title, data.description, data.published, tid],
            );
            if (!rows.length) fail(404, "技能路线不存在");
            await tx.query("DELETE FROM learning_nodes WHERE tree_id=$1", [
              tid,
            ]);
          } else
            await tx.query(
              "INSERT INTO learning_trees(id,title,description,published) VALUES($1,$2,$3,$4)",
              [tid, data.title, data.description, data.published],
            );
          for (const [i, n] of data.nodes.entries())
            await tx.query(
              "INSERT INTO learning_nodes(id,tree_id,title,article_id,challenge_id,prerequisites,position,position_x,position_y) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                n.id,
                tid,
                n.title,
                n.article_id,
                n.challenge_id,
                JSON.stringify(n.prerequisites),
                i,
                n.position?.x ?? null,
                n.position?.y ?? null,
              ],
            );
          await audit(tx, u.id, "learning.tree.save", tid);
        });
        return { id: tid };
      },
    });
}
