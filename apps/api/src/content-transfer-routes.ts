import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { config } from "./config.js";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { requireAdmin } from "./auth.js";
import { audit, type DB } from "./db.js";
import { id } from "./schemas.js";
import { fail, rate } from "./security.js";
import {
  archiveLimit,
  packContent,
  unpackContent,
  type ArchiveFile,
} from "./content-archive.js";
import {
  contentManifest,
  contentPreview,
  exportContent,
  importContent,
  importOptions,
  validateContent,
  type ContentManifest,
} from "./content-transfer.js";

type Stage = {
  owner: string;
  directory: string;
  expires: number;
  manifest: ContentManifest;
  files: Map<string, ArchiveFile>;
  busy: boolean;
  result?: Awaited<ReturnType<typeof importContent>>;
};
const lifetime = 15 * 60 * 1000;
export function contentTransferRoutes(app: FastifyInstance, db: DB) {
  const stages = new Map<string, Stage>();
  const temporary = () => join(config.DATA_DIR, "transfers");
  const allocate = async (kind: string) => {
    await mkdir(temporary(), { recursive: true, mode: 0o700 });
    return mkdtemp(join(temporary(), kind + "-"));
  };
  let working = 0;
  const claim = () => {
    if (working >= 2) fail(429, "正在处理其他文件包，请稍后重试");
    working++;
  };
  const remove = async (token: string, stage: Stage) => {
    stages.delete(token);
    await rm(stage.directory, { recursive: true, force: true });
  };
  const sweep = async () => {
    for (const [token, stage] of stages)
      if (!stage.busy && stage.expires <= Date.now())
        await remove(token, stage);
    const entries = await readdir(temporary(), { withFileTypes: true }).catch(
      () => [],
    );
    const live = new Set([...stages.values()].map((stage) => stage.directory));
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !/^(import|export)-[a-zA-Z0-9]+$/.test(entry.name)
      )
        continue;
      const path = join(temporary(), entry.name);
      if (live.has(path)) continue;
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < Date.now() - lifetime)
        await rm(path, { recursive: true, force: true });
    }
  };
  const timer = setInterval(
    () =>
      void sweep().catch((error) =>
        app.log.error(error, "import cleanup failed"),
      ),
    60000,
  );
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await Promise.all(
      [...stages].map(([token, stage]) => remove(token, stage)),
    );
  });
  app.get("/api/admin/transfers/access", async (req) => {
    requireAdmin(req);
    return { ok: true };
  });
  for (const kind of ["challenge", "contest"] as const) {
    app.get(
      `/api/admin/${kind === "challenge" ? "challenges" : "contests"}/:id/export`,
      async (req, reply) => {
        const user = requireAdmin(req),
          source = id.parse((req.params as { id: string }).id);
        await rate(db, `content-export:${user.id}`, 20, 60);
        claim();
        let directory: string | undefined;
        try {
          directory = await allocate("export");
          const { manifest, files } = await exportContent(db, kind, source);
          const path = join(directory, "export.zip");
          await packContent(path, manifest, files);
          await audit(db, user.id, `${kind}.export`, source);
          const stream = createReadStream(path),
            folder = directory;
          stream.once(
            "close",
            () =>
              void rm(folder, { recursive: true, force: true }).catch(() => {}),
          );
          const title =
            manifest.contest?.config.title ??
            manifest.challenges[0]!.config.title;
          return reply
            .type("application/zip")
            .header("Cache-Control", "private, no-store")
            .header(
              "Content-Disposition",
              `attachment; filename="nebuctf-${kind}-${source}.zip"; filename*=UTF-8''${encodeURIComponent(title + ".zip")}`,
            )
            .send(stream);
        } catch (error) {
          if (directory) await rm(directory, { recursive: true, force: true });
          throw error;
        } finally {
          working--;
        }
      },
    );
  }
  app.post("/api/admin/transfers/preview", async (req) => {
    const user = requireAdmin(req);
    const { kind } = z
      .object({ kind: z.enum(["challenge", "contest"]) })
      .parse(req.query);
    await rate(db, `content-import:${user.id}`, 10, 60);
    await sweep();
    if (
      stages.size >= 4 ||
      [...stages.values()].filter((s) => s.owner === user.id && !s.result)
        .length >= 2
    )
      fail(429, "待导入文件包过多，请先完成或取消已有导入");
    claim();
    let directory: string | undefined;
    try {
      directory = await allocate("import");
      const file = await req.file({
        limits: { fileSize: archiveLimit, files: 1, fields: 0, parts: 1 },
      });
      if (!file) fail(400, "请选择 NebuCTF 导出文件包");
      const path = join(directory, "upload.zip");
      await pipeline(
        file!.file,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
      if (file!.file.truncated) fail(413, "文件包不能超过 256 MiB");
      let unpacked: Awaited<ReturnType<typeof unpackContent>>;
      try {
        unpacked = await unpackContent(path, directory);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode) throw error;
        fail(400, "无法读取文件包，请使用完整的 NebuCTF ZIP 导出文件");
      }
      const manifest = contentManifest.parse(unpacked!.data);
      if (manifest.kind !== kind)
        fail(400, kind === "contest" ? "请选择比赛文件包" : "请选择题目文件包");
      validateContent(manifest, unpacked!.files);
      await rm(path);
      const token = crypto.randomUUID();
      stages.set(token, {
        owner: user.id,
        directory,
        expires: Date.now() + lifetime,
        manifest,
        files: unpacked!.files,
        busy: false,
      });
      return contentPreview(manifest, token, unpacked!.size);
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true });
      throw error;
    } finally {
      working--;
    }
  });
  const owned = (token: string, owner: string) => {
    const stage = stages.get(token);
    if (!stage || stage.owner !== owner || stage.expires <= Date.now())
      fail(404, "导入预览已失效，请重新选择文件");
    return stage!;
  };
  app.post("/api/admin/transfers/:id/commit", async (req) => {
    const user = requireAdmin(req),
      token = id.parse((req.params as { id: string }).id);
    const options = importOptions.parse(req.body),
      stage = owned(token, user.id);
    if (stage.result) return stage.result;
    if (stage.busy) fail(409, "文件包正在导入，请稍后重试");
    claim();
    stage.busy = true;
    try {
      const result = await importContent(
        db,
        user.id,
        stage.manifest,
        stage.files,
        options,
      );
      stage.result = result;
      await rm(stage.directory, { recursive: true, force: true }).catch(
        (error) => app.log.error(error, "completed import cleanup failed"),
      );
      stage.files.clear();
      return result;
    } finally {
      stage.busy = false;
      working--;
    }
  });
  app.delete("/api/admin/transfers/:id", async (req) => {
    const user = requireAdmin(req),
      token = id.parse((req.params as { id: string }).id),
      stage = owned(token, user.id);
    if (stage.busy) fail(409, "文件包正在导入");
    await remove(token, stage);
    return { ok: true };
  });
}
