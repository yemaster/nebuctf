import { createReadStream, createWriteStream } from "node:fs";
import { open, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { z } from "zod";
import { config } from "./config.js";
import { imageReference } from "./image-reference.js";
import { validateImage } from "./resources.js";

export const imageUploadLimit = 2 * 1024 ** 3;
export const imageChunkSize = 8 * 1024 ** 2;
export const imageUploadDirectory = () =>
  join(config.DATA_DIR, "image-uploads");
export const imageArchivePath = (id: string, normalized = false) =>
  join(
    imageUploadDirectory(),
    `${z.uuid().parse(id)}${normalized ? ".tar" : ".upload"}`,
  );
export async function removeImageArchive(id: string) {
  await Promise.all(
    [false, true].map((normalized) =>
      rm(imageArchivePath(id, normalized), { force: true }),
    ),
  );
}
const archivePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (s) =>
      !s.startsWith("/") &&
      !s.includes("\\") &&
      !s.includes("\0") &&
      !s.split("/").some((part) => part === ".." || part === "."),
    "镜像归档包含无效路径",
  );
const manifestSchema = z
  .array(
    z.object({
      Config: archivePath,
      RepoTags: z
        .array(imageReference.refine((s) => !s.includes("@")))
        .min(1)
        .max(32),
      Layers: z.array(archivePath).max(256),
    }),
  )
  .min(1)
  .max(32);

async function readArchive(
  path: string,
  visit: (header: tar.Header, stream: AsyncIterable<unknown>) => Promise<void>,
  signal?: AbortSignal,
) {
  const handle = await open(path, "r");
  const magic = Buffer.alloc(2);
  try {
    await handle.read(magic, 0, 2, 0);
  } finally {
    await handle.close();
  }
  const extract = tar.extract();
  let bytes = 0,
    entries = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > 4 * 1024 ** 3 ? Error("镜像归档展开后不能超过 4 GiB") : null,
        chunk,
      );
    },
  });
  extract.on("entry", (header, stream, next) => {
    if (++entries > 65536) {
      extract.destroy(Error("镜像归档文件数量过多"));
      return;
    }
    void visit(header, stream).then(
      () => next(),
      (e) => extract.destroy(e),
    );
  });
  const source = createReadStream(path);
  if (magic[0] === 0x1f && magic[1] === 0x8b)
    await pipeline(source, createGunzip(), limit, extract, { signal });
  else await pipeline(source, limit, extract, { signal });
}

// Read metadata first, then emit only the validated Docker-save manifest and
// its referenced regular files. OCI indexes/repositories cannot add hidden tags.
export async function prepareImageArchive(id: string, signal?: AbortSignal) {
  const source = imageArchivePath(id),
    target = imageArchivePath(id, true);
  const files = new Map<string, number>();
  let manifest: z.infer<typeof manifestSchema> | undefined;
  await readArchive(
    source,
    async (header, stream) => {
      const name = header.name.replace(/^\.\//, "");
      if (header.type !== "file") {
        for await (const _ of stream) {
        }
        return;
      }
      archivePath.parse(name);
      if (files.has(name)) throw Error("镜像归档包含重复文件");
      files.set(name, header.size ?? 0);
      if (name === "manifest.json") {
        if ((header.size ?? 0) > 1024 ** 2) throw Error("镜像清单过大");
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          if (!Buffer.isBuffer(chunk)) throw Error("无效镜像归档");
          chunks.push(chunk);
        }
        manifest = manifestSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
      } else
        for await (const _ of stream) {
        }
    },
    signal,
  );
  if (!manifest) throw Error("请选择 docker save 导出的镜像归档");
  const required = new Set<string>();
  const references = new Set<string>();
  for (const item of manifest) {
    for (const ref of item.RepoTags) {
      validateImage(ref);
      references.add(ref);
    }
    for (const file of [item.Config, ...item.Layers]) {
      if (file === "manifest.json" || !files.has(file))
        throw Error("镜像归档缺少配置或镜像层");
      required.add(file);
    }
  }
  await mkdir(imageUploadDirectory(), { recursive: true });
  const pack = tar.pack();
  const output = pipeline(pack, createWriteStream(target, { mode: 0o600 }), {
    signal,
  });
  // Attach immediately: a disconnected stream must not become an unhandled rejection.
  void output.catch(() => {});
  try {
    pack.entry({ name: "manifest.json" }, JSON.stringify(manifest));
    await readArchive(
      source,
      async (header, stream) => {
        const name = header.name.replace(/^\.\//, "");
        if (header.type === "file" && required.has(name)) {
          await pipeline(
            stream,
            pack.entry({ name, size: header.size, type: "file", mode: 0o644 }),
            { signal },
          );
        } else
          for await (const _ of stream) {
          }
      },
      signal,
    );
    pack.finalize();
    await output;
    return { path: target, references: [...references] };
  } catch (error) {
    pack.destroy(error as Error);
    await output.catch(() => {});
    await rm(target, { force: true });
    throw error;
  }
}
