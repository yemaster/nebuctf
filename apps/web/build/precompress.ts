import { readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Plugin } from "vite";

const compress = promisify(gzip);

// Do compression once at build time, rather than spending server CPU on every load.
export function precompress(): Plugin {
  let directory: string;
  return {
    name: "nebuctf-precompress",
    apply: "build",
    configResolved(config) {
      directory = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        const files: string[] = [];
        async function collect(path: string) {
          for (const entry of await readdir(path, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const file = join(path, entry.name);
            if (entry.isDirectory()) await collect(file);
            else if (/\.(?:html|js|mjs|css|svg|json|wasm)$/.test(entry.name))
              files.push(file);
          }
        }
        await collect(directory);
        let next = 0;
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (next < files.length) {
              const file = files[next++]!;
              const source = await readFile(file);
              if (source.length < 1024) continue;
              const encoded = await compress(source, { level: 9 });
              if (encoded.length >= source.length) continue;
              const info = await stat(file);
              await writeFile(`${file}.gz`, encoded);
              await utimes(`${file}.gz`, info.atime, info.mtime);
            }
          }),
        );
      },
    },
  };
}
