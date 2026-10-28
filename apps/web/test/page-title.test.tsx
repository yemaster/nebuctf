import { test } from "node:test";
import assert from "node:assert/strict";
import { pageTitle } from "../src/lib/page-title";
test("page titles follow routes, query sections and loaded item names", () => {
  const items: Record<string, { title: string }> = {
    "/contests/cup": { title: "秋季赛" },
    "/challenges/one?scope=cup": { title: "入门 Pwn" },
    "/admin/challenges/one": { title: "入门 Pwn" },
    "/terminal/targets/target": { title: "入门 Pwn" },
  };
  const lookup = (path: string) => items[path];
  for (const [path, search, expected] of [
    ["/challenges", "", "题库"],
    ["/login", "", "登录"],
    ["/register", "", "注册"],
    ["/account", "?section=submissions", "提交记录"],
    ["/contests/cup", "", "秋季赛"],
    ["/contests/cup/scoreboard", "", "排行榜 - 秋季赛"],
    ["/contests/cup/challenges", "?challenge=one", "入门 Pwn - 秋季赛"],
    ["/admin/challenges/one/edit", "", "编辑题目 - 入门 Pwn"],
    ["/admin/contests/new", "", "新建比赛"],
    ["/terminal", "?target=target", "入门 Pwn - 终端"],
    ["/missing", "", "页面不存在"],
  ])
    assert.equal(pageTitle(path!, search!, lookup), expected);
  assert.equal(
    pageTitle("/contests/cup", "", () => undefined),
    "比赛概览",
  );
});
