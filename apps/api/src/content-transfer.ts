import { z } from "zod";
import { join } from "node:path";
import { copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { audit, lock, type DB, type Row } from "./db.js";
import { challengeInput, contestInput, id } from "./schemas.js";
import { hintDefinitions } from "./hint-rules.js";
import { prepareParts, saveParts } from "./challenge-parts.js";
import { resourceProfiles } from "./challenge-model.js";
import { saveContestGroups } from "./contest-groups.js";
import { validateTiming } from "./competition-rules.js";
import { validateWriteup, writeupInput } from "./writeup-config.js";
import { validateRegistrationWindow } from "./contest-entry.js";
import { storage, validateImage } from "./resources.js";
import { posterMime } from "./contest-posters.js";
import { fail, flagHash } from "./security.js";
import { hashFile, contentLimit, type ArchiveFile } from "./content-archive.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const asset = z
  .object({
    id,
    name: z.string().min(1).max(180),
    size: z
      .number()
      .int()
      .min(0)
      .max(20 * 1024 * 1024),
    sha256: hash,
  })
  .strict();
const question = z
  .object({
    id,
    config: challengeInput,
    flag_hash: hash.or(z.literal("")),
    part_hashes: z.record(id, hash.or(z.literal(""))),
    attachments: z.array(asset).max(2000),
  })
  .strict();
const event = z
  .object({
    config: contestInput,
    registration_code_hash: hash.or(z.literal("")),
    poster: asset.nullable(),
    announcements: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            body: z.string().min(1).max(10000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export const contentManifest = z
  .object({
    format: z.literal("nebuctf-content"),
    version: z.literal(1),
    kind: z.enum(["challenge", "contest"]),
    exported_at: z.iso.datetime(),
    flag_key_id: hash,
    challenges: z.array(question).max(200),
    contest: event.nullable(),
  })
  .strict();
export type ContentManifest = z.infer<typeof contentManifest>;
export const importOptions = z
  .object({
    title: z.string().trim().min(1).max(120),
    starts_at: z.iso.datetime().optional(),
    flags: z.record(id, z.string().min(1).max(256)).default({}),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptions>;
const keyId = () => flagHash("nebuctf-content:key-id:v1");
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function exportContent(
  db: DB,
  kind: ContentManifest["kind"],
  source: string,
) {
  const files = new Map<string, ArchiveFile>();
  let bytes = 0;
  const file = async (aid: string, name: string, prefix = "") => {
    const path = join(storage(), prefix + aid);
    let metadata: { size: number; sha256: string };
    try {
      metadata = await hashFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail(409, `资源文件缺失：${name}`);
      throw error;
    }
    bytes += metadata.size;
    if (bytes > contentLimit) fail(413, "导出内容超过 254 MiB，请分题导出");
    files.set(aid, { path, ...metadata });
    return { id: aid, name, ...metadata };
  };
  const manifest = await db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    let contest: ContentManifest["contest"] = null,
      ids = [source];
    if (kind === "contest") {
      const [row] = await tx.query("SELECT * FROM contests WHERE id=$1", [
        source,
      ]);
      if (!row) fail(404, "比赛不存在");
      const links = await tx.query(
        "SELECT * FROM contest_challenges WHERE contest_id=$1 ORDER BY position,challenge_id",
        [source],
      );
      const groups = await tx.query(
        "SELECT * FROM contest_groups WHERE contest_id=$1 ORDER BY position,id",
        [source],
      );
      ids = links.map((c) => c.challenge_id);
      contest = {
        config: contestInput.parse(
          plain({
            ...row,
            challenge_ids: ids,
            challenge_settings: links,
            groups,
          }),
        ),
        registration_code_hash: row!.registration_code_hash ?? "",
        poster: row!.poster_id
          ? await file(row!.poster_id, "poster", "poster-")
          : null,
        announcements: (await tx.query(
          "SELECT title,body FROM announcements WHERE contest_id=$1 ORDER BY created_at,id",
          [source],
        )) as { title: string; body: string }[],
      };
    }
    const rows = await tx.query(
      "SELECT * FROM challenges WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],id)",
      [ids],
    );
    if (kind === "challenge" && !rows.length) fail(404, "题目不存在");
    const parts = await tx.query(
      "SELECT * FROM challenge_parts WHERE challenge_id=ANY($1::uuid[]) ORDER BY position,id",
      [ids],
    );
    const attachments = await tx.query(
      "SELECT * FROM attachments WHERE challenge_id=ANY($1::uuid[]) ORDER BY created_at,id",
      [ids],
    );
    const challenges: ContentManifest["challenges"] = [];
    for (const c of rows) {
      const units = parts.filter((p) => p.challenge_id === c.id);
      const resources = [];
      for (const a of attachments.filter((a) => a.challenge_id === c.id))
        resources.push(await file(a.id, a.name));
      challenges.push({
        id: c.id,
        config: challengeInput.parse(
          plain({ ...c, hints: hintDefinitions(c as any), parts: units }),
        ),
        flag_hash: c.flag_hash,
        part_hashes: Object.fromEntries(units.map((p) => [p.id, p.flag_hash])),
        attachments: resources,
      });
    }
    return contentManifest.parse({
      format: "nebuctf-content",
      version: 1,
      kind,
      exported_at: new Date().toISOString(),
      flag_key_id: keyId(),
      challenges,
      contest,
    });
  });
  return { manifest, files };
}

export function validateContent(
  manifest: ContentManifest,
  files: Map<string, ArchiveFile>,
) {
  if (
    manifest.kind === "challenge"
      ? manifest.contest !== null || manifest.challenges.length !== 1
      : !manifest.contest
  )
    fail(400, "文件包类型与内容不符");
  const seen = new Set<string>(),
    referenced = new Set<string>();
  const unique = (value: string | undefined) => {
    if (!value || seen.has(value)) fail(400, "文件包包含缺失或重复的 ID");
    seen.add(value!);
  };
  const checkAsset = (a: z.infer<typeof asset>) => {
    unique(a.id);
    const file = files.get(`files/${a.id}`);
    if (!file || file.size !== a.size || file.sha256 !== a.sha256)
      fail(400, `资源文件校验失败：${a.name}`);
    referenced.add(`files/${a.id}`);
  };
  for (const c of manifest.challenges) {
    unique(c.id);
    for (const part of c.config.parts ?? []) unique(part.id);
    for (const hint of hintDefinitions({ id: c.id, hints: c.config.hints }))
      unique(hint.id);
    if (
      Object.keys(c.part_hashes).some(
        (key) => !c.config.parts?.some((p) => p.id === key),
      )
    )
      fail(400, "小题校验信息不属于当前题目");
    for (const profile of Object.values(resourceProfiles(c.config)))
      if (profile) validateImage(profile.image);
    if (c.config.patch_config)
      validateImage(c.config.patch_config.checker_image);
    if (c.config.awd_config) validateImage(c.config.awd_config.checker_image);
    c.attachments.forEach(checkAsset);
  }
  const c = manifest.contest?.config;
  if (c) {
    const ids = new Set(manifest.challenges.map((c) => c.id));
    if (
      new Set(c.challenge_ids).size !== c.challenge_ids.length ||
      c.challenge_ids.length !== ids.size ||
      c.challenge_ids.some((id) => !ids.has(id))
    )
      fail(400, "比赛与题目列表不匹配");
    const selected = new Set<string>();
    for (const setting of c.challenge_settings ?? []) {
      if (!ids.has(setting.challenge_id) || selected.has(setting.challenge_id))
        fail(400, "赛题设置存在重复或无效引用");
      selected.add(setting.challenge_id);
      const challenge = manifest.challenges.find(
        (ch) => ch.id === setting.challenge_id,
      )!;
      if (
        setting.scoring.parts.some(
          (p) => !challenge.config.parts?.some((part) => part.id === p.id),
        )
      )
        fail(400, "小题计分引用无效");
      if (
        setting.release_at &&
        (setting.release_at < c.starts_at || setting.release_at >= c.ends_at)
      )
        fail(400, "题目上线时间必须在比赛期间");
      if (
        challenge.config.challenge_type === "objective" &&
        !["inherit", "fixed"].includes(setting.scoring.mode)
      )
        fail(400, "客观题使用固定分值");
    }
    for (const ch of manifest.challenges)
      if (
        ch.config.challenge_type === "awd" &&
        c.challenge_settings?.find((s) => s.challenge_id === ch.id)?.scoring
          .mode !== "round"
      )
        fail(400, "AWD 题目需要轮次计分");
    for (const override of c.submission_overrides ?? [])
      if (!ids.has(override.challenge_id)) fail(400, "提交次数设置引用无效");
    for (const override of c.hint_overrides ?? []) {
      const ch = manifest.challenges.find(
        (ch) => ch.id === override.challenge_id,
      );
      if (
        !ch ||
        !hintDefinitions({ id: ch.id, hints: ch.config.hints }).some(
          (h) => h.id === override.hint_id,
        )
      )
        fail(400, "提示扣分设置引用无效");
    }
    const names = new Set<string>();
    for (const group of c.groups ?? []) {
      if (group.id) unique(group.id);
      if (
        names.has(group.name) ||
        Object.keys(group.challenge_permissions ?? {}).some(
          (id) => !ids.has(id),
        )
      )
        fail(400, "分组名称重复或单题权限引用无效");
      names.add(group.name);
    }
    validateTiming(
      c,
      manifest.challenges.some((ch) => ch.config.challenge_type === "awd") ||
        !!c.challenge_settings?.some((s) => s.scoring.mode === "round"),
    );
    validateRegistrationWindow(c);
    validateWriteup(writeupInput.parse(c.writeup ?? {}), c);
    if (c.visibility === "private" && c.registration_mode !== "teams")
      fail(400, "私密比赛需要指定参赛战队");
    if (manifest.contest!.poster) checkAsset(manifest.contest!.poster);
  }
  if (referenced.size !== files.size) fail(400, "文件包包含未引用的资源");
}

export function requiredFlags(manifest: ContentManifest) {
  const same = manifest.flag_key_id === keyId();
  return manifest.challenges.flatMap((c) => {
    if (
      c.config.flag_mode !== "static" ||
      c.config.challenge_type === "objective"
    )
      return [];
    return c.config.parts?.length
      ? c.config.parts
          .filter(
            (p) =>
              p.role !== "defense" &&
              !p.flag &&
              !(same && c.part_hashes[p.id!]),
          )
          .map((p) => ({ id: p.id!, label: `${c.config.title} / ${p.title}` }))
      : c.config.flag || (same && c.flag_hash)
        ? []
        : [{ id: c.id, label: c.config.title }];
  });
}

export function contentPreview(
  manifest: ContentManifest,
  token: string,
  size: number,
) {
  const c = manifest.contest?.config;
  return {
    token,
    kind: manifest.kind,
    title: c?.title ?? manifest.challenges[0]!.config.title,
    starts_at: c?.starts_at,
    ends_at: c?.ends_at,
    size,
    questions: manifest.challenges.map((c) => ({
      id: c.id,
      title: c.config.title,
      category: c.config.category,
      challenge_type: c.config.challenge_type,
      parts: c.config.parts?.length ?? 0,
      attachments: c.attachments.length,
    })),
    required_flags: requiredFlags(manifest),
    warnings: [
      ...(c?.registration_mode === "teams"
        ? ["指定参赛战队需在导入后重新选择。"]
        : []),
      ...(c?.registration_mode === "invite" && manifest.flag_key_id !== keyId()
        ? ["报名邀请码需在导入后重新设置。"]
        : []),
    ],
  };
}

async function insert(db: DB, table: "challenges" | "contests", values: Row) {
  values = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  const keys = Object.keys(values);
  await db.query(
    `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(values),
  );
}
const jsonFields = (fields: Row, keys: string[]) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      keys.includes(key) && value != null ? JSON.stringify(value) : value,
    ]),
  );

export async function importContent(
  db: DB,
  actor: string,
  manifest: ContentManifest,
  files: Map<string, ArchiveFile>,
  options: ImportOptions,
) {
  validateContent(manifest, files);
  const required = requiredFlags(manifest);
  if (required.some((f) => !options.flags[f.id])) fail(400, "请填写静态 Flag");
  const known = new Set(
    manifest.challenges.flatMap((c) => [
      c.id,
      ...(c.config.parts ?? []).map((p) => p.id!),
    ]),
  );
  if (Object.keys(options.flags).some((id) => !known.has(id)))
    fail(400, "Flag 引用无效");
  const ids = new Map<string, string>(),
    created: string[] = [];
  const remap = (id: string) => {
    if (!ids.has(id)) ids.set(id, crypto.randomUUID());
    return ids.get(id)!;
  };
  for (const c of manifest.challenges) {
    remap(c.id);
    for (const p of c.config.parts ?? []) remap(p.id!);
    for (const hint of hintDefinitions({ id: c.id, hints: c.config.hints }))
      remap(hint.id);
    for (const a of c.attachments) remap(a.id);
  }
  const rewriteLinks = (text: string) =>
    text.replace(
      /(\/(?:api\/(?:admin\/)?attachments|challenges)\/)([0-9a-f-]{36})/g,
      (all, path, old) => (ids.has(old) ? path + ids.get(old) : all),
    );
  await mkdir(storage(), { recursive: true });
  const copy = async (a: z.infer<typeof asset>, prefix = "") => {
    const target = join(storage(), prefix + remap(a.id));
    await copyFile(
      files.get(`files/${a.id}`)!.path,
      target,
      constants.COPYFILE_EXCL,
    );
    created.push(target);
  };
  try {
    for (const c of manifest.challenges)
      for (const a of c.attachments) await copy(a);
    let mime: string | null = null;
    if (manifest.contest?.poster) {
      const poster = manifest.contest.poster;
      if (poster.size > 5 * 1024 * 1024) fail(400, "海报不能超过 5 MiB");
      mime = posterMime(await readFile(files.get(`files/${poster.id}`)!.path));
      if (!mime) fail(400, "海报格式无效");
      await copy(poster, "poster-");
    }
    return await db.transaction(async (tx) => {
      await lock(tx);
      const same = manifest.flag_key_id === keyId();
      for (const c of manifest.challenges) {
        const data = c.config,
          cid = remap(c.id);
        const parts = (data.parts ?? []).map((p) => ({
          ...p,
          id: remap(p.id!),
          description: rewriteLinks(p.description),
          flag: options.flags[p.id!] ?? p.flag,
        }));
        const prepared = prepareParts(
          parts,
          (data.parts ?? []).map((p, position) => ({
            ...p,
            position,
            id: remap(p.id!),
            flag_hash: same ? (c.part_hashes[p.id!] ?? "") : "",
          })),
          data.flag_mode === "dynamic",
          false,
        );
        const { flag, parts: _parts, ...fields } = data;
        await insert(
          tx,
          "challenges",
          jsonFields(
            {
              ...fields,
              id: cid,
              title:
                manifest.kind === "challenge" ? options.title : fields.title,
              description: rewriteLinks(fields.description),
              published: manifest.kind === "contest" ? fields.published : false,
              publish_at: null,
              practice: manifest.kind === "contest" ? false : fields.practice,
              hints: hintDefinitions({ id: c.id, hints: fields.hints }).map(
                (h) => ({ id: remap(h.id), content: rewriteLinks(h.content) }),
              ),
              flag_hash:
                prepared.length ||
                data.flag_mode === "dynamic" ||
                data.challenge_type === "objective"
                  ? ""
                  : options.flags[c.id] || flag
                    ? flagHash(options.flags[c.id] ?? flag!)
                    : same
                      ? c.flag_hash
                      : "",
            },
            ["resources", "objective", "patch_config", "awd_config", "hints"],
          ),
        );
        await saveParts(tx, cid, prepared);
        for (const a of c.attachments)
          await tx.query(
            "INSERT INTO attachments(id,challenge_id,name,size) VALUES($1,$2,$3,$4)",
            [remap(a.id), cid, a.name, a.size],
          );
      }
      let contestId: string | null = null;
      if (manifest.contest) {
        const original = manifest.contest.config;
        if (!options.starts_at || Date.parse(options.starts_at) <= Date.now())
          fail(400, "请选择未来的开赛时间");
        const delta =
          Date.parse(options.starts_at!) - Date.parse(original.starts_at);
        const shift = (value: string | null | undefined) =>
          value ? new Date(Date.parse(value) + delta).toISOString() : value;
        const c = contestInput.parse({
          ...original,
          title: options.title,
          starts_at: options.starts_at,
          ends_at: shift(original.ends_at),
          freeze_at: shift(original.freeze_at),
          registration_opens_at: shift(original.registration_opens_at),
          registration_closes_at: shift(original.registration_closes_at),
          timing: Object.fromEntries(
            Object.entries(original.timing).map(([section, phase]) => [
              section,
              {
                ...phase,
                opens_at: shift(phase.opens_at),
                closes_at: shift(phase.closes_at),
              },
            ]),
          ),
          ...(original.writeup
            ? {
                writeup: {
                  ...original.writeup,
                  opens_at: shift(original.writeup.opens_at),
                  deadline: shift(original.writeup.deadline),
                },
              }
            : {}),
        });
        const {
          challenge_ids,
          challenge_settings,
          groups,
          registration_code,
          ...fields
        } = c;
        contestId = crypto.randomUUID();
        await insert(
          tx,
          "contests",
          jsonFields(
            {
              ...fields,
              id: contestId,
              published: false,
              description: rewriteLinks(c.description),
              registration_team_ids: [],
              registration_code_hash: same
                ? manifest.contest.registration_code_hash
                : "",
              submission_overrides:
                c.submission_overrides?.map((o) => ({
                  ...o,
                  challenge_id: remap(o.challenge_id),
                })) ?? [],
              hint_overrides:
                c.hint_overrides?.map((o) => ({
                  ...o,
                  challenge_id: remap(o.challenge_id),
                  hint_id: remap(o.hint_id),
                })) ?? [],
              poster_id: manifest.contest.poster
                ? remap(manifest.contest.poster.id)
                : null,
              poster_mime: mime,
            },
            [
              "timing",
              "writeup",
              "resource_limits",
              "submission_limits",
              "submission_overrides",
              "hint_policy",
              "hint_overrides",
            ],
          ),
        );
        for (const [position, id] of challenge_ids.entries()) {
          const setting = challenge_settings?.find(
            (s) => s.challenge_id === id,
          );
          const scoring = setting
            ? {
                ...setting.scoring,
                parts: setting.scoring.parts.map((p) => ({
                  ...p,
                  id: remap(p.id),
                })),
              }
            : { mode: "inherit", parts: [] };
          await tx.query(
            "INSERT INTO contest_challenges(contest_id,challenge_id,published,release_at,scoring,position) VALUES($1,$2,$3,$4,$5,$6)",
            [
              contestId,
              remap(id),
              setting?.published ?? true,
              shift(setting?.release_at) ?? null,
              JSON.stringify(scoring),
              position,
            ],
          );
        }
        await saveContestGroups(
          tx,
          contestId,
          groups?.map(({ id: _id, ...g }) => ({
            ...g,
            challenge_permissions: Object.fromEntries(
              Object.entries(g.challenge_permissions ?? {}).map(
                ([id, permissions]) => [remap(id), permissions],
              ),
            ),
          })),
        );
        for (const n of manifest.contest.announcements)
          await tx.query(
            "INSERT INTO announcements(id,contest_id,title,body,created_by) VALUES($1,$2,$3,$4,$5)",
            [
              crypto.randomUUID(),
              contestId,
              n.title,
              rewriteLinks(n.body),
              actor,
            ],
          );
      }
      const target = contestId ?? remap(manifest.challenges[0]!.id);
      await audit(tx, actor, `${manifest.kind}.import`, target);
      return {
        id: target,
        kind: manifest.kind,
        challenges: manifest.challenges.map((c) => remap(c.id)),
      };
    });
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => {})));
    throw error;
  }
}
