import type { FastifyReply, FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { storage } from "./resources.js";
import { fail } from "./security.js";
import type { WriteupConfig } from "./writeup-config.js";
import type { Row } from "./db.js";

export const writeupPath = (file: string) => join(storage(), `writeup-${file}`);
export const removeWriteup = (file: string) =>
  unlink(writeupPath(file)).catch(() => {});
export function safeWriteupName(name: string) {
  return (
    name
      .replace(/[\x00-\x1f\x7f\\/<>:"|?*]/g, "_")
      .replace(/^\.+/, "_")
      .slice(-180) || "writeup.pdf"
  );
}
export async function receiveWriteup(
  req: FastifyRequest,
  config: WriteupConfig,
) {
  const fileId = crypto.randomUUID(),
    path = writeupPath(fileId);
  await mkdir(storage(), { recursive: true });
  let found = false,
    result:
      | { file_id: string; name: string; format: string; size: number }
      | undefined;
  try {
    for await (const part of req.parts({
      limits: {
        fileSize: config.max_size_mb * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 1,
      },
    })) {
      if (part.type !== "file" || found)
        return fail(400, "每次只能提交一个文件");
      found = true;
      const name = safeWriteupName(part.filename),
        format = extname(name).slice(1).toLowerCase();
      if (!config.formats.includes(format as "pdf" | "zip")) {
        part.file.resume();
        fail(
          400,
          `仅支持 ${config.formats.map((f) => f.toUpperCase()).join("、")} 文件`,
        );
      }
      let size = 0,
        head = Buffer.alloc(0),
        tail = Buffer.alloc(0);
      const inspect = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (head.length < 8)
            head = Buffer.concat([head, chunk]).subarray(0, 8);
          tail = Buffer.concat([tail, chunk]).subarray(-65557);
          callback(null, chunk);
        },
      });
      await pipeline(
        part.file,
        inspect,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
      if (part.file.truncated || size > config.max_size_mb * 1024 * 1024)
        fail(413, `WriteUp 不能超过 ${config.max_size_mb} MiB`);
      if (!size) fail(400, "文件不能为空");
      if (
        format === "pdf" &&
        (head.toString("ascii", 0, 5) !== "%PDF-" ||
          !tail.includes(Buffer.from("%%EOF")))
      )
        fail(400, "文件内容不是有效的 PDF");
      if (format === "zip") {
        let end = -1;
        for (let i = tail.length - 22; i >= 0; i--)
          if (
            tail.readUInt32LE(i) === 0x06054b50 &&
            i + 22 + tail.readUInt16LE(i + 20) === tail.length
          ) {
            end = i;
            break;
          }
        if (
          head.length < 4 ||
          head.readUInt32LE(0) !== 0x04034b50 ||
          end < 0 ||
          tail.readUInt16LE(end + 4) !== 0 ||
          tail.readUInt16LE(end + 6) !== 0 ||
          !tail.readUInt16LE(end + 10)
        )
          fail(400, "请提交包含 WriteUp 的完整 ZIP 文件");
      }
      result = { file_id: fileId, name, format, size };
    }
    if (!result) fail(400, "请选择 WriteUp 文件");
    return result!;
  } catch (error) {
    await removeWriteup(fileId);
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE")
      fail(413, `WriteUp 不能超过 ${config.max_size_mb} MiB`);
    throw error;
  }
}
async function openWriteup(row: Row) {
  try {
    return await open(writeupPath(row.file_id), "r");
  } catch {
    return fail(409, "文件已更新或暂时不可用，请刷新后重试");
  }
}
export async function sendWriteup(reply: FastifyReply, row: Row) {
  const file = await openWriteup(row);
  return reply
    .type("application/octet-stream")
    .header("Cache-Control", "private, no-store")
    .header("Content-Length", row.size)
    .header(
      "Content-Disposition",
      `attachment; filename="writeup.${row.format}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    )
    .send(file.createReadStream());
}
export async function sendWriteupArchive(reply: FastifyReply, rows: Row[]) {
  if (!rows.length) fail(400, "没有可导出的 WriteUp");
  if (
    rows.length > 100 ||
    rows.reduce((n, r) => n + Number(r.size), 0) > 250 * 1024 * 1024
  )
    fail(400, "单次最多导出 100 份、250 MiB，请按组别或勾选战队分批导出");
  // Open handles before streaming so concurrent replacements cannot invalidate this archive.
  const opened: { row: Row; file: Awaited<ReturnType<typeof open>> }[] = [];
  try {
    for (const row of rows) opened.push({ row, file: await openWriteup(row) });
  } catch (error) {
    await Promise.all(opened.map((v) => v.file.close()));
    throw error;
  }
  const zip = new ZipFile();
  zip.on("error", (error) => (zip.outputStream as Readable).destroy(error));
  zip.outputStream.once("close", () => {
    void Promise.all(opened.map((v) => v.file.close().catch(() => {})));
  });
  for (const { row, file } of opened)
    zip.addReadStreamLazy(
      `${row.team_id}/${safeWriteupName(row.name)}`,
      { size: row.size, compress: false },
      (callback) => callback(null, file.createReadStream({ autoClose: false })),
    );
  zip.addBuffer(
    Buffer.from(
      JSON.stringify(
        rows.map((r) => ({
          team_id: r.team_id,
          team: r.team_name,
          group: r.group_name,
          filename: r.name,
          version: r.version,
          submitted_at: r.submitted_at,
        })),
        null,
        2,
      ),
    ),
    "manifest.json",
  );
  zip.end();
  return reply
    .type("application/zip")
    .header("Cache-Control", "private, no-store")
    .header("Content-Disposition", 'attachment; filename="writeups.zip"')
    .send(zip.outputStream);
}
