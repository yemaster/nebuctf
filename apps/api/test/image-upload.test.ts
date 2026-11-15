import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { config } from "../src/config.js";
import {
  imageArchivePath,
  imageUploadDirectory,
  prepareImageArchive,
} from "../src/image-archive.js";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ImageWorker } from "../src/image-worker.js";
import { DockerEngine, type PullEvent } from "../src/docker.js";
import { verified } from "./helpers/captcha.js";

async function archive(
  tags = ["nebuctf/upload:one"],
  extras: [string, string][] = [],
  layerSize = 16,
) {
  const pack = tar.pack(),
    chunks: Buffer[] = [];
  const collect = (async () => {
    for await (const chunk of pack) chunks.push(chunk as Buffer);
  })();
  pack.entry(
    { name: "manifest.json" },
    JSON.stringify([
      { Config: "config.json", RepoTags: tags, Layers: ["layer.tar"] },
    ]),
  );
  pack.entry({ name: "config.json" }, "{}");
  pack.entry({ name: "layer.tar" }, Buffer.alloc(layerSize, 7));
  for (const [name, data] of extras) pack.entry({ name }, data);
  pack.finalize();
  await collect;
  return Buffer.concat(chunks);
}
async function entries(data: Buffer) {
  const extract = tar.extract(),
    result: Record<string, Buffer> = {};
  const done = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.on("end", () => {
        result[header.name] = Buffer.concat(chunks);
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });
  extract.end(data);
  await done;
  return result;
}
class ImportDocker extends DockerEngine {
  imports = 0;
  async listImages() {
    return this.imports
      ? [
          {
            Id: "sha256:test",
            RepoTags: ["nebuctf/upload:one", "nebuctf/upload:two"],
            RepoDigests: [],
            Size: 100,
          },
        ]
      : [];
  }
  async inspectImage() {
    return {};
  }
  async loadImage(input: Readable, progress: (e: PullEvent) => void) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) chunks.push(chunk);
    const data = await entries(Buffer.concat(chunks));
    assert.ok(data["manifest.json"]);
    assert.equal(data["index.json"], undefined);
    this.imports++;
    progress({ stream: "Loaded image: nebuctf/upload:one\n" });
  }
}
test("image archive validates tags and paths, accepts gzip and strips other manifests", async (t) => {
  const old = config.DATA_DIR;
  config.DATA_DIR = await mkdtemp(join(tmpdir(), "nct-archive-"));
  t.after(async () => {
    await rm(config.DATA_DIR, { recursive: true, force: true });
    config.DATA_DIR = old;
  });
  await mkdir(imageUploadDirectory());
  const id = crypto.randomUUID();
  const valid = await archive(
    ["nebuctf/upload:one", "nebuctf/upload:two"],
    [
      ["index.json", '{"untrusted":"outside/prefix"}'],
      ["repositories", "{}"],
    ],
  );
  for (const data of [valid, gzipSync(valid)]) {
    await writeFile(imageArchivePath(id), data);
    const result = await prepareImageArchive(id);
    assert.equal(result.references.length, 2);
    assert.deepEqual(
      Object.keys(await entries(await readFile(result.path))).sort(),
      ["config.json", "layer.tar", "manifest.json"],
    );
  }
  for (const data of [
    await archive(["outside/prefix:one"]),
    await archive([]),
    await archive(undefined, [["../bad", "bad"]]),
    await archive(undefined, [["config.json", "duplicate"]]),
    Buffer.from("not a tar"),
    valid.subarray(0, 100),
  ]) {
    await writeFile(imageArchivePath(id), data);
    await assert.rejects(prepareImageArchive(id));
  }
});
test(
  "image upload enforces access and offsets, preserves chunks, queues import and cleans files",
  { timeout: 60000 },
  async (t) => {
    const old = config.DATA_DIR;
    config.DATA_DIR = await mkdtemp(join(tmpdir(), "nct-upload-"));
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      docker = new ImportDocker(),
      worker = new ImageWorker(db, docker);
    t.after(async () => {
      await worker.stop();
      await app.close();
      await db.close();
      await rm(config.DATA_DIR, { recursive: true, force: true });
      config.DATA_DIR = old;
    });
    async function register(name: string) {
      const r = await verified(app, {
        method: "POST",
        url: "/api/auth/register",
        headers: { origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
        payload: {
          username: name,
          email: `${name}@example.test`,
          password: "eight888",
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      return {
        id: r.json().user.id,
        cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      };
    }
    const admin = await register("uploadadmin"),
      other = await register("uploadother");
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
    const headers = {
      cookie: admin.cookie,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
    };
    const post = (path: string, payload = {}) =>
      app.inject({
        url: `/api/admin/images${path}`,
        method: "POST",
        headers,
        payload,
      });
    const bytes = await archive(
      ["nebuctf/upload:one", "nebuctf/upload:two"],
      [["index.json", "{}"]],
      8 * 1024 ** 2 + 16,
    );
    const input = { filename: "images.tar", size: bytes.length };
    assert.equal((await post("/uploads", input)).statusCode, 409);
    await worker.tick();
    assert.equal(
      (
        await app.inject({
          url: "/api/admin/images/uploads",
          method: "POST",
          headers: { ...headers, cookie: other.cookie },
          payload: input,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await post("/uploads", { ...input, size: 3 * 1024 ** 3 })).statusCode,
      400,
    );
    const created = await post("/uploads", input);
    assert.equal(created.statusCode, 200, created.body);
    const upload = created.json();
    const put = (offset: number, data: Buffer, cookie = admin.cookie) =>
      app.inject({
        url: `/api/admin/images/uploads/${upload.id}?offset=${offset}`,
        method: "PUT",
        headers: {
          ...headers,
          cookie,
          "content-type": "multipart/form-data; boundary=nct-boundary",
        },
        payload: Buffer.concat([
          Buffer.from(
            '--nct-boundary\r\nContent-Disposition: form-data; name="file"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n',
          ),
          data,
          Buffer.from("\r\n--nct-boundary--\r\n"),
        ]),
      });
    assert.equal(
      (await post(`/uploads/${upload.id}/complete`)).statusCode,
      409,
    );
    assert.equal(
      (await put(0, bytes.subarray(0, 10), other.cookie)).statusCode,
      403,
    );
    assert.equal((await put(1, bytes.subarray(0, 10))).statusCode, 409);
    for (let offset = 0; offset < bytes.length; offset += upload.chunk_size) {
      const r = await put(
        offset,
        bytes.subarray(offset, offset + upload.chunk_size),
      );
      assert.equal(r.statusCode, 200, r.body);
    }
    assert.deepEqual(await readFile(imageArchivePath(upload.id)), bytes);
    assert.equal((await put(0, Buffer.from("duplicate"))).statusCode, 409);
    const submitted = await post(`/uploads/${upload.id}/complete`);
    assert.equal(submitted.statusCode, 200, submitted.body);
    assert.equal(
      (await post(`/uploads/${upload.id}/complete`)).json().id,
      submitted.json().id,
    );
    async function finish(jid: string) {
      await worker.tick();
      for (let i = 0; i < 300; i++) {
        const [job] = await db.query(
          "SELECT * FROM docker_image_pulls WHERE id=$1",
          [jid],
        );
        if (["succeeded", "failed"].includes(job!.status)) {
          await worker.stop();
          return job!;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error("image job timeout");
    }
    const done = await finish(submitted.json().id);
    assert.equal(done.status, "succeeded", done.error);
    assert.equal(docker.imports, 1);
    await assert.rejects(access(imageArchivePath(upload.id)));
    const inventory = await app.inject({
      url: "/api/admin/images?usage=unused",
      headers,
    });
    assert.equal(inventory.statusCode, 200, inventory.body);
    assert.equal(inventory.json().items.length, 2);
    assert.ok(
      inventory
        .json()
        .items.every(
          (image: any) => image.job_kind === "load" && image.present,
        ),
    );
    const progress = await app.inject({
      url: `/api/admin/images/pulls/${submitted.json().id}`,
      headers,
    });
    assert.equal(progress.json().kind, "load");
    assert.match(
      progress
        .json()
        .logs.map((line: any) => line.message)
        .join("\n"),
      /Loaded image/,
    );
    const bad = await post("/uploads", { filename: "bad.tar", size: 3 });
    await writeFile(imageArchivePath(bad.json().id), "bad");
    await db.query("UPDATE docker_image_uploads SET received=3 WHERE id=$1", [
      bad.json().id,
    ]);
    const failed = await post(`/uploads/${bad.json().id}/complete`);
    assert.equal((await finish(failed.json().id)).status, "failed");
    assert.equal(docker.imports, 1);
    await assert.rejects(access(imageArchivePath(bad.json().id)));
  },
);
