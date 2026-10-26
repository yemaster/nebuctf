import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "../src/App";
const id = "10000000-0000-4000-8000-000000000001",
  contestId = "20000000-0000-4000-8000-000000000001";
const base = {
  id,
  title: "分步挑战",
  description: "题目正文",
  category: "Misc",
  difficulty: "入门",
  kind: "static_attachment",
  points: 300,
  solves: 0,
  solved: false,
  solved_parts: 1,
  total_parts: 2,
  hints: [],
  attachments: [],
  parts: [
    {
      id: "p1",
      title: "Base64",
      description: "",
      points: 100,
      solves: 1,
      solved: true,
    },
    {
      id: "p2",
      title: "Hex",
      description: "",
      points: 200,
      solves: 0,
      solved: false,
    },
  ],
};
async function render(
  path: string,
  completed: boolean,
  scope = "practice",
  registered = true,
  phase: "active" | "before" | "after" = "active",
  permissions?: Record<string, boolean>,
  groups: any[] = [],
  options: { role?: string; challenge?: Record<string, unknown> } = {},
) {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  const c = {
    ...base,
    ...options.challenge,
    permissions,
    solved: completed,
    solved_parts: completed ? 2 : 1,
    parts: base.parts.map((p) => ({ ...p, solved: completed || p.solved })),
  };
  cache.setQueryData(["/me"], {
    user: { id: "player", username: "player", role: options.role ?? "user" },
  });
  cache.setQueryData([`/challenges?scope=${scope}&category=&q=&page=1`], {
    items: [c],
    total: 1,
  });
  cache.setQueryData([`/challenges/${id}?scope=${scope}`], c);
  if (options.challenge?.challenge_type === "objective") {
    cache.setQueryData([`/contests/${scope}/objective-paper`], {
      server_time: new Date().toISOString(),
      items: [
        {
          ...c,
          permissions: { submit: registered },
          saved: {
            answer: {},
            correct: null,
            finalized_at: null,
            revision: null,
          },
        },
      ],
      preview: !registered,
      can_submit: registered,
      practice: false,
      phase: { section: "objective", mode: "inherit", status: "active" },
    });
  }
  cache.setQueryData([`/contests/${contestId}`], {
    id: contestId,
    title: "测试赛事",
    groups,
    registered,
    starts_at: new Date(
      Date.now() + (phase === "before" ? 60000 : -60000),
    ).toISOString(),
    ends_at: new Date(
      Date.now() + (phase === "after" ? -1000 : 120000),
    ).toISOString(),
    description: "比赛规则",
    team_limit: 4,
    registration: registered
      ? { team_name: "测试战队", group_name: "公开组" }
      : null,
  });
  cache.setQueryData(["/teams/mine"], { items: [] });
  try {
    return await new Promise<string>((resolve, reject) => {
      let html = "";
      const output = new Writable({
        write(chunk, _encoding, done) {
          html += chunk.toString();
          done();
        },
      });
      output.on("finish", () => resolve(html));
      const stream = renderToPipeableStream(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
        {
          onAllReady() {
            stream.pipe(output);
          },
          onError: reject,
        },
      );
    });
  } finally {
    cache.clear();
  }
}
test("partially solved challenge keeps the input and shows individual part states", async () => {
  const html = await render(`/challenges?challenge=${id}`, false);
  assert.ok(html.includes(`id="flag-${id}"`));
  assert.ok(html.includes('aria-label="Base64 已通过"'));
  assert.ok(html.includes('aria-label="Hex 未通过"'));
  assert.ok(!html.includes("该题目已解答"));
});
test("fully solved challenge replaces flag controls with a success status", async () => {
  const html = await render(`/challenges?challenge=${id}`, true);
  assert.ok(!html.includes(`id="flag-${id}"`));
  assert.ok(html.includes("该题目已解答"));
  assert.ok(html.includes('data-feedback-motion="none"'));
  assert.ok(!html.includes('data-feedback-motion="submit"'));
});
test("read-only groups see progress without flag controls or resource actions", async () => {
  const html = await render(
    `/contests/${contestId}/challenges`,
    false,
    contestId,
    true,
    "active",
    { view: true, submit: false, resources: false, score: false },
  );
  assert(!html.includes(`id="flag-${id}"`));
  assert(html.includes("暂不开放作答"));
  assert(html.includes("本组作答不计分"));
  assert(html.includes("Base64"));
});
test("closed divisions are clearly marked and prevent opening registration when all are closed", async () => {
  const html = await render(
    `/contests/${contestId}`,
    false,
    contestId,
    false,
    "active",
    undefined,
    [
      {
        id: "g",
        name: "体验组",
        description: "",
        joinable: false,
        rank_overall: false,
      },
    ],
  );
  assert.match(html, /<button[^>]*disabled[^>]*>组别报名已关闭<\/button>/);
  assert(html.includes("仅参与组内排名"));
});
test("contest challenges open the workspace directly with contest-only navigation", async () => {
  const html = await render(
    `/contests/${contestId}/challenges`,
    false,
    contestId,
  );
  assert.ok(html.includes('aria-label="题面"'));
  assert.ok(html.includes('aria-label="比赛导航"'));
  assert.ok(html.includes("返回大厅"));
  const menu =
    html.match(/<nav aria-label="比赛导航"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
  assert.ok(menu.indexOf("概览") < menu.indexOf("公告"));
  assert.ok(menu.indexOf("公告") < menu.indexOf("赛题"));
  assert.ok(!html.includes("min-h-12"));
  assert.ok(!html.includes("退出比赛"));
  assert.ok(!html.includes('href="/problemsets"'));
  assert.ok(!html.includes('aria-label="主导航"'));
});

test("unregistered contest visitors see public navigation and registration, not protected links", async () => {
  const html = await render(`/contests/${contestId}`, false, contestId, false);
  assert.ok(!html.includes(`href="/contests/${contestId}/challenges"`));
  assert.ok(!html.includes(`href="/contests/${contestId}/instances"`));
  assert.ok(html.includes(`href="/contests/${contestId}/scoreboard"`));
  assert.ok(html.includes("战队报名"));
  assert.ok(html.includes('aria-label="账户菜单"'));
  assert.ok(html.indexOf("返回大厅") < html.indexOf('aria-label="账户菜单"'));
});
test("registered teams only see challenges during the active window", async () => {
  for (const phase of ["before", "after"] as const) {
    const html = await render(
      `/contests/${contestId}`,
      false,
      contestId,
      true,
      phase,
    );
    assert.ok(!html.includes(`href="/contests/${contestId}/challenges"`));
    assert.ok(html.includes(`href="/contests/${contestId}/instances"`));
  }
});

test("unregistered staff preview shows registration before any flag or patch submission", async () => {
  for (const type of ["ctf", "awdp", "awd"]) {
    const html = await render(
      `/contests/${contestId}/challenges?challenge=${id}`,
      false,
      contestId,
      false,
      "active",
      undefined,
      [],
      { role: "admin", challenge: { challenge_type: type } },
    );
    assert(html.includes("报名比赛后即可作答"), type);
    assert(html.includes("前往报名"), type);
    assert(!html.includes(`id="flag-${id}"`), type);
    assert(
      !html.includes('type="file"'),
      "preview cannot upload defense patches",
    );
  }
});
test("registered staff can submit flags just like other participants", async () => {
  const html = await render(
    `/contests/${contestId}/challenges?challenge=${id}`,
    false,
    contestId,
    true,
    "active",
    undefined,
    [],
    { role: "admin" },
  );
  assert(html.includes(`id="flag-${id}"`));
  assert(!html.includes("当前为预览"));
});
test("objective preview uses the same registration notice instead of answer controls", async () => {
  const html = await render(
    `/contests/${contestId}/challenges?challenge=${id}`,
    false,
    contestId,
    false,
    "active",
    undefined,
    [],
    {
      role: "admin",
      challenge: {
        challenge_type: "objective",
        objective: { type: "single", options: [{ id: "a", text: "Option" }] },
      },
    },
  );
  assert(html.includes("报名比赛后即可作答"));
  assert(html.includes('role="radiogroup"'), "preview shows the full paper");
  assert(html.includes('disabled=""'), "preview cannot change answers");
  assert(!html.includes("提交答卷"));
  assert(!html.includes("确认提交"));
});

test("unregistered container preview offers a compact registration notice instead of loading denied resources", async () => {
  const html = await render(
    `/contests/${contestId}/challenges?challenge=${id}`,
    false,
    contestId,
    false,
    "active",
    undefined,
    [],
    {
      role: "admin",
      challenge: {
        kind: "dynamic_container",
        resources: { container: true, attachment: true },
      },
    },
  );
  assert(html.includes("报名比赛后可使用环境"));
  assert(html.includes("前往报名"));
  assert(!html.includes("403"));
  assert(!html.includes("启动靶机"));
  assert(!html.includes("生成附件"));
});
