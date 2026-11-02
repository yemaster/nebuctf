import { getSetting } from "./settings.js";
import { submissionUsage, requireSubmissionSlot } from "./submission-policy.js";
import { notifyContest } from "./activity-events.js";
import { requirePermission } from "./group-permissions.js";
import { flagEnvironmentSpec } from "./flag-environment.js";
import { resourceUsage } from "./resource-usage.js";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { requireUser, requireAdmin } from "./auth.js";
import { challengeAccess, ownerFor } from "./context.js";
import { config } from "./config.js";
import { audit, lock, type DB } from "./db.js";
import { id, scope as scopeSchema } from "./schemas.js";
import { fail, rate } from "./security.js";
import { readPatch } from "./patch-archive.js";
import { resourceProfiles } from "./challenge-model.js";
import { resourceCooldown } from "./resources.js";
export const patchStorage = () => join(config.DATA_DIR, "patches");
export function judgeRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/challenges/:id/patches", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.query as any).scope);
    const c = await challengeAccess(db, cid, scope, user, true, "submit"),
      owner = await ownerFor(db, scope, user);
    requirePermission(c.permissions, "resources");
    if (!["awdp", "awd"].includes(c.challenge_type) || !c.patch_config)
      fail(400, "此题不接受补丁");
    await rate(db, `patch-upload:${user.id}`, 3, 60);
    const file = await req.file();
    if (!file) return fail(400, "请选择 tar 或 tar.gz 补丁包");
    const data = await file.toBuffer();
    if (file.file.truncated) fail(413, "补丁超过 20 MiB");
    try {
      readPatch(data);
    } catch (e) {
      fail(400, (e as Error).message);
    }
    const jid = crypto.randomUUID();
    await mkdir(patchStorage(), { recursive: true });
    await writeFile(join(patchStorage(), jid), data, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      return await db.transaction(async (tx) => {
        await lock(tx);
        const current = await challengeAccess(
          tx,
          cid,
          scope,
          user,
          true,
          "submit",
        );
        requirePermission(current.permissions, "resources");
        if ((await ownerFor(tx, scope, user)) !== owner)
          fail(409, "战队已变更，请重新提交");
        await requireSubmissionSlot(tx, current, scope, owner, "defense");
        await resourceCooldown(tx, owner, scope, cid, "patch");
        const [active] = await tx.query(
          "SELECT challenge_id,scope FROM judge_jobs WHERE owner_key=$1 AND status IN ('queued','building','checking')",
          [owner],
        );
        if (active)
          fail(409, "已有补丁正在校验，请等待结果", {
            label: "查看校验进度",
            href:
              active.scope === "practice"
                ? `/challenges?challenge=${active.challenge_id}`
                : `/contests/${active.scope}/challenges?challenge=${active.challenge_id}`,
          });
        const profile = resourceProfiles(current).container!;
        const policy = await getSetting(tx, "containers");
        const usage = await resourceUsage(tx, owner),
          pc = current.patch_config;
        if (
          (policy.max_instances !== null &&
            usage.n + 2 > policy.max_instances) ||
          usage.cpu + Math.max(500, profile.cpu + pc.cpu) > config.MAX_CPU ||
          usage.memory + Math.max(256, profile.memory + pc.memory) >
            config.MAX_MEMORY
        )
          fail(409, "校验资源已满，请稍后重试");
        const end = current.phase?.deadline_at
          ? Date.parse(current.phase.deadline_at)
          : Date.now() + 300000;
        const deadline = new Date(Math.min(end, Date.now() + 300000));
        await tx.query(
          "INSERT INTO judge_jobs(id,challenge_id,scope,owner_key,requested_by,status,patch_id,patch_name,spec,deadline_at) VALUES($1,$2,$3,$4,$5,'queued',$1,$6,$7,$8)",
          [
            jid,
            cid,
            scope,
            owner,
            user.id,
            file.filename.slice(0, 180).replace(/[\x00-\x1f\x7f/\\]/g, "_"),
            JSON.stringify({
              container: profile,
              flag_environment: await flagEnvironmentSpec(
                tx,
                current,
                scope,
                owner,
              ),
              patch: current.patch_config,
              type: current.challenge_type,
              contest_scoring: current.contest_scoring,
              contest_practice: !!current.contest_practice,
              submitted_before: end,
            }),
            deadline,
          ],
        );
        await audit(tx, user.id, "patch.submit", jid);
        await notifyContest(tx, scope);
        return { id: jid, status: "queued" };
      });
    } catch (e) {
      await unlink(join(patchStorage(), jid));
      throw e;
    }
  });
  app.get("/api/challenges/:id/patches", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.query as any).scope);
    const c = await challengeAccess(db, cid, scope, user, false);
    const owner = await ownerFor(db, scope, user);
    const [cooldown] = await db.query(
      "SELECT expires_at FROM rate_limits WHERE key=$1",
      [`resource:${owner}:${scope}:${cid}:patch`],
    );
    return {
      next_operation_at: cooldown?.expires_at ?? null,
      usage: (await submissionUsage(db, c, scope, owner)).defense,
      items: await db.query(
        "SELECT id,status,patch_name,error,result - 'image' result,created_at,finished_at FROM judge_jobs WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 ORDER BY created_at DESC LIMIT 10",
        [cid, scope, owner],
      ),
    };
  });
  app.get("/api/admin/judges", async (req) => {
    requireAdmin(req);
    return {
      items: await db.query(
        "SELECT j.id,j.status,j.scope,j.owner_key,j.patch_name,j.error,j.result,j.created_at,j.finished_at,c.title FROM judge_jobs j JOIN challenges c ON c.id=j.challenge_id ORDER BY j.created_at DESC LIMIT 100",
      ),
    };
  });
}
