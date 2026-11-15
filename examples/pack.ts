import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { challengeInput } from "../apps/api/src/schemas.js";
import { packContent } from "../apps/api/src/content-archive.js";
import {
  contentManifest,
  requiredFlags,
  validateContent,
} from "../apps/api/src/content-transfer.js";
import { makeTar, readUpdatePackage } from "../apps/api/src/patch-archive.js";

const examples = [
  "dynamic-container",
  "dynamic-attachment",
  "multi-flag",
  "multi-container",
  "awdp",
  "awd",
];
const root = fileURLToPath(new URL("./", import.meta.url));
const output = resolve(process.argv[2] ?? join(root, "dist"));
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".build-"));
try {
  for (const name of examples) {
    const config = challengeInput.parse(
      JSON.parse(await readFile(join(root, name, "challenge.json"), "utf8")),
    );
    config.parts = config.parts?.map((part) => ({
      ...part,
      id: part.id ?? randomUUID(),
    }));
    const manifest = contentManifest.parse({
      format: "nebuctf-content",
      version: 1,
      kind: "challenge",
      exported_at: new Date().toISOString(),
      // Public examples have no originating site's secret or reusable Flag hashes.
      flag_key_id: createHash("sha256")
        .update("nebuctf-public-examples:v1")
        .digest("hex"),
      challenges: [
        {
          id: randomUUID(),
          config,
          flag_hash: "",
          part_hashes: {},
          attachments: [],
        },
      ],
      contest: null,
    });
    validateContent(manifest, new Map());
    if (requiredFlags(manifest).length)
      throw Error(`${name}: 示例必须提供完整的 Flag 配置`);
    await packContent(join(staging, `${name}.zip`), manifest, new Map());
  }
  const patch = gzipSync(
    makeTar(
      await Promise.all(
        ["update.sh", "files/settings.py"].map(async (name) => ({
          name,
          data: await readFile(join(root, "attack-defense", "patch", name)),
          executable: name === "update.sh",
        })),
      ),
    ),
  );
  readUpdatePackage(patch);
  await writeFile(join(staging, "fix.tar.gz"), patch);
  for (const name of [...examples.map((name) => `${name}.zip`), "fix.tar.gz"]) {
    await rename(join(staging, name), join(output, name));
    console.log(relative(process.cwd(), join(output, name)));
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
