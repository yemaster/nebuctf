import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";
import { ZipFile } from "yazl";
import { fail } from "./security.js";

export const archiveLimit = 256 * 1024 * 1024;
export const contentLimit = archiveLimit - 2 * 1024 * 1024;
const manifestLimit = 8 * 1024 * 1024;
const fileLimit = 20 * 1024 * 1024;
export type ArchiveFile = { path: string; size: number; sha256: string };

// Never extract archive paths. Only UUID-named blobs enter the temporary folder.
// All limits apply to actual expanded bytes as well as central-directory metadata.
export async function unpackContent(path: string, directory: string) {
  const files = new Map<string, ArchiveFile>();
  const zip = await openPromise(path, {
    lazyEntries: true,
    strictFileNames: true,
  });
  let total = 0;
  try {
    if (zip.entryCount > 2001) fail(413, "文件包最多包含 2000 个资源文件");
    for await (const entry of zip.eachEntry()) {
      const manifest = entry.fileName === "manifest.json";
      if (
        !manifest &&
        !/^files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          entry.fileName,
        )
      )
        fail(400, "文件包包含无效路径");
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        (mode && mode !== 0x8000) ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod)
      )
        fail(400, "文件包只支持未加密的普通文件");
      if (files.has(entry.fileName)) fail(400, "文件包包含重复文件");
      const limit = manifest ? manifestLimit : fileLimit;
      if (
        entry.uncompressedSize > limit ||
        total + entry.uncompressedSize > contentLimit
      )
        fail(413, "文件包解压后超过大小限制");
      const target = join(
        directory,
        manifest ? "manifest.json" : entry.fileName.slice(6),
      );
      const hash = createHash("sha256");
      let size = 0;
      await pipeline(
        await zip.openReadStreamPromise(entry),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            total += chunk.length;
            if (size > limit || total > contentLimit)
              return callback(
                Object.assign(new Error("文件包解压后超过大小限制"), {
                  statusCode: 413,
                }),
              );
            hash.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      );
      if (size !== entry.uncompressedSize) fail(400, "文件包大小校验失败");
      files.set(entry.fileName, {
        path: target,
        size,
        sha256: hash.digest("hex"),
      });
    }
  } finally {
    zip.close();
  }
  const manifest = files.get("manifest.json");
  if (!manifest) fail(400, "文件包缺少 manifest.json");
  let data: unknown;
  try {
    data = JSON.parse(await readFile(manifest!.path, "utf8"));
  } catch {
    fail(400, "文件包配置不是有效的 JSON");
  }
  files.delete("manifest.json");
  return { data, files, size: total };
}

export async function hashFile(path: string) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > fileLimit) fail(413, "单个资源文件不能超过 20 MiB");
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

export async function packContent(
  path: string,
  manifest: unknown,
  files: Map<string, ArchiveFile>,
) {
  if (files.size > 2000)
    fail(413, "文件包最多包含 2000 个资源文件，请分题导出");
  const data = Buffer.from(JSON.stringify(manifest, null, 2));
  if (
    data.length > manifestLimit ||
    [...files.values()].reduce((n, f) => n + f.size, data.length) > contentLimit
  )
    fail(413, "导出内容超过 254 MiB，请分题导出");
  const zip = new ZipFile();
  zip.on("error", (error) => (zip.outputStream as Readable).destroy(error));
  const output = pipeline(
    zip.outputStream,
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  zip.addBuffer(data, "manifest.json");
  for (const [id, file] of files)
    zip.addFile(file.path, `files/${id}`, { mode: 0o100600 });
  zip.end();
  await output;
  if ((await stat(path)).size > archiveLimit)
    fail(413, "导出文件包超过 256 MiB");
}
