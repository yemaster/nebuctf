import { withQueuePositions } from "./resource-queue.js";
import { contestResourcePolicy } from "./contest-resource-limits.js";
import { permissionSQL } from "./group-permissions.js";
import { flagEnvironmentSpec } from "./flag-environment.js";
import { resourceChallenge } from "./challenge-model.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin, requireUser } from "./auth.js";
import { teamPhases } from "./contest-timing.js";
import { challengeAccess, ownerFor, contestAccess } from "./context.js";
import { config } from "./config.js";
import { id, scope as scopeSchema } from "./schemas.js";
import { fail, rate, HttpError } from "./security.js";
import { imageKey, imagePrefixKey } from "./image-reference.js";
import { allocationPlan } from "./container-policy.js";
import { getSetting } from "./settings.js";
export const storage = () => join(config.DATA_DIR, "files");
function sendAttachment(
  reply: FastifyReply,
  attachment: { id: string; name: string; size: number },
) {
  return reply
    .header("Content-Length", attachment.size)
    .header("Content-Type", "application/octet-stream")
    .header(
      "Content-Disposition",
      `attachment; filename="attachment.bin"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    )
    .send(createReadStream(join(storage(), attachment.id)));
}
export const activeStatuses = [
  "queued",
  "starting",
  "running",
  "ready",
  "stopping",
];
export function validateImage(image: string) {
  if (
    !config.IMAGE_PREFIXES.split(",")
      .filter(Boolean)
      .some((p) => imageKey(image).startsWith(imagePrefixKey(p.trim())))
  )
    fail(400, "镜像不在允许的仓库前缀内");
}
// Called under the resource transaction lock; failed transactions do not consume a turn.
export async function resourceCooldown(
  db: DB,
  owner: string,
  scope: string,
  challenge: string,
  type = "container",
) {
  const key = `resource:${owner}:${scope}:${challenge}${type !== "container" ? `:${type}` : ""}`;
  const [current] = await db.query(
    "SELECT expires_at FROM rate_limits WHERE key=$1 AND expires_at>now()",
    [key],
  );
  if (current) {
    const seconds = Math.max(
      1,
      Math.ceil((new Date(current.expires_at).getTime() - Date.now()) / 1000),
    );
    throw new HttpError(
      429,
      `操作过于频繁，请在 ${seconds} 秒后重试`,
      undefined,
      seconds,
    );
  }
  await db.query(
    "INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '60 seconds') ON CONFLICT(key) DO UPDATE SET hits=1,expires_at=excluded.expires_at",
    [key],
  );
}
export function resourceRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/challenges/:id/instances", async (req) => {
    const u = requireUser(req),
      cid = id.parse((req.params as any).id),
      { scope, resource_type, replace_ids } = z
        .object({
          scope: scopeSchema,
          resource_type: z.enum(["container", "attachment"]).optional(),
          replace_ids: z.array(z.uuid()).max(100).default([]),
        })
        .parse(req.body);
    await rate(db, `instance:${u.id}`, 10, 60);
    return db.transaction(async (tx) => {
      await lock(tx);
      const challenge = await challengeAccess(
        tx,
        cid,
        scope,
        u,
        true,
        "resources",
      );
      if (challenge.challenge_type === "awd")
        fail(400, "AWD 环境由比赛统一调度");
      const c = resourceChallenge(challenge, resource_type);
      if (!c) return fail(400, "此题没有配置该资源");
      validateImage(c.image);
      if (c.kind === "static_container" && u.role !== "admin")
        fail(403, "公共环境由管理员启动");
      const owner =
        c.kind === "static_container" ? "shared" : await ownerFor(tx, scope, u);
      const [existing] = await tx.query(
        "SELECT id,status FROM instances WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND status=ANY($4::text[]) AND resource_type=$5",
        [cid, scope, owner, activeStatuses, c.resource_type],
      );
      if (existing) return existing;
      const { policy, replacements } = await allocationPlan(
        tx,
        scope,
        owner,
        c,
      );
      if (
        replacements.length &&
        (replace_ids.length !== replacements.length ||
          replacements.some((old) => !replace_ids.includes(old.id)))
      )
        return {
          requires_confirmation: true,
          replacements: replacements.map((old) => ({
            id: old.id,
            title: old.title,
          })),
        };
      await resourceCooldown(tx, owner, scope, cid, c.resource_type);
      for (const old of replacements) {
        await resourceCooldown(tx, owner, scope, old.challenge_id);
        await tx.query(
          "UPDATE instances SET status='stopping',updated_at=now() WHERE id=$1",
          [old.id],
        );
        await audit(tx, u.id, "instance.replace", old.id);
      }
      const timed = c.resource_type === "container" && owner !== "shared";
      const ttl =
        timed && (c.use_platform_ttl ?? c.ttl === 1800)
          ? policy.default_ttl
          : c.ttl;
      const iid = crypto.randomUUID();
      const expiry = new Date(Date.now() + 5 * 60 * 1000);
      let maximum = new Date(
        Date.now() +
          (owner === "shared"
            ? 7 * 86400
            : timed
              ? ttl + policy.renew_limit * policy.renew_seconds + 300
              : 4 * 3600) *
            1000,
      );
      if (scope !== "practice" && !challenge.contest_practice) {
        const [contest] = await tx.query(
          "SELECT ends_at FROM contests WHERE id=$1",
          [scope],
        );
        maximum = new Date(
          Math.min(
            maximum.getTime(),
            new Date(
              challenge.phase?.deadline_at ?? contest!.ends_at,
            ).getTime(),
          ),
        );
      }
      await tx.query(
        "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at,resource_type) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10)",
        [
          iid,
          cid,
          scope,
          owner,
          u.id,
          c.kind,
          JSON.stringify({
            ...(await flagEnvironmentSpec(tx, c)),
            image: c.image,
            access_mode: c.access_mode,
            port: c.port,
            cpu: c.cpu,
            memory: c.memory,
            ttl,
            ...(timed
              ? {
                  renew_limit: policy.renew_limit,
                  renew_seconds: policy.renew_seconds,
                }
              : {}),
            ...(replacements.length
              ? { replace_ids: replacements.map((old) => old.id) }
              : {}),
          }),
          new Date(Math.min(expiry.getTime(), maximum.getTime())),
          maximum,
          c.resource_type,
        ],
      );
      await audit(tx, u.id, "instance.create", iid);
      return { id: iid, status: "queued" };
    });
  });
  app.get("/api/instances", async (req) => {
    const u = requireUser(req);
    const { scope, owned } = z
      .object({
        scope: scopeSchema,
        owned: z.enum(["true", "false"]).default("false"),
      })
      .parse(req.query);
    const owner = await ownerFor(db, scope, u);
    const contest = await contestAccess(db, scope, u, false);
    const visible =
      !contest ||
      (await teamPhases(db, contest, owner)).some(
        (p) => p.section === "practical" && p.status === "active",
      );
    return {
      items: await withQueuePositions(
        db,
        await db.query(
          `SELECT i.id,i.scope,i.challenge_id,c.title,i.status,i.kind,i.resource_type,CASE WHEN $5::boolean THEN i.endpoint ELSE NULL END endpoint,i.expires_at,i.created_at,i.renew_count,(i.spec->>'renew_limit')::int renew_limit,i.max_expires_at,r.expires_at next_operation_at,(i.spec->>'ttl')::int ttl,i.owner_key='shared' shared,i.error FROM instances i JOIN challenges c ON c.id=i.challenge_id LEFT JOIN registrations reg ON reg.contest_id::text=i.scope AND 't:'||reg.team_id=$2 LEFT JOIN contest_groups g ON g.id=reg.group_id LEFT JOIN rate_limits r ON r.key='resource:'||i.owner_key||':'||i.scope||':'||i.challenge_id::text||CASE WHEN i.resource_type='attachment' THEN ':attachment' ELSE '' END WHERE i.scope=$1 AND ${permissionSQL("g", "i.challenge_id", "view")} AND ${permissionSQL("g", "i.challenge_id", "resources")} AND (i.owner_key=$2 OR (i.owner_key='shared' AND $4::boolean=false AND $5::boolean AND c.published AND ($1='practice' OR EXISTS(SELECT 1 FROM contest_challenges cc WHERE cc.contest_id::text=$1 AND cc.challenge_id=c.id AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()))))) AND i.status=ANY($3::text[]) ORDER BY i.created_at DESC LIMIT 100`,
          [
            scope,
            owner,
            [...activeStatuses, "failed"],
            owned === "true",
            visible,
          ],
        ),
      ),
    };
  });
  app.get("/api/challenges/:id/instance-policy", async (req) => {
    const u = requireUser(req),
      cid = id.parse((req.params as any).id);
    const scope = scopeSchema.parse((req.query as any).scope);
    const challenge = await challengeAccess(
      db,
      cid,
      scope,
      u,
      true,
      "resources",
    );
    const type = z
      .enum(["container", "attachment"])
      .optional()
      .parse((req.query as any).resource_type);
    const c = resourceChallenge(challenge, type);
    if (!c) return fail(400, "此题没有配置该资源");
    const owner =
      c.kind === "static_container" ? "shared" : await ownerFor(db, scope, u);
    const [row] = await db.query(
      "SELECT expires_at FROM rate_limits WHERE key=$1 AND expires_at>now()",
      [
        `resource:${owner}:${scope}:${cid}${c.resource_type === "attachment" ? ":attachment" : ""}`,
      ],
    );
    return {
      next_operation_at: row?.expires_at ?? null,
      quota: await contestResourcePolicy(db, scope, owner, c.resource_type),
      auto_destroy:
        c.resource_type === "container" &&
        (await getSetting(db, "containers")).auto_destroy,
    };
  });
  async function owned(tx: DB, iid: string, u: ReturnType<typeof requireUser>) {
    const [i] = await tx.query(
      "SELECT * FROM instances WHERE id=$1 FOR UPDATE",
      [iid],
    );
    if (!i) fail(404, "环境不存在");
    if (i!.scope === "test" && u.role !== "admin")
      fail(403, "无权操作测试环境");
    if (
      u.role !== "admin" &&
      (i!.owner_key === "shared" ||
        i!.owner_key !== (await ownerFor(tx, i!.scope, u)))
    )
      fail(403, "无权操作此环境");
    return i!;
  }
  app.post("/api/instances/:id/stop", async (req) => {
    const u = requireUser(req),
      iid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      await lock(tx);
      const i = await owned(tx, iid, u);
      if (i.spec.awd) fail(400, "AWD 环境不能释放，请使用重启操作");
      if (["stopped", "failed", "stopping"].includes(i.status))
        return { ok: true };
      await resourceCooldown(
        tx,
        i.owner_key,
        i.scope,
        i.challenge_id,
        i.resource_type,
      );
      await tx.query(
        "UPDATE instances SET status='stopping',updated_at=now() WHERE id=$1 AND status=ANY($2::text[])",
        [iid, activeStatuses],
      );
      await audit(tx, u.id, "instance.stop", iid);
      return { ok: true };
    });
  });
  app.post("/api/instances/:id/renew", async (req) => {
    const u = requireUser(req),
      iid = id.parse((req.params as any).id);
    return db.transaction(async (tx) => {
      await lock(tx);
      const i = await owned(tx, iid, u);
      if (i.scope === "test") fail(400, "测试环境不支持续期，请重新创建");
      if (i.spec.awd || i.owner_key === "shared")
        fail(400, "此环境由比赛统一管理");
      await challengeAccess(tx, i.challenge_id, i.scope, u, true, "resources");
      if (
        i.status !== "running" ||
        new Date(i.expires_at).getTime() <= Date.now()
      )
        fail(409, "环境不在运行中");
      const policy = await getSetting(tx, "containers");
      if (i.renew_count >= (i.spec.renew_limit ?? policy.renew_limit))
        fail(409, "续期次数已用完");
      const expires = new Date(
        Math.min(
          new Date(i.expires_at).getTime() +
            (i.spec.renew_seconds ?? policy.renew_seconds) * 1000,
          new Date(i.max_expires_at).getTime(),
        ),
      );
      if (expires.getTime() <= new Date(i.expires_at).getTime())
        fail(409, "已到可续期截止时间");
      await tx.query(
        "UPDATE instances SET expires_at=$1,renew_count=renew_count+1,updated_at=now() WHERE id=$2",
        [expires, iid],
      );
      await audit(tx, u.id, "instance.renew", iid);
      return { expires_at: expires, renew_count: i.renew_count + 1 };
    });
  });
  app.post("/api/admin/challenges/:id/attachments", async (req) => {
    const u = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    if (!(await db.query("SELECT 1 FROM challenges WHERE id=$1", [cid])).length)
      fail(404, "题目不存在");
    const file = await req.file();
    if (!file) fail(400, "请选择附件");
    const data = await file!.toBuffer();
    if (file!.file.truncated) fail(413, "附件超过 20 MiB");
    const aid = crypto.randomUUID();
    await mkdir(storage(), { recursive: true });
    await writeFile(join(storage(), aid), data, { flag: "wx", mode: 0o600 });
    const name =
      file!.filename.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) ||
      "attachment.bin";
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO attachments(id,challenge_id,name,size) VALUES($1,$2,$3,$4)",
          [aid, cid, name, data.length],
        );
        await audit(tx, u.id, "attachment.upload", aid);
      });
    } catch (e) {
      await unlink(join(storage(), aid));
      throw e;
    }
    return { id: aid, name, size: data.length };
  });
  app.get("/api/attachments/:id", async (req, reply) => {
    const u = requireUser(req),
      aid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.query as any).scope);
    const [a] = await db.query("SELECT * FROM attachments WHERE id=$1", [aid]);
    if (!a) fail(404, "附件不存在");
    await challengeAccess(db, a!.challenge_id, scope, u, true, "resources");
    return sendAttachment(reply, { id: aid, name: a!.name, size: a!.size });
  });
  app.get("/api/admin/attachments/:id", async (req, reply) => {
    requireAdmin(req);
    const aid = id.parse((req.params as any).id);
    const [a] = await db.query(
      "SELECT id,name,size FROM attachments WHERE id=$1",
      [aid],
    );
    if (!a) fail(404, "附件不存在");
    return sendAttachment(reply, { id: aid, name: a!.name, size: a!.size });
  });
  app.delete("/api/admin/attachments/:id", async (req) => {
    const user = requireAdmin(req),
      aid = id.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      const rows = await tx.query(
        "DELETE FROM attachments WHERE id=$1 RETURNING id",
        [aid],
      );
      if (!rows.length) fail(404, "附件不存在");
      await audit(tx, user.id, "attachment.delete", aid);
    });
    await unlink(join(storage(), aid)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT")
        console.error("attachment file cleanup failed", aid, error.code);
    });
    return { ok: true };
  });
  app.get("/api/instances/:id/artifact", async (req, reply) => {
    const u = requireUser(req),
      iid = id.parse((req.params as any).id);
    const [i] = await db.query("SELECT * FROM instances WHERE id=$1", [iid]);
    if (
      !i ||
      i.status !== "ready" ||
      i.kind !== "dynamic_attachment" ||
      new Date(i.expires_at).getTime() <= Date.now()
    )
      fail(404, "附件尚未就绪或已过期");
    if (i!.scope === "test") requireAdmin(req);
    else {
      await challengeAccess(
        db,
        i!.challenge_id,
        i!.scope,
        u,
        true,
        "resources",
      );
      if (i!.owner_key !== (await ownerFor(db, i!.scope, u)))
        fail(403, "无权下载此附件");
    }
    return reply
      .header("Content-Length", i!.artifact_size)
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", 'attachment; filename="challenge.zip"')
      .send(createReadStream(join(storage(), iid)));
  });
}
