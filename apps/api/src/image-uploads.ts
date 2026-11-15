import { mkdir, open } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "./auth.js";
import { audit, lock, type DB } from "./db.js";
import { fail, rate } from "./security.js";
import { id } from "./schemas.js";
import { imageStatus } from "./images.js";
import {
  imageArchivePath,
  imageChunkSize,
  imageUploadDirectory,
  imageUploadLimit,
  removeImageArchive,
} from "./image-archive.js";

export async function cleanImageUploads(db: DB) {
  await db.transaction(async (tx) => {
    const rows =
      await tx.query(`SELECT u.id FROM docker_image_uploads u LEFT JOIN docker_image_pulls j ON j.id=u.job_id
      WHERE (u.job_id IS NULL AND u.updated_at<now()-interval '24 hours') OR j.status IN ('failed','succeeded') FOR UPDATE OF u`);
    for (const row of rows) {
      await removeImageArchive(row.id);
      await tx.query("DELETE FROM docker_image_uploads WHERE id=$1", [row.id]);
    }
  });
}
export function imageUploadRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/admin/images/uploads", async (req) => {
    const user = requireAdmin(req);
    const input = z
      .object({
        filename: z
          .string()
          .min(1)
          .max(200)
          .regex(/\.(tar|tar\.gz|tgz)$/i, "请选择 .tar 或 .tar.gz 镜像归档"),
        size: z
          .number()
          .int()
          .min(1)
          .max(imageUploadLimit, "镜像文件不能超过 2 GiB"),
      })
      .parse(req.body);
    await rate(db, `image-upload:${user.id}`, 10, 60);
    await cleanImageUploads(db);
    return db.transaction(async (tx) => {
      await lock(tx);
      if (!(await imageStatus(tx)).online)
        fail(409, "Docker Worker 暂不可用，请稍后重试");
      const [count] = await tx.query(
        "SELECT count(*)::int n FROM docker_image_uploads",
      );
      if (count!.n >= 4) fail(409, "上传队列已满，请稍后重试");
      const uid = crypto.randomUUID();
      await mkdir(imageUploadDirectory(), { recursive: true });
      const file = await open(imageArchivePath(uid), "wx", 0o600);
      await file.close();
      try {
        await tx.query(
          "INSERT INTO docker_image_uploads(id,requested_by,filename,size) VALUES($1,$2,$3,$4)",
          [uid, user.id, input.filename, input.size],
        );
      } catch (error) {
        await removeImageArchive(uid);
        throw error;
      }
      return { id: uid, chunk_size: imageChunkSize };
    });
  });
  app.put("/api/admin/images/uploads/:id", async (req) => {
    const user = requireAdmin(req),
      uid = id.parse((req.params as any).id);
    const { offset } = z
      .object({ offset: z.coerce.number().int().min(0).max(imageUploadLimit) })
      .parse(req.query);
    const [owned] = await db.query(
      "SELECT id FROM docker_image_uploads WHERE id=$1 AND requested_by=$2 AND job_id IS NULL",
      [uid, user.id],
    );
    if (!owned) fail(404, "上传任务不存在");
    const part = await req.file({
      limits: { fileSize: imageChunkSize, files: 1, fields: 0, parts: 1 },
    });
    if (!part) return fail(400, "请选择镜像文件");
    const chunk = await part.toBuffer();
    if (!chunk.length) fail(400, "上传分块不能为空");
    return db.transaction(async (tx) => {
      const [upload] = await tx.query(
        "SELECT * FROM docker_image_uploads WHERE id=$1 AND requested_by=$2 FOR UPDATE",
        [uid, user.id],
      );
      if (!upload || upload.job_id) return fail(409, "上传任务已结束");
      if (offset !== Number(upload.received))
        fail(409, "上传进度不匹配，请重新上传");
      if (offset + chunk.length > Number(upload.size))
        fail(400, "上传内容超出文件大小");
      const file = await open(imageArchivePath(uid), "r+");
      try {
        await file.truncate(offset);
        let written = 0;
        while (written < chunk.length) {
          const result = await file.write(
            chunk,
            written,
            chunk.length - written,
            offset + written,
          );
          if (!result.bytesWritten) throw Error("镜像文件写入失败");
          written += result.bytesWritten;
        }
      } finally {
        await file.close();
      }
      await tx.query(
        "UPDATE docker_image_uploads SET received=$2,updated_at=now() WHERE id=$1",
        [uid, offset + chunk.length],
      );
      return { received: offset + chunk.length };
    });
  });
  app.post("/api/admin/images/uploads/:id/complete", async (req) => {
    const user = requireAdmin(req),
      uid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [upload] = await tx.query(
        "SELECT * FROM docker_image_uploads WHERE id=$1 AND requested_by=$2 FOR UPDATE",
        [uid, user.id],
      );
      if (!upload) return fail(404, "上传任务不存在");
      if (upload.job_id) return { id: upload.job_id };
      if (Number(upload.received) !== Number(upload.size))
        fail(409, "文件尚未上传完成");
      if (!(await imageStatus(tx)).online)
        fail(409, "Docker Worker 暂不可用，请稍后重试");
      const [count] = await tx.query(
        "SELECT count(*)::int n FROM docker_image_pulls WHERE status IN ('queued','pulling')",
      );
      if (count!.n >= 16) fail(409, "镜像任务队列已满，请稍后重试");
      const jid = crypto.randomUUID();
      await tx.query(
        "INSERT INTO docker_image_pulls(id,reference,requested_by,status,kind) VALUES($1,$2,$3,'queued','load')",
        [jid, upload.filename, user.id],
      );
      await tx.query(
        "UPDATE docker_image_uploads SET job_id=$2,updated_at=now() WHERE id=$1",
        [uid, jid],
      );
      await audit(tx, user.id, "image.load", jid);
      return { id: jid };
    });
  });
  app.delete("/api/admin/images/uploads/:id", async (req) => {
    const user = requireAdmin(req),
      uid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      const [upload] = await tx.query(
        "SELECT * FROM docker_image_uploads WHERE id=$1 AND requested_by=$2 FOR UPDATE",
        [uid, user.id],
      );
      if (!upload) return { ok: true };
      if (upload.job_id) fail(409, "镜像已进入导入队列");
      await removeImageArchive(uid);
      await tx.query("DELETE FROM docker_image_uploads WHERE id=$1", [uid]);
      return { ok: true };
    });
  });
}
