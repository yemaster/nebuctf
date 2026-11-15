import { z } from "zod";
import type { DB, Row } from "./db.js";
import { fail } from "./security.js";
import { notifyContest } from "./activity-events.js";

export const questionLogicInput = z.object({
  exclusive_group: z.string().trim().min(1).max(60).nullable().default(null),
  dependency: z
    .object({
      scope: z.enum(["team", "global"]),
      mode: z.enum(["all", "any"]),
      challenge_ids: z.array(z.uuid()).min(1).max(199),
    })
    .nullable()
    .default(null),
});
export type QuestionLogic = z.infer<typeof questionLogicInput>;
export const emptyQuestionLogic = (): QuestionLogic => ({
  exclusive_group: null,
  dependency: null,
});
export const normalizeQuestionLogic = (logic: unknown): QuestionLogic =>
  questionLogicInput.parse(logic ?? {});

export function validateQuestionLogic(
  settings: { challenge_id: string; logic: QuestionLogic }[],
) {
  const byId = new Map(settings.map((s) => [s.challenge_id, s.logic]));
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const error = (id: string, message: string): never =>
    fail(400, `赛题 ${id}：${message}`);
  const visit = (id: string) => {
    if (visiting.has(id)) error(id, "依赖不能形成环");
    if (visited.has(id)) return;
    visiting.add(id);
    const dependency = byId.get(id)!.dependency;
    if (dependency) {
      if (
        new Set(dependency.challenge_ids).size !==
        dependency.challenge_ids.length
      )
        error(id, "依赖题目不能重复");
      for (const prerequisite of dependency.challenge_ids) {
        if (prerequisite === id || !byId.has(prerequisite))
          error(id, "依赖必须为比赛中的其他题目");
        visit(prerequisite);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  // Propagate mandatory route choices, including transitive team prerequisites.
  const requirements = new Map<string, Map<string, string> | null>();
  const required = (id: string): Map<string, string> | null => {
    if (requirements.has(id)) return requirements.get(id)!;
    const logic = byId.get(id)!,
      result = new Map<string, string>();
    if (logic.exclusive_group) result.set(logic.exclusive_group, id);
    const dependency = logic.dependency;
    if (dependency?.scope === "team") {
      const alternatives = dependency.challenge_ids
        .map(required)
        .filter((r) => r !== null);
      if (
        !alternatives.length ||
        (dependency.mode === "all" &&
          alternatives.length !== dependency.challenge_ids.length)
      ) {
        requirements.set(id, null);
        return null;
      }
      const compatible = alternatives.filter((choices) =>
        [...choices].every(
          ([group, choice]) =>
            !result.has(group) || result.get(group) === choice,
        ),
      );
      if (
        !compatible.length ||
        (dependency.mode === "all" && compatible.length !== alternatives.length)
      ) {
        requirements.set(id, null);
        return null;
      }
      const mandatory =
        dependency.mode === "all"
          ? compatible
          : [
              new Map(
                [...compatible[0]!].filter(([group, choice]) =>
                  compatible.every((r) => r.get(group) === choice),
                ),
              ),
            ];
      for (const choices of mandatory)
        for (const [group, choice] of choices) {
          if (result.has(group) && result.get(group) !== choice) {
            requirements.set(id, null);
            return null;
          }
          result.set(group, choice);
        }
    }
    requirements.set(id, result);
    return result;
  };
  for (const id of byId.keys())
    if (required(id) === null) error(id, "队伍依赖与互斥路线冲突，题目不可达");
}

export type PublicQuestionLogic = QuestionLogic & {
  exclusive_selected: boolean;
};
export async function contestLogicState(
  db: DB,
  scope: string,
  owner: string,
  practice = false,
) {
  return (await contestLogicStates(db, scope, [owner], practice)).get(owner)!;
}
export async function contestLogicStates(
  db: DB,
  scope: string,
  owners: string[],
  practice = false,
) {
  const states = new Map(
    owners.map((owner) => [
      owner,
      new Map<string, PublicQuestionLogic | null>(),
    ]),
  );
  if (scope === "practice" || practice || !owners.some(Boolean)) return states;
  const links = (
    await db.query(
      "SELECT challenge_id,logic FROM contest_challenges WHERE contest_id=$1",
      [scope],
    )
  ).map((link) => ({
    challenge_id: link.challenge_id as string,
    logic: normalizeQuestionLogic(link.logic),
  }));
  const choices = links.some((link) => link.logic.exclusive_group)
    ? await db.query(
        "SELECT owner_key,group_name,challenge_id FROM contest_exclusive_choices WHERE contest_id=$1 AND owner_key=ANY($2::text[])",
        [scope, owners],
      )
    : [];
  const completed = links.some((link) => link.logic?.dependency)
    ? await db.query(
        `SELECT s.challenge_id,s.owner_key FROM solves s JOIN accepted_registrations r ON r.contest_id::text=s.scope AND 't:'||r.team_id=s.owner_key
     WHERE s.scope=$1 AND NOT s.contest_practice AND NOT EXISTS(
       SELECT 1 FROM challenge_parts p WHERE p.challenge_id=s.challenge_id AND NOT EXISTS(
         SELECT 1 FROM part_solves ps WHERE ps.part_id=p.id AND ps.scope=s.scope AND ps.owner_key=s.owner_key AND NOT ps.contest_practice))
     UNION
     SELECT rounds.challenge_id,attack.attacker_key owner_key
       FROM awd_attacks attack
       JOIN awd_flags flag ON flag.flag_hash=attack.flag_hash
       JOIN contest_rounds rounds ON rounds.id=flag.round_id
       JOIN accepted_registrations registration ON registration.contest_id=rounds.contest_id AND 't:'||registration.team_id=attack.attacker_key
      WHERE rounds.contest_id=$1::uuid`,
        [scope],
      )
    : [];
  const globalSolves = new Set<string>(completed.map((r) => r.challenge_id));
  for (const [owner, state] of states) {
    if (!owner) continue;
    const selected = new Map<string, string>(
      choices
        .filter((r) => r.owner_key === owner)
        .map((r) => [r.group_name, r.challenge_id]),
    );
    const teamSolves = new Set<string>(
      completed.filter((r) => r.owner_key === owner).map((r) => r.challenge_id),
    );
    for (const link of links) {
      const logic = link.logic,
        group = logic.exclusive_group;
      const dependency = logic.dependency;
      const solves = dependency?.scope === "global" ? globalSolves : teamSolves;
      const unlocked =
        !dependency ||
        (dependency.mode === "all"
          ? dependency.challenge_ids.every((id) => solves.has(id))
          : dependency.challenge_ids.some((id) => solves.has(id)));
      state.set(
        link.challenge_id,
        unlocked &&
          (!group ||
            !selected.has(group) ||
            selected.get(group) === link.challenge_id)
          ? {
              ...logic,
              exclusive_selected:
                !!group && selected.get(group) === link.challenge_id,
            }
          : null,
      );
    }
  }
  return states;
}
export async function filterContestLogic(
  db: DB,
  rows: Row[],
  scope: string,
  owner: string,
  practice = false,
): Promise<Row[]> {
  const state = await contestLogicState(db, scope, owner, practice);
  return rows
    .filter((r) => state.get(r.challenge_id ?? r.id) !== null)
    .map((r) => ({
      ...r,
      ...(state.get(r.challenge_id ?? r.id)
        ? { contest_logic: state.get(r.challenge_id ?? r.id) }
        : {}),
    }));
}

// Every submitting route takes all route locks, sorted, before per-question locks.
// Re-read choices after waiting: an earlier access check is never authorization to bind.
export async function lockContestChoices(
  db: DB,
  scope: string,
  owner: string,
  ids: string[],
) {
  if (scope === "practice" || !owner) return;
  const [contest] = await db.query(
    "SELECT practice_mode,ends_at FROM contests WHERE id=$1",
    [scope],
  );
  if (
    contest?.practice_mode &&
    new Date(contest.ends_at).getTime() <= Date.now()
  )
    return;
  const links = await db.query(
    "SELECT challenge_id,logic FROM contest_challenges WHERE contest_id=$1 AND challenge_id=ANY($2::uuid[])",
    [scope, ids],
  );
  const groups = new Map<string, string>();
  for (const link of links) {
    const group = normalizeQuestionLogic(link.logic).exclusive_group;
    if (!group) continue;
    if (groups.has(group) && groups.get(group) !== link.challenge_id)
      fail(409, "答卷不能同时提交同一互斥组的多道题目");
    groups.set(group, link.challenge_id);
  }
  for (const group of [...groups.keys()].sort()) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify(["contest-exclusive", scope, owner, group]),
    ]);
    const [choice] = await db.query(
      "SELECT challenge_id FROM contest_exclusive_choices WHERE contest_id=$1 AND owner_key=$2 AND group_name=$3",
      [scope, owner, group],
    );
    if (choice && choice.challenge_id !== groups.get(group))
      fail(403, "已选择此互斥组的其他题目");
  }
}
export async function bindContestChoice(
  db: DB,
  challenge: Row,
  scope: string,
  owner: string,
) {
  const group = challenge.contest_logic?.exclusive_group;
  if (!group || scope === "practice" || challenge.contest_practice) return;
  const inserted = await db.query(
    "INSERT INTO contest_exclusive_choices(contest_id,owner_key,group_name,challenge_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING challenge_id",
    [scope, owner, group, challenge.id],
  );
  const [choice] = await db.query(
    "SELECT challenge_id FROM contest_exclusive_choices WHERE contest_id=$1 AND owner_key=$2 AND group_name=$3",
    [scope, owner, group],
  );
  if (choice?.challenge_id !== challenge.id)
    fail(403, "已选择此互斥组的其他题目");
  if (inserted.length) await notifyContest(db, scope);
}
