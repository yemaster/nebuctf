import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const root = new URL("../apps/web/dist/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL(".vite/manifest.json", root), "utf8"),
);
const results = [];
for (const route of [
  "index.html",
  "src/pages/Home.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Contests.tsx",
  "src/pages/Challenges.tsx",
  "src/pages/Admin.tsx",
  "src/pages/admin/Operations.tsx",
]) {
  const seen = new Set(),
    files = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifest[key];
    assert(entry, `Missing build entry: ${key}`);
    files.add(entry.file);
    for (const file of entry.css ?? []) files.add(file);
    for (const dependency of entry.imports ?? []) visit(dependency);
  }
  visit("index.html");
  const routeKey = manifest[route]
    ? route
    : Object.keys(manifest).find(
        (key) =>
          manifest[key].name ===
          route
            .split("/")
            .at(-1)
            ?.replace(/\.tsx$/, ""),
      );
  assert(routeKey, `Missing route bundle: ${route}`);
  visit(routeKey);
  if (route.startsWith("src/pages/admin/")) visit("src/pages/Admin.tsx");
  let decoded = 0,
    encoded = 0;
  for (const name of files) {
    assert(
      !/markdown-editor|pdf-viewer|spectator-3d|charts-|flow-|web-terminal-/.test(
        name,
      ),
      `Eager heavy dependency on ${route}: ${name}`,
    );
    const file = new URL(name, root),
      source = await readFile(file);
    decoded += source.length;
    if (source.length >= 1024) {
      const compressed = await readFile(new URL(name + ".gz", root));
      assert.deepEqual(
        gunzipSync(compressed),
        source,
        `Invalid compressed asset: ${name}`,
      );
      encoded += compressed.length;
    } else encoded += (await stat(file)).size;
  }
  assert(
    encoded < 400_000,
    `${route} exceeds the 400 kB compressed initial-load budget`,
  );
  results.push({
    route,
    files: files.size,
    decoded_bytes: decoded,
    compressed_bytes: encoded,
  });
}
console.log(JSON.stringify(results, null, 2));
