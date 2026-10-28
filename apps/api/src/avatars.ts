import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { requireUser } from "./auth.js";
import { audit, type DB } from "./db.js";
import { config } from "./config.js";
import { id } from "./schemas.js";
import { fail, rate } from "./security.js";
import { posterMime } from "./contest-posters.js";

export const avatarLimit = 5 * 1024 * 1024;
export const avatarDirectory = () => join(config.DATA_DIR, "avatars");
sharp.cache(false);
sharp.concurrency(1);

export async function processAvatar(input: Buffer) {
  if (!input.length || input.length > avatarLimit)
    fail(413, "头像不能超过 5 MiB");
  if (!posterMime(input)) fail(400, "请选择 PNG、JPEG 或 WebP 图片");
  try {
    const image = sharp(input, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1)
      fail(400, "请选择静态图片");
    // Decoding and re-encoding discards EXIF, GPS and the original file bytes.
    return await image
      .autoOrient()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 82, effort: 3 })
      .timeout({ seconds: 5 })
      .toBuffer();
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    fail(400, "图片无法处理，请使用完整图片且不超过 1600 万像素");
  }
}

export function avatarRoutes(app: FastifyInstance, db: DB) {
  const processing = new Set<string>();
  const remove = async (avatar: string | null | undefined) => {
    if (!avatar) return;
    await unlink(join(avatarDirectory(), `${avatar}.webp`)).catch((error) => {
      if (error.code !== "ENOENT")
        app.log.error(error, "avatar cleanup failed");
    });
  };
  app.post("/api/account/avatar", async (req) => {
    const user = requireUser(req);
    await rate(db, `avatar:${user.id}`, 10, 60);
    if (processing.has(user.id) || processing.size >= 2)
      fail(429, "正在处理头像，请稍后重试");
    processing.add(user.id);
    let avatar: string | undefined;
    let committed = false;
    try {
      const file = await req.file({ limits: { fileSize: avatarLimit } });
      if (!file) fail(400, "请选择头像图片");
      const input = await file!.toBuffer();
      if (file!.file.truncated) fail(413, "头像不能超过 5 MiB");
      const output = await processAvatar(input);
      avatar = crypto.randomUUID();
      await mkdir(avatarDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(join(avatarDirectory(), `${avatar}.webp`), output!, {
        flag: "wx",
        mode: 0o600,
      });
      const previous = await db.transaction(async (tx) => {
        const [old] = await tx.query(
          "SELECT avatar_id FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        );
        await tx.query("UPDATE users SET avatar_id=$2 WHERE id=$1", [
          user.id,
          avatar,
        ]);
        await audit(tx, user.id, "user.avatar", user.id);
        return old?.avatar_id;
      });
      committed = true;
      await remove(previous);
      return { avatar_id: avatar };
    } catch (error) {
      if (!committed) await remove(avatar);
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE")
        fail(413, "头像不能超过 5 MiB");
      throw error;
    } finally {
      processing.delete(user.id);
    }
  });
  app.delete("/api/account/avatar", async (req) => {
    const user = requireUser(req);
    await rate(db, `avatar:${user.id}`, 10, 60);
    if (processing.has(user.id)) fail(409, "头像正在保存，请稍后重试");
    const previous = await db.transaction(async (tx) => {
      const [old] = await tx.query(
        "SELECT avatar_id FROM users WHERE id=$1 FOR UPDATE",
        [user.id],
      );
      await tx.query("UPDATE users SET avatar_id=NULL WHERE id=$1", [user.id]);
      await audit(tx, user.id, "user.avatar.remove", user.id);
      return old?.avatar_id;
    });
    await remove(previous);
    return { avatar_id: null };
  });
  app.get("/api/avatars/:id", async (req, reply) => {
    const avatar = id.parse((req.params as { id: string }).id);
    let data: Buffer;
    try {
      data = await readFile(join(avatarDirectory(), `${avatar}.webp`));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT")
        fail(404, "头像不存在");
      throw error;
    }
    const etag = `"${avatar}"`;
    reply
      .type("image/webp")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("ETag", etag);
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(data);
  });
}
