import { test } from "node:test";
import React from "react";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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
  assert.ok(
    new JSDOM(html).window.document
      .querySelector("pre")
      ?.textContent?.includes("<script>example</script>"),
  );
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes('href="https://example.com"'));
});

test("code blocks highlight common languages, expose actions and safely fall back for unknown grammars", () => {
  const html = renderToStaticMarkup(
    <Markdown>
      {
        "```python\nimport os\nprint('hello')\n```\n\n```unknown-language\n<script>raw</script>\n```"
      }
    </Markdown>,
  );
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector(".token.keyword")?.textContent, "import");
  assert.equal(document.querySelectorAll('[aria-label="复制代码"]').length, 2);
  assert.equal(document.querySelectorAll('[aria-label="自动换行"]').length, 2);
  assert.equal(document.querySelectorAll('[aria-label="下载代码"]').length, 2);
  assert.equal(
    document.querySelectorAll("pre")[1]?.textContent,
    "<script>raw</script>",
  );
  assert.equal(document.querySelector("script"), null);
});
