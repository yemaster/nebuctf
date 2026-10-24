import { test } from "node:test";
import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/markdown";
test("tutorial markdown suppresses raw HTML and dangerous URL protocols", () => {
  const html = renderToStaticMarkup(
    <Markdown>
      {
        "<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>"
      }
    </Markdown>,
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("onerror="));
});
test("tutorial markdown preserves code, tables and normal HTTPS links", () => {
  const html = renderToStaticMarkup(
    <Markdown>
      {
        "## 示例\n\n```html\n<script>example</script>\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Docs](https://example.com)"
      }
    </Markdown>,
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes('href="https://example.com"'));
});
