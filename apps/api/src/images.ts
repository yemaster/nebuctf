import { can } from "./access-control.js";
import { getSetting } from "./settings.js";
import { flagEnvironmentSpec } from "./flag-environment.js";
import { resourceUsage } from "./resource-usage.js";
import { resourceChallenge } from "./challenge-model.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "./auth.js";
import { audit, lock, type DB } from "./db.js";
import { id, page } from "./schemas.js";
import { config } from "./config.js";
import { fail, rate } from "./security.js";
import {
  activeStatuses,
  resourceCooldown,
  validateImage,
} from "./resources.js";
import { imageKey, imageReference } from "./image-reference.js";

export async function imageStatus(db: DB) {
  const [worker] = await db.query(
    "SELECT checked_at,error FROM docker_worker_status WHERE id=1",
  );
  return {
    ...worker,
    online:
      !!worker?.checked_at &&
      !worker.error &&
      Date.now() - new Date(worker.checked_at).getTime() < 60000,
  };
}
const imageSelect = `SELECT i.*,j.id job_id,j.status job_status,j.error job_error FROM docker_images i LEFT JOIN LATERAL (SELECT id,status,error FROM docker_image_pulls WHERE image=i.image ORDER BY created_at DESC LIMIT 1) j ON true`;
const testSpec = z.object({
  image: imageReference,
  protocol: z.enum(["http", "nc"]),
  access_mode: z.enum(["port", "domain"]),
  port: z.number().int().min(1024).max(65535),
  cpu: z.number().int().min(100).max(4000),
  memory: z.number().int().min(32).max(4096),
});
export function imageRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/admin/images", async (req) => {
    requireAdmin(req);
    const p = page
      .extend({
        state: z.enum(["all", "present", "missing", "pulling"]).default("all"),
      })
      .parse(req.query);
    const where =
      "WHERE (strpos(lower(i.image),lower($1::text))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.challenges) c WHERE strpos(lower(c->>'title'),lower($1::text))>0)) AND ($2='all' OR ($2='present' AND i.present) OR ($2='missing' AND NOT i.present) OR ($2='pulling' AND j.status IN ('queued','pulling')))";
    const [count] = await db.query(
      `SELECT count(*)::int total FROM (${imageSelect} ${where}) x`,
      [p.q.trim(), p.state],
    );
    return {
      items: await db.query(
        `${imageSelect} ${where} ORDER BY i.image LIMIT 24 OFFSET $3`,
        [p.q.trim(), p.state, (p.page - 1) * 24],
      ),
      total: count!.total,
      page: p.page,
      worker: await imageStatus(db),
    };
  });
  app.get("/api/admin/images/status", async (req) => {
    const user = requireAdmin(req);
    const { image } = z.object({ image: imageReference }).parse(req.query);
    validateImage(image);
    const key = imageKey(image),
      [row] = await db.query(`${imageSelect} WHERE i.image=$1`, [key]);
    return {
      ...(row ?? { image: key, present: false, challenges: [] }),
      ...(!can(user, "images.read") ? { challenges: [] } : {}),
      worker: await imageStatus(db),
    };
  });
  app.post("/api/admin/images/pull", async (req) => {
    const user = requireAdmin(req),
      { image } = z.object({ image: imageReference }).parse(req.body);
    validateImage(image);
    await rate(db, `image-pull:${user.id}`, 10, 60);
    return db.transaction(async (tx) => {
      await lock(tx);
      if (!(await imageStatus(tx)).online)
        fail(409, "Docker Worker 暂不可用，请稍后重试");
      const key = imageKey(image);
      const [existing] = await tx.query(
        "SELECT id,status FROM docker_image_pulls WHERE image=$1 AND status IN ('queued','pulling')",
        [key],
      );
      if (existing) return existing;
      const [count] = await tx.query(
        "SELECT count(*)::int n FROM docker_image_pulls WHERE status IN ('queued','pulling')",
      );
      if (count!.n >= 16) fail(409, "拉取队列已满，请稍后重试");
      await tx.query(
        "INSERT INTO docker_images(image) VALUES($1) ON CONFLICT DO NOTHING",
        [key],
      );
      const jid = crypto.randomUUID();
      await tx.query(
        "INSERT INTO docker_image_pulls(id,image,reference,requested_by,status) VALUES($1,$2,$3,$4,'queued')",
        [jid, key, image, user.id],
      );
      await audit(tx, user.id, "image.pull", key);
      return { id: jid, status: "queued" };
    });
  });
  app.get("/api/admin/images/pulls/:id", async (req) => {
    const user = requireAdmin(req);
    const [job] = await db.query(
      "SELECT id,image,reference,status,layers,logs,error,created_at,updated_at,finished_at FROM docker_image_pulls WHERE id=$1 AND ($2 OR requested_by=$3)",
      [id.parse((req.params as any).id), can(user, "images.read"), user.id],
    );
    if (!job) fail(404, "拉取任务不存在");
    return job;
  });
  app.get("/api/admin/challenges/:id/test-instance", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    if (!(await db.query("SELECT 1 FROM challenges WHERE id=$1", [cid])).length)
      fail(404, "题目不存在");
    const type = z
      .enum(["container", "attachment"])
      .optional()
      .parse((req.query as any).resource_type);
    const [instance] = await db.query(
      `SELECT id,status,kind,endpoint,coalesce(spec->>'protocol','http') protocol,error,created_at,expires_at,(spec->>'ttl')::int ttl,spec->>'image' image FROM instances WHERE challenge_id=$1 AND requested_by=$2 AND scope='test' AND ($3::text IS NULL OR resource_type=$3) ORDER BY created_at DESC LIMIT 1`,
      [cid, user.id, type ?? null],
    );
    const [cooldown] = await db.query(
      "SELECT expires_at FROM rate_limits WHERE key=$1 AND expires_at>now()",
      [
        `resource:u:${user.id}:test:${cid}${type === "attachment" ? ":attachment" : ""}`,
      ],
    );
    return {
      instance: instance ?? null,
      next_operation_at: cooldown?.expires_at ?? null,
    };
  });
  app.post("/api/admin/challenges/:id/test-instance", async (req) => {
    const user = requireAdmin(req),
      cid = id.parse((req.params as any).id);
    const overrides = testSpec.partial().parse(req.body ?? {});
    const type = z
      .enum(["container", "attachment"])
      .optional()
      .parse((req.body as any)?.resource_type);
    await rate(db, `instance:${user.id}`, 10, 60);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [challenge] = await tx.query(
        "SELECT * FROM challenges WHERE id=$1",
        [cid],
      );
      if (!challenge) fail(404, "题目不存在");
      const c = resourceChallenge(challenge!, type);
      if (!c) return fail(400, "请先保存此资源配置");
      const spec = testSpec.parse({ protocol: "http", ...c, ...overrides });
      if (spec.protocol === "nc" && spec.access_mode !== "port")
        fail(400, "nc 服务需要使用端口直连");
      validateImage(spec.image);
      const owner = `u:${user.id}`;
      const [existing] = await tx.query(
        "SELECT id,status FROM instances WHERE challenge_id=$1 AND scope='test' AND owner_key=$2 AND status=ANY($3::text[]) AND resource_type=$4",
        [cid, owner, activeStatuses, c.resource_type],
      );
      if (existing) return existing;
      if (!(await imageStatus(tx)).online)
        fail(409, "Docker Worker 暂不可用，请稍后重试");
      const [image] = await tx.query(
        "SELECT present FROM docker_images WHERE image=$1",
        [imageKey(spec.image)],
      );
      if (!image?.present) fail(409, "镜像尚未就绪，请先拉取镜像");
      const usage = await resourceUsage(tx, owner),
        policy = await getSetting(tx, "containers");
      if (
        (policy.max_instances !== null && usage!.n >= policy.max_instances) ||
        usage!.cpu + spec.cpu > config.MAX_CPU ||
        usage!.memory + spec.memory > config.MAX_MEMORY ||
        (policy.max_owner_instances !== null &&
          usage!.owned >= policy.max_owner_instances)
      )
        fail(409, "测试环境资源额度不足", {
          label: "管理资源",
          href: "/admin/resources",
        });
      await resourceCooldown(tx, owner, "test", cid, c.resource_type);
      const flagSpec = await flagEnvironmentSpec(tx, c);
      const iid = crypto.randomUUID();
      await tx.query(
        `INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at,resource_type) VALUES($1,$2,'test',$3,$4,$5,'queued',$6,now()+interval '5 minutes',now()+interval '15 minutes',$7)`,
        [
          iid,
          cid,
          owner,
          user.id,
          c!.kind,
          JSON.stringify({
            ...spec,
            ...flagSpec,
            ttl: 600,
          }),
          c.resource_type,
        ],
      );
      await audit(tx, user.id, "instance.test", iid);
      return { id: iid, status: "queued" };
    });
  });
}
