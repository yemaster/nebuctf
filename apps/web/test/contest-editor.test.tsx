import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultQuestionLogic,
  type ContestQuestion,
} from "../src/lib/competition";
import {
  retainContestQuestions,
  validateContestQuestions,
} from "../src/lib/contest-editor";

const question = (
  id: string,
  group: string | null = null,
): ContestQuestion => ({
  challenge_id: id,
  published: true,
  release_at: null,
  scoring: { mode: "inherit", parts: [] },
  logic: { ...defaultQuestionLogic(), exclusive_group: group },
});
const starts = "2030-01-01T00:00:00Z";
const ends = "2030-01-02T00:00:00Z";

test("question logic validates references, duplicate prerequisites and cycles at the affected question", () => {
  const a = question("a"),
    b = question("b");
  assert.equal(validateContestQuestions([a, b], starts, ends), null);
  assert.deepEqual(defaultQuestionLogic(), {
    exclusive_group: null,
    dependency: null,
  });
  for (const ids of [["a"], ["missing"], ["b", "b"], []]) {
    a.logic.dependency = { scope: "team", mode: "all", challenge_ids: ids };
    assert.equal(validateContestQuestions([a, b], starts, ends)?.id, "a");
  }
  a.logic.dependency = { scope: "global", mode: "any", challenge_ids: ["b"] };
  b.logic.dependency = { scope: "team", mode: "all", challenge_ids: ["a"] };
  assert.match(validateContestQuestions([a, b], starts, ends)!.message, /循环/);
  b.logic.dependency = null;
  a.logic.exclusive_group = " ";
  assert.match(validateContestQuestions([a, b], starts, ends)!.message, /组名/);
  a.logic.exclusive_group = "字".repeat(61);
  assert.match(validateContestQuestions([a, b], starts, ends)!.message, /组名/);
});

test("team dependencies reject unreachable routes while global and viable any branches remain valid", () => {
  const a = question("a", "route"),
    b = question("b", "route"),
    c = question("c");
  a.logic.dependency = { scope: "team", mode: "all", challenge_ids: ["b"] };
  assert.equal(validateContestQuestions([a, b, c], starts, ends)?.id, "a");
  a.logic.dependency.scope = "global";
  assert.equal(validateContestQuestions([a, b, c], starts, ends), null);
  a.logic.dependency = {
    scope: "team",
    mode: "any",
    challenge_ids: ["b", "c"],
  };
  assert.equal(validateContestQuestions([a, b, c], starts, ends), null);
  a.logic.dependency = null;
  c.logic.dependency = {
    scope: "team",
    mode: "all",
    challenge_ids: ["a", "b"],
  };
  assert.equal(validateContestQuestions([a, b, c], starts, ends)?.id, "c");
  c.logic.dependency.mode = "any";
  assert.equal(validateContestQuestions([a, b, c], starts, ends), null);
});

test("mandatory routes propagate through transitive and shared any dependencies", () => {
  const a = question("a", "route"),
    b = question("b", "route"),
    c = question("c"),
    d = question("d");
  a.logic.dependency = { scope: "team", mode: "all", challenge_ids: ["c"] };
  c.logic.dependency = { scope: "team", mode: "all", challenge_ids: ["b"] };
  assert.equal(validateContestQuestions([a, b, c, d], starts, ends)?.id, "a");
  c.logic.dependency = {
    scope: "team",
    mode: "any",
    challenge_ids: ["b", "d"],
  };
  d.logic.dependency = { scope: "team", mode: "all", challenge_ids: ["b"] };
  assert.equal(validateContestQuestions([a, b, c, d], starts, ends)?.id, "a");
  d.logic.dependency = null;
  assert.equal(validateContestQuestions([a, b, c, d], starts, ends), null);
});

test("deselecting questions removes settings and dependency references without changing other rules", () => {
  const a = question("a", "route"),
    b = question("b"),
    c = question("c");
  a.logic.dependency = {
    scope: "global",
    mode: "any",
    challenge_ids: ["b", "c"],
  };
  const retained = retainContestQuestions([a, b, c], ["a", "c"]);
  assert.deepEqual(
    retained.map((s) => s.challenge_id),
    ["a", "c"],
  );
  assert.deepEqual(retained[0]!.logic, {
    exclusive_group: "route",
    dependency: { scope: "global", mode: "any", challenge_ids: ["c"] },
  });
  assert.equal(
    retainContestQuestions(retained, ["a"])[0]!.logic.dependency,
    null,
  );
  assert.deepEqual(a.logic.dependency.challenge_ids, ["b", "c"]);
  const legacy = { ...b };
  Reflect.deleteProperty(legacy, "logic");
  assert.deepEqual(
    retainContestQuestions([legacy], ["b"])[0]!.logic,
    defaultQuestionLogic(),
  );
});
