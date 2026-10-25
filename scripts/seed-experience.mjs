import { captchaPurpose, solveCaptcha } from "./captcha.mjs";
// Explicit local demo fixtures. Does not create accounts or submit answers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = "http://localhost:8080";
const accounts = JSON.parse(
  await readFile(".data/local-accounts.json", "utf8"),
);
let cookie = "";
async function request(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  const purpose = captchaPurpose(path);
  if (method === "POST" && purpose) {
    const challenge = await request("/captcha/challenge", { purpose });
    body = { ...body, captcha: solveCaptcha(challenge) };
  }
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      origin: base,
      "x-csrf-protection": "1",
      cookie,
      ...(body === undefined || body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${JSON.stringify(value)}`,
  );
  if (path === "/auth/login")
    cookie = response.headers.get("set-cookie").split(";")[0];
  return value;
}
async function allItems(path) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await request(`${path}?page=${page}&page_size=100`);
    items.push(...result.items);
    if (items.length >= result.total || !result.items.length) return items;
  }
}
await request("/auth/login", accounts.admin);
try {
  const existing = await allItems("/admin/challenges");
  const common = {
    category: "Misc",
    difficulty: "入门",
    kind: "static_attachment",
    published: true,
    dynamic_score: false,
  };
  const parts = [
    {
      title: "Base64",
      flag: "flag{base64_unlocked}",
      initial_points: 100,
      minimum_points: 100,
    },
    {
      title: "十六进制",
      flag: "flag{hex_unlocked}",
      initial_points: 150,
      minimum_points: 150,
    },
    {
      title: "ROT13",
      flag: "flag{rot13_unlocked}",
      initial_points: 200,
      minimum_points: 200,
    },
  ];
  const rot13 = (value) =>
    value.replace(/[a-z]/gi, (c) =>
      String.fromCharCode(
        c.charCodeAt(0) + (c.toLowerCase() <= "m" ? 13 : -13),
      ),
    );
  const description = `三个编码步骤，各自对应一个 Flag，可按任意顺序提交。\n\n### Base64\n\n\`${Buffer.from(parts[0].flag).toString("base64")}\`\n\n### 十六进制\n\n\`${Buffer.from(parts[1].flag).toString("hex")}\`\n\n### ROT13\n\n\`${rot13(parts[2].flag)}\``;
  const findOrCreate = async (title, extra) =>
    existing.find((c) => c.title === title)?.id ??
    (await request("/admin/challenges", { ...common, title, ...extra })).id;
  const practice = await findOrCreate("分步解码", {
    practice: true,
    description,
    parts,
  });
  const contestChallenge = await findOrCreate("分组体验赛题", {
    practice: false,
    description:
      "平台功能测试题，两个答案分别计分。\n\n第一步：`flag{contest_first}`\n\n第二步：`flag{contest_second}`",
    parts: [
      {
        title: "第一步",
        flag: "flag{contest_first}",
        initial_points: 100,
        minimum_points: 100,
      },
      {
        title: "第二步",
        flag: "flag{contest_second}",
        initial_points: 200,
        minimum_points: 200,
      },
    ],
  });
  const sets = (await request("/admin/problemsets")).items;
  const resources = [
    "端口直连靶机",
    "泛域名靶机",
    "公共容器示例",
    "专属附件示例",
  ];
  for (const spec of [
    {
      title: "入门练习",
      description: "从基础 Flag 到分步解码。",
      challenge_ids: [
        ...existing
          .filter(
            (c) => c.practice && c.published && !resources.includes(c.title),
          )
          .map((c) => c.id),
        practice,
      ].filter((v, i, a) => a.indexOf(v) === i),
    },
    {
      title: "环境与附件",
      description: "端口、域名、公共环境与专属附件。",
      challenge_ids: resources
        .map((title) => existing.find((c) => c.title === title)?.id)
        .filter(Boolean),
    },
  ]) {
    if (!sets.some((s) => s.title === spec.title))
      await request("/admin/problemsets", { ...spec, published: true });
  }
  const contests = await allItems("/admin/contests");
  let contest = contests.find((c) => c.title === "分组功能体验赛");
  if (!contest) {
    contest = await request("/admin/contests", {
      title: "分组功能体验赛",
      description:
        "选择战队与组别报名，进入赛场完成两个小题。组别仅用于展示和榜单筛选。",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      team_limit: 4,
      published: true,
      challenge_ids: [contestChallenge],
      groups: [
        { name: "公开组", description: "所有选手均可参加。" },
        {
          name: "校园组",
          description: "校园参赛体验组，自行选择，无身份审核。",
        },
      ],
    });
    const form = new FormData();
    form.append(
      "file",
      new Blob([await readFile("apps/web/public/images/contest-lab.jpg")], {
        type: "image/jpeg",
      }),
      "contest-lab.jpg",
    );
    await request(`/admin/contests/${contest.id}/poster`, form);
  }
  console.log(
    "Local demo ready: 分步解码, 入门练习, 环境与附件, 分组功能体验赛",
  );
  console.log(`Practice: ${base}/challenges?challenge=${practice}`);
  console.log(`Contest: ${base}/contests/${contest.id}`);
} finally {
  await request("/auth/logout", {});
}
