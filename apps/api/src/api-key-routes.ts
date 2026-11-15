import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "./auth.js";
import {
  API_KEY_LIMIT,
  allowedApiKeyScopes,
  availableApiKeyIdentities,
  apiKeyIdentityIdInput,
  apiKeyPolicyInput,
  apiKeyScopes,
  apiKeyScopesInput,
  getApiKeyPolicy,
  type ApiKeyPolicy,
} from "./api-keys.js";
import { audit, lock, type DB, type Row } from "./db.js";
import { digest, fail, rate } from "./security.js";
import { saveSetting } from "./settings.js";

const pageSize = 24;
// Explicit projection is shared by every inventory/creation/edit response: never hashes.
const itemColumns =
  "id,name,prefix,scopes,identity_id,created_at,updated_at,expires_at,last_used_at,revoked_at";
const keyInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (value) => !/[\x00-\x1f\x7f]/.test(value),
        "名称不能包含控制字符",
      ),
    scopes: apiKeyScopesInput.min(1).optional(),
    identity_id: apiKeyIdentityIdInput.optional(),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) =>
      (input.scopes !== undefined) !== (input.identity_id !== undefined),
    "必须且只能选择 API 身份或自定义权限其中一项",
  );

function requireSession(req: FastifyRequest) {
  if (req.apiKeyId) fail(403, "API KEY 管理仅支持账户会话，请使用网页登录");
  return requireUser(req);
}
function serializeItem(row: Row, policy: ApiKeyPolicy) {
  return {
    id: row.id as string,
    name: row.name as string,
    prefix: row.prefix as string,
    scopes: row.scopes as string[],
    identity_id: row.identity_id as string | null,
    identity_name:
      policy.identities.find((entry) => entry.id === row.identity_id)?.name ??
      null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    last_used_at: row.last_used_at
      ? new Date(row.last_used_at).toISOString()
      : null,
    revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}
function validateGrant(input: z.infer<typeof keyInput>, policy: ApiKeyPolicy) {
  if (!policy.enabled) fail(403, "管理员尚未启用 API KEY");
  const identity =
    input.identity_id === undefined
      ? undefined
      : availableApiKeyIdentities(policy).find(
          (entry) => entry.id === input.identity_id,
        );
  if (input.identity_id !== undefined && !identity)
    fail(403, "所选 API 身份尚未开放");
  if (input.scopes?.some((scope) => !policy.allowed_scopes.includes(scope)))
    fail(403, "所选 API 权限未获管理员开放");
  const expires = Date.parse(input.expires_at),
    now = Date.now();
  if (expires <= now || expires > now + policy.max_lifetime_days * 86_400_000)
    fail(400, `有效期必须晚于当前时间且不超过 ${policy.max_lifetime_days} 天`);
  return {
    identity_id: input.identity_id ?? null,
    scopes: identity ? identity.scopes : input.scopes!,
  };
}

export function apiKeyRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/api-keys/catalog", async () => {
    const policy = await getApiKeyPolicy(db);
    return {
      enabled: policy.enabled,
      scopes: allowedApiKeyScopes(policy),
      identities: availableApiKeyIdentities(policy),
    };
  });

  app.get("/api/admin/api-keys/policy", async (req) => {
    requireSession(req);
    requireAdmin(req);
    return {
      policy: await getApiKeyPolicy(db),
      scopes: apiKeyScopes,
    };
  });
  app.put("/api/admin/api-keys/policy", async (req) => {
    requireSession(req);
    const user = requireAdmin(req),
      input = apiKeyPolicyInput.parse(req.body);
    await db.transaction(async (tx) => {
      await lock(tx);
      const previous = await getApiKeyPolicy(tx);
      const nextIds = new Set(input.identities.map((identity) => identity.id));
      const removedIds = previous.identities
        .filter((identity) => !nextIds.has(identity.id))
        .map((identity) => identity.id);
      if (removedIds.length)
        await tx.query(
          "UPDATE api_keys SET revoked_at=now(),updated_at=now() WHERE identity_id=ANY($1::text[]) AND revoked_at IS NULL",
          [removedIds],
        );
      await saveSetting(tx, "api_keys", input);
      await audit(tx, user.id, "api_key.policy.update", "api_keys");
    });
    return { ok: true };
  });

  app.get("/api/account/api-keys", async (req) => {
    const user = requireSession(req);
    const { page } = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    return db.transaction(async (tx) => {
      const policy = await getApiKeyPolicy(tx);
      const [count] = await tx.query<{ total: number }>(
        "SELECT count(*)::int total FROM api_keys WHERE user_id=$1",
        [user.id],
      );
      const items = await tx.query(
        `SELECT ${itemColumns} FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
        [user.id, pageSize, (page - 1) * pageSize],
      );
      return {
        items: items.map((item) => serializeItem(item, policy)),
        total: count!.total,
        page,
        policy: {
          ...policy,
          identities: availableApiKeyIdentities(policy).map((identity) => ({
            ...identity,
            enabled: true,
          })),
        },
        identities: availableApiKeyIdentities(policy),
        scopes: allowedApiKeyScopes(policy),
        limit: API_KEY_LIMIT,
      };
    });
  });

  app.post("/api/account/api-keys", async (req, reply) => {
    const user = requireSession(req),
      input = keyInput.parse(req.body);
    await rate(db, `api-key-create:${user.id}`, 10, 60);
    const result = await db.transaction(async (tx) => {
      // Shared with policy changes and all credential mutations: count+insert is atomic.
      await lock(tx);
      const policy = await getApiKeyPolicy(tx);
      const grant = validateGrant(input, policy);
      const [count] = await tx.query<{ total: number }>(
        "SELECT count(*)::int total FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",
        [user.id],
      );
      if (count!.total >= API_KEY_LIMIT)
        fail(409, `最多同时保留 ${API_KEY_LIMIT} 个有效 API KEY`);
      const key = `nebu_${randomBytes(32).toString("base64url")}`;
      const [item] = await tx.query(
        `INSERT INTO api_keys(id,user_id,name,token_hash,prefix,scopes,expires_at,identity_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${itemColumns}`,
        [
          randomUUID(),
          user.id,
          input.name,
          digest(key),
          key.slice(0, 12),
          JSON.stringify(grant.scopes),
          input.expires_at,
          grant.identity_id,
        ],
      );
      await audit(tx, user.id, "api_key.create", item!.id);
      return { item: serializeItem(item!, policy), key };
    });
    reply.header("Cache-Control", "no-store");
    return result;
  });

  app.put("/api/account/api-keys/:id", async (req) => {
    const user = requireSession(req),
      keyId = z.object({ id: z.uuid() }).parse(req.params).id;
    const input = keyInput.parse(req.body);
    return db.transaction(async (tx) => {
      await lock(tx);
      const [existing] = await tx.query(
        "SELECT id,revoked_at,expires_at,expires_at>now() live FROM api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [keyId, user.id],
      );
      if (!existing) fail(404, "API KEY 不存在");
      if (
        existing!.revoked_at ||
        !existing!.live ||
        new Date(existing!.expires_at).getTime() <= Date.now()
      )
        fail(409, "已撤销或过期的 API KEY 不能修改");
      const policy = await getApiKeyPolicy(tx);
      const grant = validateGrant(input, policy);
      const [item] = await tx.query(
        `UPDATE api_keys SET name=$3,scopes=$4,expires_at=$5,identity_id=$6,updated_at=now()
         WHERE id=$1 AND user_id=$2 RETURNING ${itemColumns}`,
        [
          keyId,
          user.id,
          input.name,
          JSON.stringify(grant.scopes),
          input.expires_at,
          grant.identity_id,
        ],
      );
      await audit(tx, user.id, "api_key.update", keyId);
      return { item: serializeItem(item!, policy) };
    });
  });

  app.delete("/api/account/api-keys/:id", async (req) => {
    const user = requireSession(req),
      keyId = z.object({ id: z.uuid() }).parse(req.params).id;
    await db.transaction(async (tx) => {
      await lock(tx);
      const [existing] = await tx.query(
        "SELECT id,revoked_at FROM api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [keyId, user.id],
      );
      if (!existing) fail(404, "API KEY 不存在");
      if (existing!.revoked_at) return;
      await tx.query(
        "UPDATE api_keys SET revoked_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2",
        [keyId, user.id],
      );
      await audit(tx, user.id, "api_key.revoke", keyId);
    });
    return { ok: true };
  });
}
