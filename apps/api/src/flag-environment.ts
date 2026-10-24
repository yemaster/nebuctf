import { z } from "zod";
import type { DB, Row } from "./db.js";
import { dynamicFlag } from "./security.js";
import { flagMode } from "./challenge-model.js";

export const flagEnvironmentName = z
  .string()
  .trim()
  .regex(
    /^[A-Z_][A-Z0-9_]{0,63}$/,
    "环境变量名使用大写字母、数字和下划线，且不能以数字开头",
  )
  .refine(
    (name) =>
      ![
        "FLAG_COUNT",
        "FLAGS_JSON",
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "IFS",
        "ENV",
        "BASH_ENV",
      ].includes(name) && !/^(LD_|DYLD_|NODE_|PYTHON)/.test(name),
    "此环境变量名由系统保留",
  );
export const partEnvironmentName = flagEnvironmentName.refine(
  (name) => name !== "FLAG",
  "FLAG 保留为第一个小题的兼容变量，请使用其他名称",
);
export const defaultPartEnvironment = (position: number) =>
  `FLAG_${position + 1}`;

export async function flagEnvironmentSpec(db: DB, challenge: Row) {
  const parts = await db.query(
    "SELECT id,flag_env FROM challenge_parts WHERE challenge_id=$1 AND role<>'defense' ORDER BY position,id",
    [challenge.id],
  );
  return {
    flag_mode: flagMode(challenge),
    flag_env: challenge.flag_env ?? "FLAG",
    parts: parts.map((p) => p.id),
    part_env: Object.fromEntries(
      parts.map((p, index) => [
        p.id,
        p.flag_env ?? defaultPartEnvironment(index),
      ]),
    ),
  };
}

// Only variable names and part IDs are persisted in instance snapshots. Values are derived in the Worker.
export function flagEnvironment(instance: Row): string[] {
  const spec = instance.spec;
  if (
    (spec.flag_mode ??
      (instance.kind.startsWith("dynamic") ? "dynamic" : "static")) !==
    "dynamic"
  )
    return [];
  const parts: string[] = spec.parts ?? [];
  if (!parts.length) {
    const name = flagEnvironmentName.parse(spec.flag_env ?? "FLAG");
    const flag = dynamicFlag(
      instance.challenge_id,
      instance.scope,
      instance.owner_key,
    );
    return name === "FLAG"
      ? [`FLAG=${flag}`]
      : [`FLAG=${flag}`, `${name}=${flag}`];
  }
  const names = parts.map((id, index) =>
    partEnvironmentName.parse(
      spec.part_env?.[id] ?? defaultPartEnvironment(index),
    ),
  );
  if (new Set(names).size !== names.length)
    throw Error("小题环境变量名不能重复");
  const flags = parts.map((id) =>
    dynamicFlag(instance.challenge_id, instance.scope, instance.owner_key, id),
  );
  return [
    `FLAG=${flags[0]}`,
    `FLAG_COUNT=${parts.length}`,
    ...names.map((name, index) => `${name}=${flags[index]}`),
    `FLAGS_JSON=${JSON.stringify(Object.fromEntries(parts.map((id, index) => [id, flags[index]])))}`,
  ];
}
