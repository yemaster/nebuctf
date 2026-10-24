import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skillBranches,
  learningContentHref,
  learningReturnPath,
} from "../src/lib/learning-navigation";
import type { LearningNode } from "../src/lib/types";
const node = (id: string, prerequisites: string[] = []) =>
  ({
    id,
    title: id,
    prerequisites,
    article_id: null,
    challenge_id: null,
  }) as LearningNode;
test("collapsed skill branches retain shared descendants reached through another parent", () => {
  const tree = skillBranches([
    node("r"),
    node("a", ["r"]),
    node("b", ["r"]),
    node("shared", ["a", "b"]),
    node("leaf", ["shared"]),
    node("other"),
  ]);
  assert.deepEqual(tree.roots, ["r", "other"]);
  assert.deepEqual(
    tree.visible(new Set(["r"])).map((n) => n.id),
    ["r", "a", "b", "other"],
  );
  assert.deepEqual(
    tree.visible(new Set(["r", "b"])).map((n) => n.id),
    ["r", "a", "b", "shared", "other"],
  );
  assert.deepEqual(
    tree.visible(new Set(["a", "shared"]), "a").map((n) => n.id),
    ["a", "shared", "leaf"],
  );
  assert.deepEqual([...tree.ancestors("leaf")].sort(), [
    "a",
    "b",
    "r",
    "shared",
  ]);
});
test("learning return links preserve selection, branch, authored layout and reject unrelated destinations", () => {
  const back = "/learning/tree-id?node=web&branch=basics&layout=author";
  const href = learningContentHref("/challenges?challenge=challenge-id", back);
  const params = new URL(href, "https://nebuctf.invalid").searchParams;
  assert.equal(params.get("challenge"), "challenge-id");
  assert.equal(learningReturnPath(params), back);
  for (const from of [
    "https://elsewhere.test/learning/id",
    "//elsewhere.test",
    "/admin/users",
    "/learning",
    "/\\elsewhere.test",
    "/learning/id\n",
  ]) {
    assert.equal(learningReturnPath(new URLSearchParams({ from })), null);
  }
});
