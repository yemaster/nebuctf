import type { ContestQuestion, Points } from "./competition";

// Validate saved state as well as mounted inputs: rows can be collapsed or on another page.
export function validateContestQuestions(
  settings: ContestQuestion[],
  starts: string,
  ends: string,
) {
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  const validPoints = (p: Points) =>
    integer(p.initial_points, 1, 10000) &&
    integer(p.minimum_points, 1, p.initial_points) &&
    integer(p.decay, 1, 10000);
  const byId = new Map(settings.map((s) => [s.challenge_id, s]));
  for (const s of settings) {
    const error = (message: string) => ({ id: s.challenge_id, message });
    const logic = s.logic;
    if (!logic) continue;
    const group = logic.exclusive_group;
    if (group !== null && (!group.trim() || [...group.trim()].length > 60))
      return error("互斥组名须为 1–60 字。");
    const dependency = logic.dependency;
    if (!dependency) continue;
    if (
      !["team", "global"].includes(dependency.scope) ||
      !["all", "any"].includes(dependency.mode) ||
      !dependency.challenge_ids.length
    )
      return error("请选择依赖范围、完成方式和前置赛题。");
    if (
      new Set(dependency.challenge_ids).size !== dependency.challenge_ids.length
    )
      return error("前置赛题不能重复。");
    if (dependency.challenge_ids.includes(s.challenge_id))
      return error("不能依赖本题。");
    if (dependency.challenge_ids.some((id) => !byId.has(id)))
      return error("前置赛题须在本场比赛中。");
    if (dependency.scope === "team") {
      const groups = dependency.challenge_ids.map(
        (id) => byId.get(id)?.logic?.exclusive_group?.trim() || null,
      );
      const own = group?.trim();
      if (
        dependency.mode === "all"
          ? groups.some((g) => !!own && g === own) ||
            groups.some((g, i) => g !== null && groups.indexOf(g) !== i)
          : !!own && groups.every((g) => g === own)
      )
        return error("队伍依赖无法完成：前置赛题与互斥规则冲突。");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.logic?.dependency?.challenge_ids ??
      [])
      if (cyclic(prerequisite)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const s of settings)
    if (cyclic(s.challenge_id))
      return { id: s.challenge_id, message: "前置依赖存在循环。" };
  // Keep mandatory route choices shared by every viable dependency branch.
  const routes = new Map<string, Map<string, string> | null>();
  const merge = (left: Map<string, string>, right: Map<string, string>) => {
    const result = new Map(left);
    for (const [group, id] of right) {
      if (result.has(group) && result.get(group) !== id) return null;
      result.set(group, id);
    }
    return result;
  };
  const requiredRoute = (id: string): Map<string, string> | null => {
    if (routes.has(id)) return routes.get(id)!;
    const logic = byId.get(id)?.logic;
    const group = logic?.exclusive_group?.trim();
    let route = new Map<string, string>(group ? [[group, id]] : []);
    const dependency = logic?.dependency;
    if (dependency?.scope === "team") {
      const branches = dependency.challenge_ids.map((next) =>
        requiredRoute(next),
      );
      if (dependency.mode === "all") {
        for (const branch of branches) {
          const combined = branch && merge(route, branch);
          if (!combined) {
            routes.set(id, null);
            return null;
          }
          route = combined;
        }
      } else {
        const viable = branches.flatMap((branch) => {
          const combined = branch && merge(route, branch);
          return combined ? [combined] : [];
        });
        if (!viable.length) {
          routes.set(id, null);
          return null;
        }
        route = new Map(
          [...viable[0]!].filter(([key, selected]) =>
            viable.every((branch) => branch.get(key) === selected),
          ),
        );
      }
    }
    routes.set(id, route);
    return route;
  };
  for (const s of settings)
    if (!requiredRoute(s.challenge_id))
      return {
        id: s.challenge_id,
        message: "队伍依赖无法完成：前置路线与互斥规则冲突。",
      };
  for (const s of settings) {
    const error = (message: string) => ({ id: s.challenge_id, message });
    if (
      s.release_at !== null &&
      (!s.release_at || !Number.isFinite(Date.parse(s.release_at)))
    )
      return error("请选择上线时间，或改为随阶段开放。");
    if (
      s.release_at &&
      (Date.parse(s.release_at) < Date.parse(starts) ||
        Date.parse(s.release_at) >= Date.parse(ends))
    )
      return error("上线时间须在比赛开始之后、结束之前。");
    const limit = s.container_start_limit;
    if (
      limit?.mode === "custom" &&
      (limit.count === null || !integer(limit.count, 0, 10000))
    )
      return error("靶机开启次数须为 0–10000 的整数。");
    const v = s.scoring;
    if (
      (v.mode !== "inherit" && !v.points) ||
      (v.points && !validPoints(v.points)) ||
      v.parts.some((p) => !validPoints(p.points))
    )
      return error(
        "分值须为 1–10000 的整数，最低分不能超过初始分，衰减人数须为 1–10000 的整数。",
      );
    if (
      v.mode === "round" &&
      (!v.round ||
        !integer(v.round.flag_lifetime, 1, 5) ||
        !integer(v.round.defense_points, 0, 10000) ||
        !integer(v.round.availability_points, 0, 10000))
    )
      return error("检查轮次计分：Flag 有效 1–5 轮，得分为 0–10000 的整数。");
  }
  return null;
}

export function retainContestQuestions(
  settings: ContestQuestion[],
  ids: string[],
) {
  const selected = new Set(ids);
  return settings
    .filter((s) => selected.has(s.challenge_id))
    .map((s) => {
      const logic = s.logic ?? { exclusive_group: null, dependency: null };
      const dependency = logic.dependency;
      if (!dependency) return { ...s, logic };
      const challenge_ids = dependency.challenge_ids.filter((id) =>
        selected.has(id),
      );
      return {
        ...s,
        logic: {
          ...logic,
          dependency: challenge_ids.length
            ? { ...dependency, challenge_ids }
            : null,
        },
      };
    });
}
