import { z } from "zod";
import type { DB, Row } from "./db.js";
import { dynamicFlag } from "./security.js";
import { flagMode } from "./challenge-model.js";

export const flagTargetsInput = z
  .array(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/))
  .min(1)
  .max(8)
  .refine((names) => new Set(names).size === names.length, "注入容器不能重复")
  .nullable();

export function validateFlagTargets(
  challenge: Row,
  parts: Row[] = challenge.parts ?? [],
) {
  const services = new Set([
    "main",
    ...(challenge.resources?.container?.topology?.services ?? []).map(
      (s: Row) => s.name,
    ),
  ]);
  for (const targets of [
    challenge.flag_targets,
    ...parts.map((part) => part.flag_targets),
  ]) {
    if (targets == null) continue;
    for (const name of flagTargetsInput.parse(targets)!)
      if (!services.has(name))
        throw Object.assign(Error(`Flag 注入容器不存在：${name}`), {
          statusCode: 400,
        });
  }
}

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

export async function flagEnvironmentSpec(
  db: DB,
  challenge: Row,
  scope?: string,
  owner?: string,
) {
  const parts = await db.query(
    "SELECT id,flag_env,flag_template,flag_targets FROM challenge_parts WHERE challenge_id=$1 AND role<>'defense' ORDER BY position,id",
    [challenge.id],
  );
  const spec = {
    flag_mode: flagMode(challenge),
    flag_env: challenge.flag_env ?? "FLAG",
    flag_targets: challenge.flag_targets ?? null,
    part_targets: Object.fromEntries(
      parts.map((p) => [p.id, p.flag_targets ?? null]),
    ),
    flag_template: challenge.flag_template ?? "",
    part_templates: Object.fromEntries(
      parts.map((p) => [p.id, p.flag_template ?? null]),
    ),
    parts: parts.map((p) => p.id),
    part_env: Object.fromEntries(
      parts.map((p, index) => [
        p.id,
        p.flag_env ?? defaultPartEnvironment(index),
      ]),
    ),
  };
  if (
    scope &&
    scope !== "practice" &&
    scope !== "test" &&
    owner &&
    spec.flag_mode === "dynamic" &&
    challenge.challenge_type !== "awd"
  ) {
    const keys = parts.length ? parts.map((p) => p.id as string) : [""];
    const templates = keys.map(
      (key) => (key ? spec.part_templates[key] : null) ?? spec.flag_template,
    );
    await db.query(
      "INSERT INTO contest_flag_templates(contest_id,challenge_id,owner_key,part_key,template) SELECT $1,$2,$3,key,template FROM unnest($4::text[],$5::text[]) AS input(key,template) ON CONFLICT DO NOTHING",
      [scope, challenge.id, owner, keys, templates],
    );
    const saved = await db.query(
      "SELECT part_key,template FROM contest_flag_templates WHERE contest_id=$1 AND challenge_id=$2 AND owner_key=$3",
      [scope, challenge.id, owner],
    );
    for (const row of saved) {
      if (row.part_key) spec.part_templates[row.part_key] = row.template;
      else spec.flag_template = row.template;
    }
  }
  return spec;
}

// Persist configuration, not generated values. The snapshot also fixes the template for queued work.
export function flagForInstance(instance: Row, part?: string) {
  return dynamicFlag(
    instance.challenge_id,
    instance.scope,
    instance.owner_key,
    part,
    (part ? instance.spec.part_templates?.[part] : null) ??
      instance.spec.flag_template,
  );
}

export function flagTargets(instance: Row, part?: string): string[] {
  const targets = part
    ? instance.spec.part_targets?.[part]
    : instance.spec.flag_targets;
  return (
    targets ?? [
      "main",
      ...(instance.spec.awd
        ? []
        : (instance.spec.topology?.services ?? [])
            .filter((service: Row) => service.inject_flag)
            .map((service: Row) => service.name)),
    ]
  );
}
export function serviceFlagEnvironments(instance: Row) {
  return Object.fromEntries(
    [
      "main",
      ...(instance.spec.topology?.services ?? []).map((s: Row) => s.name),
    ].map((name) => [name, flagEnvironment(instance, name)]),
  );
}
export function flagEnvironment(instance: Row, service?: string): string[] {
  const spec = instance.spec;
  if (
    (spec.flag_mode ??
      (instance.kind.startsWith("dynamic") ? "dynamic" : "static")) !==
    "dynamic"
  )
    return [];
  const included = (part?: string) =>
    !service ||
    instance.kind === "dynamic_attachment" ||
    flagTargets(instance, part).includes(service);
  const parts: string[] = spec.parts ?? [];
  if (!parts.length) {
    if (!included()) return [];
    const name = flagEnvironmentName.parse(spec.flag_env ?? "FLAG"),
      flag = flagForInstance(instance);
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
  const selected = parts.flatMap((id, index) =>
    included(id)
      ? [{ id, name: names[index]!, flag: flagForInstance(instance, id) }]
      : [],
  );
  if (!selected.length) return [];
  return [
    `FLAG=${selected[0]!.flag}`,
    `FLAG_COUNT=${selected.length}`,
    ...selected.map(({ name, flag }) => `${name}=${flag}`),
    `FLAGS_JSON=${JSON.stringify(Object.fromEntries(selected.map(({ id, flag }) => [id, flag])))}`,
  ];
}
