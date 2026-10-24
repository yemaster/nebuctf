import type { LearningNode } from "./types";
import { safeLocalPath } from "./utils";

export function learningReturnPath(params: URLSearchParams) {
  const path = safeLocalPath(params.get("from"), "");
  return /^\/learning\/[^/?#]+(?:\?[^#]*)?$/.test(path) ? path : null;
}
export function learningContentHref(path: string, returnTo: string) {
  const url = new URL(path, "https://nebuctf.invalid");
  url.searchParams.set("from", returnTo);
  return url.pathname + url.search;
}

// Traverse every dependency path: collapsing one parent must not hide a shared
// child still reachable from another open branch.
export function skillBranches(nodes: LearningNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const n of nodes)
    for (const parent of n.prerequisites) children.get(parent)?.push(n.id);
  const roots = nodes
    .filter((n) => !n.prerequisites.some((id) => byId.has(id)))
    .map((n) => n.id);
  function ancestors(id: string) {
    const seen = new Set<string>(),
      pending = [...(byId.get(id)?.prerequisites ?? [])];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      pending.push(...byId.get(next)!.prerequisites);
    }
    return seen;
  }
  function visible(expanded: Set<string>, branch?: string | null) {
    const seen = new Set<string>(),
      pending = branch && byId.has(branch) ? [branch] : [...roots];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (expanded.has(id)) pending.push(...(children.get(id) ?? []));
    }
    return nodes.filter((n) => seen.has(n.id));
  }
  return { byId, children, roots, ancestors, visible };
}
