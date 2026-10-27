import { hintDefinitions } from "./hint-rules.js";
import {
  publicContest,
  registrationCodeHash,
  validateRegistrationWindow,
} from "./contest-entry.js";
import { validateWriteup, writeupInput } from "./writeup-config.js";
import { recordContestNotice } from "./activity-events.js";
import { isDeepStrictEqual } from "node:util";
import { flagMode, resourceProfiles } from "./challenge-model.js";
import { validateTiming, contestScoringInput } from "./competition-rules.js";
import { recordContestReleases } from "./contest-activity.js";
import { saveContestGroups } from "./contest-groups.js";
import { prepareParts, saveParts } from "./challenge-parts.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin } from "./auth.js";
import { challengeInput, contestInput, id, page } from "./schemas.js";
import { dynamicFlag, fail, flagHash, rate } from "./security.js";
import { flagTemplateInput, inspectFlagTemplate } from "./flag-template.js";
import { activeStatuses, validateImage } from "./resources.js";
import { config } from "./config.js";
function validatePublication(input: {
  published: boolean;
  publish_at: string | null;
}) {
  if (
    input.publish_at &&
    (input.published || Date.parse(input.publish_at) <= Date.now())
  )
    fail(400, "定时上线须设置未来时间，且不能同时立即启用");
}
export function adminRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/admin/flag-template/preview", async (req) => {
    const user = requireAdmin(req);
    const { template } = z
      .object({ template: flagTemplateInput })
      .parse(req.body);
    await rate(db, `flag-preview:${user.id}`, 120, 60);
    const info = inspectFlagTemplate(template);
    return {
      samples: Array.from({ length: 3 }, () =>
        dynamicFlag(
          "preview",
          "preview",
          crypto.randomUUID(),
          undefined,
          template,
        ),
      ),
      entropy: Math.round(info.entropy * 10) / 10,
      length: info.length,
    };
  });
  const challengeSummary = `SELECT c.*,
    coalesce((SELECT json_agg(json_build_object('id',g.id,'title',g.title) ORDER BY g.starts_at DESC) FROM contest_challenges cc JOIN contests g ON g.id=cc.contest_id WHERE cc.challenge_id=c.id),'[]') contests,
    (SELECT count(*)::int FROM attachments a WHERE a.challenge_id=c.id) attachment_count FROM challenges c`;
  const listChallenges = async (req: FastifyRequest) => {
    requireAdmin(req);
    const p = page
      .extend({
        page_size: z.coerce.number().int().min(1).max(100).default(24),
        practice: z.enum(["", "true", "false"]).default(""),
        state: z.enum(["", "enabled", "disabled", "scheduled"]).default(""),
        challenge_type: z
          .enum(["", "ctf", "objective", "awdp", "awd"])
          .default(""),
        ids: z
          .string()
          .max(18500)
          .optional()
          .transform((v) =>
            v ? z.array(id).max(500).parse(v.split(",")) : null,
          ),
      })
      .parse(req.method === "POST" ? req.body : req.query);
    const condition = `($1='' OR c.title ILIKE '%'||$1||'%') AND ($2='' OR c.category=$2)
      AND ($3='' OR c.practice=($3='true'))
      AND ($4='' OR ($4='enabled' AND c.published) OR ($4='disabled' AND NOT c.published AND c.publish_at IS NULL) OR ($4='scheduled' AND NOT c.published AND c.publish_at IS NOT NULL))
      AND ($5::uuid[] IS NULL OR c.id=ANY($5::uuid[]))
      AND ($6='' OR c.challenge_type=$6)`;
    const args = [
      p.q,
      p.category,
      p.practice,
      p.state,
      p.ids,
      p.challenge_type,
    ];
    const [count] = await db.query(
      `SELECT count(*)::int total FROM challenges c WHERE ${condition}`,
      args,
    );
    const rows = await db.query(
      `${challengeSummary} WHERE ${condition} ORDER BY array_position($5::uuid[],c.id),c.created_at DESC,c.id LIMIT $7 OFFSET $8`,
      [...args, p.page_size, (p.page - 1) * p.page_size],
    );
    const parts = await db.query(
      "SELECT id,challenge_id,title,description,position,role,flag_env,flag_template,initial_points,minimum_points FROM challenge_parts WHERE challenge_id=ANY($1::uuid[]) ORDER BY position",
      [rows.map((c) => c.id)],
    );
    return {
      items: rows.map(({ flag_hash, ...c }) => ({
        ...c,
        hints: hintDefinitions(c as any),
        parts: parts.filter((p) => p.challenge_id === c.id),
      })),
      total: count!.total,
      page: p.page,
      page_size: p.page_size,
    };
  };
  app.get("/api/admin/challenges", listChallenges);
  app.post("/api/admin/challenges/search", listChallenges);
  app.get("/api/admin/challenges/:id", async (req) => {
    requireAdmin(req);
    const cid = id.parse((req.params as any).id);
    const [row] = await db.query(`${challengeSummary} WHERE c.id=$1`, [cid]);
    if (!row) fail(404, "题目不存在");
    const { flag_hash, ...challenge } = row!;
    return {
      ...challenge,
      hints: hintDefinitions(challenge as any),
      parts: await db.query(
        "SELECT id,title,description,position,role,flag_env,flag_template,initial_points,minimum_points FROM challenge_parts WHERE challenge_id=$1 ORDER BY position",
        [cid],
      ),
      attachments: await db.query(
        "SELECT id,name,size FROM attachments WHERE challenge_id=$1 ORDER BY created_at",
        [cid],
      ),
    };
  });
  app.post("/api/admin/challenges/:id/publication", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    const input = z
      .object({
        published: z.boolean(),
        publish_at: z.iso.datetime().nullable().default(null),
      })
      .parse(req.body);
    validatePublication(input);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [old] = await tx.query(
        "SELECT published FROM challenges WHERE id=$1 FOR UPDATE",
        [cid],
      );
      if (!old) fail(404, "题目不存在");
      await tx.query(
        "UPDATE challenges SET published=$2,publish_at=$3 WHERE id=$1",
        [cid, input.published, input.publish_at],
      );
      if (input.published && !old!.published) {
        const links = await tx.query(
          "SELECT contest_id FROM contest_challenges WHERE challenge_id=$1",
          [cid],
        );
        for (const link of links)
          await recordContestReleases(tx, link.contest_id, [cid]);
      }
      if (old!.published && !input.published) {
        const links = await tx.query(
          "SELECT contest_id FROM contest_challenges WHERE challenge_id=$1 AND published AND (release_at IS NULL OR release_at<=now())",
          [cid],
        );
        for (const link of links)
          await recordContestNotice(tx, link.contest_id, cid, "withdraw");
      }
      await audit(tx, user.id, "challenge.publication", cid);
      return { ok: true };
    });
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/challenges${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const u = requireAdmin(req),
          data = challengeInput.parse(req.body),
          cid =
            method === "PUT"
              ? id.parse((req.params as any).id)
              : crypto.randomUUID();
        validatePublication(data);
        for (const profile of Object.values(resourceProfiles(data)))
          if (profile) validateImage(profile.image);
        if (data.patch_config) validateImage(data.patch_config.checker_image);
        if (data.awd_config) validateImage(data.awd_config.checker_image);
        return db.transaction(async (tx) => {
          await lock(tx);
          const [old] = await tx.query(
            "SELECT * FROM challenges WHERE id=$1 FOR UPDATE",
            [cid],
          );
          if (method === "PUT" && !old) fail(404, "题目不存在");
          const oldParts = await tx.query(
            "SELECT * FROM challenge_parts WHERE challenge_id=$1 ORDER BY position,id",
            [cid],
          );
          let frozen = false;
          if (
            data.challenge_type === "ctf" &&
            data.flag_mode === "static" &&
            !(data.parts ?? oldParts).length &&
            !data.flag &&
            !old?.flag_hash
          )
            fail(400, "静态题目必须配置 flag");
          if (old) {
            const used =
              (
                await tx.query(
                  "SELECT 1 FROM solves WHERE challenge_id=$1 UNION ALL SELECT 1 FROM part_solves WHERE challenge_id=$1 UNION ALL SELECT 1 FROM objective_answers WHERE challenge_id=$1 AND finalized_at IS NOT NULL LIMIT 1",
                  [cid],
                )
              ).length > 0;
            const active =
              (
                await tx.query(
                  "SELECT 1 FROM instances WHERE challenge_id=$1 AND scope<>'test' AND status=ANY($2::text[]) UNION ALL SELECT 1 FROM judge_jobs WHERE challenge_id=$1 AND status IN ('queued','building','checking') LIMIT 1",
                  [cid, activeStatuses],
                )
              ).length > 0;
            frozen = used || active;
            if (
              frozen &&
              (data.challenge_type !== old.challenge_type ||
                data.flag_mode !== flagMode(old) ||
                (data.flag_env ?? old.flag_env ?? "FLAG") !==
                  (old.flag_env ?? "FLAG") ||
                (data.flag_template ?? old.flag_template ?? "") !==
                  (old.flag_template ?? "") ||
                !isDeepStrictEqual(
                  resourceProfiles(data),
                  resourceProfiles(old),
                ) ||
                ["objective", "patch_config", "awd_config"].some(
                  (key) =>
                    !isDeepStrictEqual(
                      data[key as keyof typeof data] ?? null,
                      old[key] ?? null,
                    ),
                ))
            )
              fail(409, "已有解题或活跃环境，不能更改题型、答案或资源配置");
            if (
              frozen &&
              (
                [
                  "kind",
                  "access_mode",
                  "image",
                  "port",
                  "cpu",
                  "memory",
                  "ttl",
                  "initial_points",
                  "minimum_points",
                  "decay",
                  "dynamic_score",
                ] as const
              ).some((k) => data[k] !== old[k])
            )
              fail(409, "已有解题或活跃环境，请新建题目版本");
            if (
              (used || active) &&
              data.flag &&
              flagHash(data.flag) !== old.flag_hash
            )
              fail(409, "已有解题或活跃环境，不能更换 flag");
          }
          if (
            data.practice &&
            !old?.practice &&
            (
              await tx.query(
                "SELECT 1 FROM contest_challenges cc JOIN contests c ON c.id=cc.contest_id WHERE cc.challenge_id=$1 AND c.ends_at>now() LIMIT 1",
                [cid],
              )
            ).length
          )
            fail(409, "未结束的赛题不能开放练习");
          const parts = prepareParts(
            data.parts,
            oldParts,
            data.flag_mode === "dynamic",
            frozen,
          );
          const { flag, parts: _parts, ...fields } = data;
          const values = {
            ...fields,
            flag_env: fields.flag_env ?? old?.flag_env ?? "FLAG",
            flag_template:
              fields.flag_mode === "dynamic"
                ? (fields.flag_template ?? old?.flag_template ?? "")
                : "",
            hints: JSON.stringify(
              hintDefinitions({ id: cid, hints: fields.hints }),
            ),
            resources: fields.resources
              ? JSON.stringify(fields.resources)
              : null,
            objective: fields.objective
              ? JSON.stringify(fields.objective)
              : null,
            patch_config: fields.patch_config
              ? JSON.stringify(fields.patch_config)
              : null,
            awd_config: fields.awd_config
              ? JSON.stringify(fields.awd_config)
              : null,
            flag_hash: parts.length
              ? ""
              : flag
                ? flagHash(flag)
                : (old?.flag_hash ?? ""),
          };
          const keys = Object.keys(values);
          const params = Object.values(values);
          if (old)
            await tx.query(
              `UPDATE challenges SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1}`,
              [...params, cid],
            );
          else
            await tx.query(
              `INSERT INTO challenges(${keys.join(",")},id) VALUES(${[...params, cid].map((_, i) => `$${i + 1}`).join(",")})`,
              [...params, cid],
            );
          await saveParts(tx, cid, parts);
          if (
            old?.published &&
            (!data.published ||
              hintDefinitions({ id: cid, hints: data.hints }).some(
                (hint) =>
                  !hintDefinitions(old as any).some(
                    (previous) =>
                      previous.id === hint.id &&
                      previous.content === hint.content,
                  ),
              ))
          ) {
            const links = await tx.query(
              "SELECT contest_id FROM contest_challenges WHERE challenge_id=$1 AND published AND (release_at IS NULL OR release_at<=now())",
              [cid],
            );
            for (const link of links)
              await recordContestNotice(
                tx,
                link.contest_id,
                cid,
                data.published ? "hint" : "withdraw",
              );
          }
          if (data.published && !old?.published) {
            const contests = await tx.query(
              "SELECT contest_id FROM contest_challenges WHERE challenge_id=$1",
              [cid],
            );
            for (const contest of contests)
              await recordContestReleases(tx, contest.contest_id, [cid]);
          }
          await audit(
            tx,
            u.id,
            old ? "challenge.update" : "challenge.create",
            cid,
          );
          return { id: cid };
        });
      },
    });
  const contestSummary = `SELECT c.*,(SELECT count(*)::int FROM registrations r WHERE r.contest_id=c.id) teams,
    coalesce((SELECT json_agg(g ORDER BY g.position) FROM contest_groups g WHERE g.contest_id=c.id),'[]') groups,
    coalesce((SELECT json_agg(cc.challenge_id ORDER BY cc.position,cc.challenge_id) FROM contest_challenges cc WHERE cc.contest_id=c.id),'[]') challenge_ids,
    coalesce((SELECT json_agg(json_build_object('challenge_id',cc.challenge_id,'published',cc.published,'release_at',cc.release_at,'scoring',cc.scoring) ORDER BY cc.position,cc.challenge_id) FROM contest_challenges cc WHERE cc.contest_id=c.id),'[]') challenge_settings FROM contests c`;
  app.get("/api/admin/contests", async (req) => {
    requireAdmin(req);
    const p = page
      .extend({
        page_size: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM contests WHERE ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    return {
      items: (
        await db.query(
          `${contestSummary} WHERE ($1='' OR c.title ILIKE '%'||$1||'%') ORDER BY c.starts_at DESC,c.id LIMIT $2 OFFSET $3`,
          [p.q, p.page_size, (p.page - 1) * p.page_size],
        )
      ).map((c) => publicContest(c, true)),
      total: count!.total,
      page: p.page,
      page_size: p.page_size,
    };
  });
  app.get("/api/admin/contests/:id", async (req) => {
    requireAdmin(req);
    const [contest] = await db.query(`${contestSummary} WHERE c.id=$1`, [
      id.parse((req.params as any).id),
    ]);
    if (!contest) fail(404, "比赛不存在");
    return publicContest(contest!, true);
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/contests${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const u = requireAdmin(req),
          data = contestInput.parse(req.body),
          cid =
            method === "PUT"
              ? id.parse((req.params as any).id)
              : crypto.randomUUID();
        return db.transaction(async (tx) => {
          await lock(tx);
          const [old] = await tx.query(
            "SELECT * FROM contests WHERE id=$1 FOR UPDATE",
            [cid],
          );
          if (method === "PUT" && !old) fail(404, "比赛不存在");
          validateRegistrationWindow({ ...old, ...data });
          const ids = [...new Set(data.challenge_ids)];
          const previous = await tx.query(
            "SELECT * FROM contest_challenges WHERE contest_id=$1",
            [cid],
          );
          if (
            new Set(
              data.challenge_settings?.map((setting) => setting.challenge_id),
            ).size !== (data.challenge_settings?.length ?? 0) ||
            data.challenge_settings?.some(
              (setting) => !ids.includes(setting.challenge_id),
            )
          )
            fail(400, "赛题配置必须属于当前比赛且不能重复");
          if (old && new Date(old.starts_at).getTime() <= Date.now()) {
            if (data.round_duration !== old.round_duration)
              fail(409, "开赛后不能更改比赛轮次时长");
            if (!isDeepStrictEqual(data.timing, old.timing ?? {}))
              fail(409, "开赛后不能更改作答时间规则");
            if (
              data.challenge_settings?.some(
                (setting) =>
                  !isDeepStrictEqual(
                    contestScoringInput.parse(setting.scoring),
                    contestScoringInput.parse(
                      previous.find(
                        (p) => p.challenge_id === setting.challenge_id,
                      )?.scoring ?? {},
                    ),
                  ),
              )
            )
              fail(409, "开赛后不能更改计分规则");
            const linked = previous;
            if (
              ["starts_at", "ends_at", "freeze_at"].some(
                (k) =>
                  (old[k] ? new Date(old[k]).toISOString() : null) !==
                  (data[k as keyof typeof data] ?? null),
              ) ||
              old.team_limit !== data.team_limit ||
              JSON.stringify(linked.map((v) => v.challenge_id).sort()) !==
                JSON.stringify([...ids].sort())
            )
              fail(409, "开赛后不能更改时间、队伍限制或赛题集合");
          }
          const [oversize] = await tx.query(
            "SELECT 1 FROM registrations r JOIN memberships m ON m.team_id=r.team_id WHERE r.contest_id=$1 GROUP BY r.team_id HAVING count(*)>$2 LIMIT 1",
            [cid, data.team_limit],
          );
          if (oversize) fail(409, "已有报名战队超过新人数限制");
          if (ids.length) {
            const selected = await tx.query(
              "SELECT id,practice,challenge_type FROM challenges WHERE id=ANY($1::uuid[])",
              [ids],
            );
            if (selected.length !== ids.length) fail(400, "题目不存在");
            validateTiming(
              data,
              selected.some((c) => c.challenge_type === "awd") ||
                ids.some(
                  (id) =>
                    (
                      data.challenge_settings?.find(
                        (s) => s.challenge_id === id,
                      ) ?? previous.find((s) => s.challenge_id === id)
                    )?.scoring.mode === "round",
                ),
            );
            const parts = await tx.query(
              "SELECT id,challenge_id FROM challenge_parts WHERE challenge_id=ANY($1::uuid[])",
              [ids],
            );
            for (const challenge of selected) {
              const setting =
                data.challenge_settings?.find(
                  (s) => s.challenge_id === challenge.id,
                ) ?? previous.find((s) => s.challenge_id === challenge.id);
              if (
                challenge.challenge_type === "awd" &&
                setting?.scoring.mode !== "round"
              )
                fail(400, "AWD 题目需要配置轮次计分");
            }
            for (const setting of data.challenge_settings ?? []) {
              if (
                setting.release_at &&
                (setting.release_at < data.starts_at ||
                  setting.release_at >= data.ends_at)
              )
                fail(400, "题目上线时间必须在比赛期间");
              const type = selected.find(
                (c) => c.id === setting.challenge_id,
              )!.challenge_type;
              if (
                type === "objective" &&
                !["inherit", "fixed"].includes(setting.scoring.mode)
              )
                fail(400, "客观题使用固定分值");
              if (type === "awd" && setting.scoring.mode !== "round")
                fail(400, "AWD 题目需要轮次计分");
              if (
                setting.scoring.parts.some(
                  (p) =>
                    !parts.some(
                      (part) =>
                        part.id === p.id &&
                        part.challenge_id === setting.challenge_id,
                    ),
                )
              )
                fail(400, "小题计分配置不属于当前题目");
            }
          }
          validateTiming(data, false);
          validateWriteup(
            writeupInput.parse(data.writeup ?? old?.writeup ?? {}),
            data,
          );
          const mode =
            data.registration_mode ?? old?.registration_mode ?? "public";
          const visibility = data.visibility ?? old?.visibility ?? "public";
          if (visibility === "private" && mode !== "teams")
            fail(400, "私密比赛请选择允许参赛的战队");
          const codeHash = data.registration_code
            ? registrationCodeHash(data.registration_code)
            : (old?.registration_code_hash ?? "");
          const allowedTeams = [
            ...new Set(
              data.registration_team_ids ?? old?.registration_team_ids ?? [],
            ),
          ];
          if (mode === "invite" && !codeHash) fail(400, "请设置报名邀请码");
          if (mode === "teams" && !allowedTeams.length)
            fail(400, "请至少选择一支允许报名的战队");
          if (
            allowedTeams.length &&
            (
              await tx.query("SELECT id FROM teams WHERE id=ANY($1::uuid[])", [
                allowedTeams,
              ])
            ).length !== allowedTeams.length
          )
            fail(400, "指定的战队不存在");
          const {
            registration_code,
            challenge_ids,
            challenge_settings,
            groups,
            timing,
            writeup,
            resource_limits,
            submission_limits,
            submission_overrides,
            hint_policy,
            hint_overrides,
            ...otherFields
          } = data;
          const fields = {
            ...otherFields,
            ...(submission_limits
              ? { submission_limits: JSON.stringify(submission_limits) }
              : {}),
            ...(submission_overrides
              ? {
                  submission_overrides: JSON.stringify(
                    submission_overrides.filter((v) =>
                      ids.includes(v.challenge_id),
                    ),
                  ),
                }
              : {}),
            ...(hint_policy
              ? { hint_policy: JSON.stringify(hint_policy) }
              : {}),
            ...(hint_overrides
              ? {
                  hint_overrides: JSON.stringify(
                    hint_overrides.filter((h) => ids.includes(h.challenge_id)),
                  ),
                }
              : {}),
            registration_code_hash: codeHash,
            registration_team_ids: allowedTeams,
            timing: JSON.stringify(timing),
            ...(resource_limits
              ? { resource_limits: JSON.stringify(resource_limits) }
              : {}),
            ...(writeup ? { writeup: JSON.stringify(writeup) } : {}),
          };
          const keys = Object.keys(fields),
            params = Object.values(fields);
          if (old)
            await tx.query(
              `UPDATE contests SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1}`,
              [...params, cid],
            );
          else
            await tx.query(
              `INSERT INTO contests(${keys.join(",")},id) VALUES(${[...params, cid].map((_, i) => `$${i + 1}`).join(",")})`,
              [...params, cid],
            );
          await tx.query("DELETE FROM contest_challenges WHERE contest_id=$1", [
            cid,
          ]);
          for (const [position, challenge] of ids.entries()) {
            const setting =
              challenge_settings?.find(
                (item) => item.challenge_id === challenge,
              ) ?? previous.find((item) => item.challenge_id === challenge);
            await tx.query(
              "INSERT INTO contest_challenges(contest_id,challenge_id,published,release_at,scoring,position,release_announced_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                cid,
                challenge,
                setting?.published ?? true,
                setting?.release_at ?? null,
                JSON.stringify(
                  setting?.scoring ?? { mode: "inherit", parts: [] },
                ),
                position,
                (() => {
                  const old = previous.find(
                    (item) => item.challenge_id === challenge,
                  );
                  return old?.published === setting?.published &&
                    (old?.release_at
                      ? new Date(old.release_at).toISOString()
                      : null) ===
                      (setting?.release_at
                        ? new Date(setting.release_at).toISOString()
                        : null)
                    ? (old?.release_announced_at ?? null)
                    : null;
                })(),
              ],
            );
          }
          for (const before of previous) {
            const after = challenge_settings?.find(
              (s) => s.challenge_id === before.challenge_id,
            );
            if (
              before.published &&
              (!before.release_at ||
                new Date(before.release_at).getTime() <= Date.now()) &&
              after &&
              (!after.published ||
                (after.release_at && Date.parse(after.release_at) > Date.now()))
            )
              await recordContestNotice(
                tx,
                cid,
                before.challenge_id,
                "withdraw",
              );
          }
          await saveContestGroups(tx, cid, groups);
          if (data.published)
            await recordContestReleases(
              tx,
              cid,
              ids.filter(
                (id) =>
                  !old?.published ||
                  !previous.some((row) => row.challenge_id === id) ||
                  (!!challenge_settings?.find((s) => s.challenge_id === id)
                    ?.published &&
                    !previous.find((row) => row.challenge_id === id)
                      ?.published),
              ),
            );
          await audit(tx, u.id, old ? "contest.update" : "contest.create", cid);
          return { id: cid };
        });
      },
    });
  app.get("/api/admin/announcements", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    const [count] = await db.query(
      "SELECT count(*)::int total FROM announcements WHERE ($1='' OR title ILIKE '%'||$1||'%')",
      [p.q],
    );
    return {
      items: await db.query(
        "SELECT a.*,c.title contest_title FROM announcements a LEFT JOIN contests c ON c.id=a.contest_id WHERE ($1='' OR a.title ILIKE '%'||$1||'%') ORDER BY a.created_at DESC,a.id LIMIT 24 OFFSET $2",
        [p.q, (p.page - 1) * 24],
      ),
      total: count!.total,
      page: p.page,
    };
  });
  app.get("/api/admin/announcements/:id", async (req) => {
    requireAdmin(req);
    const [notice] = await db.query("SELECT * FROM announcements WHERE id=$1", [
      id.parse((req.params as any).id),
    ]);
    if (!notice) fail(404, "公告不存在");
    return notice;
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/announcements${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const user = requireAdmin(req),
          aid =
            method === "PUT"
              ? id.parse((req.params as any).id)
              : crypto.randomUUID();
        const data = z
          .object({
            title: z.string().min(1).max(120),
            body: z.string().min(1).max(10000),
            contest_id: id.nullable().default(null),
          })
          .parse(req.body);
        await db.transaction(async (tx) => {
          await lock(tx);
          if (
            data.contest_id &&
            !(
              await tx.query("SELECT 1 FROM contests WHERE id=$1", [
                data.contest_id,
              ])
            ).length
          )
            fail(400, "比赛不存在");
          if (method === "PUT") {
            const rows = await tx.query(
              "UPDATE announcements SET title=$2,body=$3,contest_id=$4 WHERE id=$1 RETURNING id",
              [aid, data.title, data.body, data.contest_id],
            );
            if (!rows.length) fail(404, "公告不存在");
          } else
            await tx.query(
              "INSERT INTO announcements(id,title,body,contest_id) VALUES($1,$2,$3,$4)",
              [aid, data.title, data.body, data.contest_id],
            );
          await audit(
            tx,
            user.id,
            method === "PUT" ? "announcement.update" : "announcement.create",
            aid,
          );
        });
        return { id: aid };
      },
    });
  app.get("/api/admin/resources", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    const [count] = await db.query("SELECT count(*)::int total FROM instances");
    const [usage] = await db.query(
      `SELECT count(*)::int instances,coalesce(sum((spec->>'cpu')::int),0)::int cpu,coalesce(sum((spec->>'memory')::int),0)::int memory FROM instances WHERE status=ANY($1::text[])`,
      [activeStatuses],
    );
    return {
      usage,
      total: count!.total,
      page: p.page,
      limits: {
        instances: config.MAX_INSTANCES,
        cpu: config.MAX_CPU,
        memory: config.MAX_MEMORY,
      },
      items: await db.query(
        "SELECT i.id,c.title,i.status,i.kind,i.scope,i.owner_key,i.spec,i.endpoint,i.expires_at,i.error FROM instances i JOIN challenges c ON c.id=i.challenge_id ORDER BY i.created_at DESC,i.id LIMIT 24 OFFSET $1",
        [(p.page - 1) * 24],
      ),
    };
  });
  app.get("/api/admin/audit", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    return {
      page: p.page,
      page_size: 10,
      total: (await db.query("SELECT count(*)::int n FROM audit_logs"))[0]!.n,
      items: await db.query(
        "SELECT a.id,u.username,a.action,a.target,a.created_at FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 10 OFFSET $1",
        [(p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/admin/submissions", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    return {
      page: p.page,
      page_size: 10,
      total: (await db.query("SELECT count(*)::int n FROM submissions"))[0]!.n,
      items: await db.query(
        "SELECT s.id,u.username,c.title,s.scope,s.correct,s.created_at,s.contest_practice,p.title part_title FROM submissions s LEFT JOIN challenge_parts p ON p.id=s.part_id JOIN users u ON u.id=s.user_id JOIN challenges c ON c.id=s.challenge_id ORDER BY s.created_at DESC,s.id DESC LIMIT 10 OFFSET $1",
        [(p.page - 1) * 10],
      ),
    };
  });
  app.get("/api/admin/users", async (req) => {
    requireAdmin(req);
    const p = page.parse(req.query);
    return {
      items: await db.query(
        "SELECT id,username,email,role,disabled,created_at FROM users WHERE username ILIKE '%'||$1||'%' ORDER BY created_at DESC LIMIT 50 OFFSET $2",
        [p.q, (p.page - 1) * 50],
      ),
    };
  });
  app.post("/api/admin/users/:id/status", async (req) => {
    const u = requireAdmin(req),
      uid = id.parse((req.params as any).id),
      { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);
    if (uid === u.id) fail(400, "不能禁用自己");
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET disabled=$1 WHERE id=$2", [
        disabled,
        uid,
      ]);
      if (disabled)
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(tx, u.id, disabled ? "user.disable" : "user.enable", uid);
    });
    return { ok: true };
  });
}
