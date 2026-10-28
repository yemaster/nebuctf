import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { precompress } from "./build/precompress";
const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfVersion = require("pdfjs-dist/package.json").version;
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: ["cmaps", "standard_fonts", "wasm", "LICENSE"].map((name) => ({
        src: join(pdfRoot, name),
        dest: `pdfjs/${pdfVersion}`,
        rename: (_name, _extension, source) => ({
          stripBase: true,
          name: relative(pdfRoot, source),
        }),
      })),
    }),
    precompress(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: /^pdfjs-dist$/,
        replacement: join(pdfRoot, "legacy/build/pdf.mjs"),
      },
    ],
  },
  server: { proxy: { "/api": { target: "http://127.0.0.1:3000", ws: true } } },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "spectator-3d";
          if (/\/node_modules\/(es-toolkit|tiny-invariant)\//.test(id))
            return "shared-utils";
          if (/\/node_modules\/(react-pdf|pdfjs-dist)\//.test(id))
            return "pdf-viewer";
          if (/\/node_modules\/(@uiw|rehype-prism-plus)\//.test(id))
            return "markdown-editor";
          if (/\/node_modules\/(refractor|prismjs)\//.test(id))
            return "code-highlight";
          if (
            /\/node_modules\/(recharts|recharts-scale|@reduxjs|react-redux|redux|reselect|immer|victory-vendor|decimal.js-light|es-toolkit|eventemitter3|tiny-invariant)\//.test(
              id,
            )
          )
            return "charts";
          if (/\/node_modules\/(d3-|internmap)/.test(id)) return "graph-utils";
          if (/\/node_modules\/(@xyflow|@dagrejs|zustand)/.test(id))
            return "flow";
          if (
            /\/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(
              id,
            )
          )
            return "motion";
          if (/react-day-picker|\/date-fns\//.test(id)) return "calendar";
          if (/\/node_modules\/(react-markdown|remark-gfm)\//.test(id))
            return "markdown";
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/radix-ui/")
          )
            return "radix";
          if (
            /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@tanstack|lucide-react|clsx|tailwind-merge|class-variance-authority|sonner|@babel)\//.test(
              id,
            )
          )
            return "vendor";
        },
      },
    },
  },
});
