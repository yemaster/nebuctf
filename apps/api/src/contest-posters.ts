import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { audit, type DB } from "./db.js";
import { requireAdmin } from "./auth.js";
import { contestAccess } from "./context.js";
import { storage } from "./resources.js";
import { id } from "./schemas.js";
import { fail } from "./security.js";
export function posterMime(data: Buffer) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
export function contestPosterRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/admin/contests/:id/poster", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    await contestAccess(db, cid, user, false);
    const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!file) fail(400, "请选择海报图片");
    const data = await file!.toBuffer(),
      mime = posterMime(data);
    if (file!.file.truncated) fail(413, "海报不能超过 5 MiB");
    if (!mime) fail(400, "仅支持 PNG、JPEG 和 WebP 图片");
    const poster = crypto.randomUUID();
    await mkdir(storage(), { recursive: true });
    await writeFile(join(storage(), `poster-${poster}`), data, {
      flag: "wx",
      mode: 0o600,
    });
    let previous: string | undefined;
    try {
      await db.transaction(async (tx) => {
        const [old] = await tx.query(
          "SELECT poster_id FROM contests WHERE id=$1 FOR UPDATE",
          [cid],
        );
        previous = old?.poster_id;
        await tx.query(
          "UPDATE contests SET poster_id=$2,poster_mime=$3 WHERE id=$1",
          [cid, poster, mime],
        );
        await audit(tx, user.id, "contest.poster", cid);
      });
    } catch (error) {
      await unlink(join(storage(), `poster-${poster}`));
      throw error;
    }
    if (previous)
      await unlink(join(storage(), `poster-${previous}`)).catch(() => {});
    return { poster_id: poster };
  });
  app.delete("/api/admin/contests/:id/poster", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    const previous = await db.transaction(async (tx) => {
      const [contest] = await tx.query(
        "SELECT poster_id FROM contests WHERE id=$1 FOR UPDATE",
        [cid],
      );
      if (!contest) fail(404, "比赛不存在");
      await tx.query(
        "UPDATE contests SET poster_id=NULL,poster_mime=NULL WHERE id=$1",
        [cid],
      );
      await audit(tx, user.id, "contest.poster.remove", cid);
      return contest!.poster_id;
    });
    if (previous)
      await unlink(join(storage(), `poster-${previous}`)).catch(() => {});
    return { ok: true };
  });
  app.get("/api/contests/:id/poster", async (req, reply) => {
    const c = await contestAccess(
      db,
      id.parse((req.params as any).id),
      req.user ?? undefined,
      false,
    );
    if (!c?.poster_id) fail(404, "未设置比赛海报");
    return reply
      .type(c!.poster_mime)
      .header("Cache-Control", "private, max-age=300")
      .send(createReadStream(join(storage(), `poster-${c!.poster_id}`)));
  });
}
