import type { LearningNode } from "./types";
import dagre from "@dagrejs/dagre";
export const flowLabels = {
  "controls.ariaLabel": "画布控制",
  "controls.zoomIn.ariaLabel": "放大",
  "controls.zoomOut.ariaLabel": "缩小",
  "controls.fitView.ariaLabel": "显示全部节点",
  "controls.interactive.ariaLabel": "切换画布交互",
  "node.a11yDescription.default":
    "按回车选择节点，用方向键移动，按 Delete 删除，按 Esc 取消选择。",
  "node.a11yDescription.keyboardDisabled": "按回车选择节点，按 Esc 取消选择。",
  "edge.a11yDescription.default":
    "按回车选择连线，按 Delete 删除，按 Esc 取消选择。",
  "handle.ariaLabel": "节点连接点",
};
export type DependencyEdge = { source: string; target: string };
export function canConnectPrerequisite(
  edges: DependencyEdge[],
  source: string,
  target: string,
) {
  if (
    source === target ||
    edges.some((e) => e.source === source && e.target === target)
  )
    return false;
  const pending = [target],
    seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source) return false;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const e of edges) if (e.source === current) pending.push(e.target);
  }
  return true;
}
// Reserve room for the public card as well, so both views share the same layout.
export const skillNodeSize = { width: 288, height: 224 };
export function arrangeSkillTree<
  T extends { id: string; measured?: { width?: number; height?: number } },
>(nodes: T[], edges: DependencyEdge[], size = skillNodeSize) {
  if (!nodes.length) return [];
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    nodesep: 64,
    ranksep: 80,
    edgesep: 24,
    marginx: 32,
    marginy: 32,
  });
  for (const node of nodes)
    graph.setNode(node.id, {
      width: Math.max(size.width, node.measured?.width ?? 0),
      height: Math.max(size.height, node.measured?.height ?? 0),
    });
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target))
      graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  return nodes.map((node) => {
    const { x, y, width, height } = graph.node(node.id);
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } };
  });
}
export function learningGraph(nodes: LearningNode[]) {
  const edges = nodes.flatMap((node) =>
    node.prerequisites.map((source) => ({
      id: `${source}:${node.id}`,
      source,
      target: node.id,
    })),
  );
  const arranged = nodes.some((node) => !node.position)
    ? arrangeSkillTree(nodes, edges)
    : [];
  return {
    nodes: nodes.map((node, index) => {
      return {
        id: node.id,
        type: "skill",
        position: node.position ?? arranged[index]!.position,
        data: { ...node },
      };
    }),
    edges,
  };
}
export function serializeLearningGraph(
  nodes: {
    id: string;
    position: { x: number; y: number };
    data: LearningNode;
  }[],
  edges: DependencyEdge[],
) {
  return nodes.map((node) => ({
    id: node.id,
    title: node.data.title,
    article_id: node.data.article_id,
    challenge_id: node.data.challenge_id,
    prerequisites: edges
      .filter((e) => e.target === node.id)
      .map((e) => e.source),
    position: { x: node.position.x, y: node.position.y },
  }));
}
