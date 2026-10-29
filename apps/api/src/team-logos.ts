import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { processAvatar } from "./avatars.js";
import { requireUser } from "./auth.js";
import { audit, type DB } from "./db.js";
import { config } from "./config.js";
import { id } from "./schemas.js";
import { fail, rate } from "./security.js";

const avatarLimit = 5 * 1024 * 1024;
export const teamLogoDirectory = () => join(config.DATA_DIR, "team-logos");
const avatarDirectory = teamLogoDirectory;
export function teamLogoRoutes(app: FastifyInstance, db: DB) {
  const processing = new Set<string>();
  const remove = async (avatar: string | null | undefined) => {
    if (!avatar) return;
    await unlink(join(avatarDirectory(), `${avatar}.webp`)).catch((error) => {
      if (error.code !== "ENOENT")
        app.log.error(error, "team logo cleanup failed");
    });
  };
  app.post("/api/teams/:id/logo", async (req) => {
    const user = requireUser(req),
      team = id.parse((req.params as any).id);
    const [owned] = await db.query(
      "SELECT id FROM teams WHERE id=$1 AND captain_id=$2",
      [team, user.id],
    );
    if (!owned) fail(403, "仅队长可以修改战队 Logo");
    await rate(db, `team-logo:${user.id}`, 10, 60);
    if (processing.has(team) || processing.size >= 2)
      fail(429, "正在处理 Logo，请稍后重试");
    processing.add(team);
    let avatar: string | undefined;
    let committed = false;
    try {
      const file = await req.file({ limits: { fileSize: avatarLimit } });
      if (!file) fail(400, "请选择 Logo 图片");
      const input = await file!.toBuffer();
      if (file!.file.truncated) fail(413, "Logo 不能超过 5 MiB");
      let output: Buffer;
      try {
        output = (await processAvatar(input))!;
      } catch (error) {
        if ((error as any).statusCode)
          fail(
            (error as any).statusCode,
            (error as Error).message.replaceAll("头像", "Logo"),
          );
        throw error;
      }
      avatar = crypto.randomUUID();
      await mkdir(avatarDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(join(avatarDirectory(), `${avatar}.webp`), output!, {
        flag: "wx",
        mode: 0o600,
      });
      const previous = await db.transaction(async (tx) => {
        const [old] = await tx.query(
          "SELECT logo_id FROM teams WHERE id=$1 AND captain_id=$2 FOR UPDATE",
          [team, user.id],
        );
        if (!old) fail(403, "仅队长可以修改战队 Logo");
        await tx.query("UPDATE teams SET logo_id=$2 WHERE id=$1", [
          team,
          avatar,
        ]);
        await audit(tx, user.id, "team.logo", team);
        return old?.logo_id;
      });
      committed = true;
      await remove(previous);
      return { logo_id: avatar };
    } catch (error) {
      if (!committed) await remove(avatar);
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE")
        fail(413, "Logo 不能超过 5 MiB");
      throw error;
    } finally {
      processing.delete(team);
    }
  });
  app.delete("/api/teams/:id/logo", async (req) => {
    const user = requireUser(req),
      team = id.parse((req.params as any).id);
    const [owned] = await db.query(
      "SELECT id FROM teams WHERE id=$1 AND captain_id=$2",
      [team, user.id],
    );
    if (!owned) fail(403, "仅队长可以修改战队 Logo");
    await rate(db, `team-logo:${user.id}`, 10, 60);
    if (processing.has(team)) fail(409, "Logo 正在保存，请稍后重试");
    const previous = await db.transaction(async (tx) => {
      const [old] = await tx.query(
        "SELECT logo_id FROM teams WHERE id=$1 AND captain_id=$2 FOR UPDATE",
        [team, user.id],
      );
      if (!old) fail(403, "仅队长可以修改战队 Logo");
      await tx.query("UPDATE teams SET logo_id=NULL WHERE id=$1", [team]);
      await audit(tx, user.id, "team.logo.remove", team);
      return old?.logo_id;
    });
    await remove(previous);
    return { logo_id: null };
  });
  app.get("/api/team-logos/:id", async (req, reply) => {
    const avatar = id.parse((req.params as { id: string }).id);
    let data: Buffer;
    try {
      data = await readFile(join(avatarDirectory(), `${avatar}.webp`));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT")
        fail(404, "Logo不存在");
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
