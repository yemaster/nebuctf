import { test } from "node:test";
import assert from "node:assert/strict";
import {
  learningGraph,
  serializeLearningGraph,
  canConnectPrerequisite,
  arrangeSkillTree,
  skillNodeSize,
} from "../src/lib/learning-graph";
test("skill graph preserves dragged positions and serializes dependency edits", () => {
  const data = [
    {
      id: "a",
      title: "Start",
      article_id: null,
      challenge_id: "c1",
      prerequisites: [],
      position: { x: -20, y: 80 },
    },
    {
      id: "b",
      title: "Next",
      article_id: null,
      challenge_id: "c2",
      prerequisites: ["a"],
      position: { x: 320, y: 240 },
    },
  ];
  const graph = learningGraph(data);
  assert.deepEqual(graph.nodes[0]!.position, data[0]!.position);
  graph.nodes[1]!.position = { x: 451.5, y: -30 };
  const saved = serializeLearningGraph(graph.nodes, graph.edges);
  assert.deepEqual(saved[1]!.position, { x: 451.5, y: -30 });
  assert.deepEqual(saved[1]!.prerequisites, ["a"]);
  assert.deepEqual(
    serializeLearningGraph(graph.nodes, [])[1]!.prerequisites,
    [],
  );
  const legacy = learningGraph(data.map(({ position, ...node }) => node));
  assert.ok(legacy.nodes[1]!.position.y > legacy.nodes[0]!.position.y);
  assert.equal(legacy.nodes[1]!.position.x, legacy.nodes[0]!.position.x);
});
test("tree layout centers the root over equally spaced sibling branches", () => {
  const nodes = ["root", "left", "right", "leaf"].map((id) => ({ id }));
  const edges = [
    { source: "root", target: "left" },
    { source: "root", target: "right" },
    { source: "left", target: "leaf" },
  ];
  const arranged = arrangeSkillTree(nodes, edges),
    positions = new Map(arranged.map((n) => [n.id, n.position]));
  const root = positions.get("root")!,
    left = positions.get("left")!,
    right = positions.get("right")!,
    leaf = positions.get("leaf")!;
  assert.equal(left.y, right.y);
  assert.equal(root.x, (left.x + right.x) / 2);
  assert.ok(Math.abs(left.x - right.x) >= skillNodeSize.width + 64);
  assert.ok(left.y >= root.y + skillNodeSize.height + 80);
  assert.ok(leaf.y >= left.y + skillNodeSize.height + 80);
  assert.deepEqual(arrangeSkillTree(arranged, edges), arranged);
});
test("tree layout preserves converging prerequisites and separate roots without overlaps", () => {
  const nodes = ["a", "b", "joined", "other"].map((id) => ({ id }));
  const edges = [
    { source: "a", target: "joined" },
    { source: "b", target: "joined" },
  ];
  const arranged = arrangeSkillTree(nodes, edges);
  const joined = arranged.find((n) => n.id === "joined")!;
  for (const id of ["a", "b"])
    assert.ok(
      joined.position.y > arranged.find((n) => n.id === id)!.position.y,
    );
  for (let i = 0; i < arranged.length; i++)
    for (let j = i + 1; j < arranged.length; j++) {
      const a = arranged[i]!.position,
        b = arranged[j]!.position;
      assert.ok(
        Math.abs(a.x - b.x) >= skillNodeSize.width ||
          Math.abs(a.y - b.y) >= skillNodeSize.height,
      );
    }
  assert.equal(arranged.length, nodes.length);
  assert.deepEqual(edges, [
    { source: "a", target: "joined" },
    { source: "b", target: "joined" },
  ]);
  assert.deepEqual(arrangeSkillTree([], []), []);
});
test("tree layout accommodates measured tall cards and the maximum node count", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    measured: { width: 288, height: i === 0 ? 400 : 100 },
  }));
  const edges = nodes
    .slice(1)
    .map((n, i) => ({ source: String(Math.floor(i / 2)), target: n.id }));
  const arranged = arrangeSkillTree(nodes, edges);
  assert.equal(arranged.length, 100);
  assert.ok(arranged[1]!.position.y >= arranged[0]!.position.y + 480);
  for (const n of arranged) {
    assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y));
    assert.ok(n.position.x <= 100000 && n.position.y <= 100000);
  }
});
test("skill graph rejects self-links, duplicates and indirect cycles", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ];
  assert.equal(canConnectPrerequisite(edges, "a", "a"), false);
  assert.equal(canConnectPrerequisite(edges, "a", "b"), false);
  assert.equal(canConnectPrerequisite(edges, "c", "a"), false);
  assert.equal(canConnectPrerequisite(edges, "a", "c"), true);
  assert.equal(canConnectPrerequisite(edges, "d", "a"), true);
});
