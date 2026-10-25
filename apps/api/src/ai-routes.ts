import type { FastifyInstance, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import { audit, type DB, type Row } from "./db.js";
import { requireAdmin } from "./auth.js";
import { digest, equal, fail, rate, token } from "./security.js";
import { seal, unseal } from "./settings.js";
import {
  translateRequest,
  translateResponse,
  parseSSE,
  StreamTranslator,
  sse,
  type Protocol,
} from "./ai-protocol.js";
declare module "fastify" {
  interface FastifyContextConfig {
    aiProxy?: boolean;
  }
}
const routeInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    protocol: z.enum(["openai", "anthropic"]),
    base_url: z
      .url()
      .max(500)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, "请填写不含凭据和参数的 HTTP/HTTPS 基础地址"),
    api_key: z.string().trim().max(2048).optional(),
    models: z
      .array(
        z
          .object({
            alias: z
              .string()
              .trim()
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/),
            upstream: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .refine(
        (v) => new Set(v.map((m) => m.alias)).size === v.length,
        "模型别名不能重复",
      ),
    rpm: z.number().int().min(1).max(10000),
    daily_limit: z.number().int().min(1).max(1000000),
    concurrency: z.number().int().min(1).max(100),
    max_tokens: z.number().int().min(1).max(131072),
    timeout_seconds: z.number().int().min(5).max(300),
  })
  .strict();
const fields =
  "id,name,enabled,protocol,base_url,models,rpm,daily_limit,concurrency,max_tokens,timeout_seconds,access_prefix,created_at,updated_at";
const key = () => `nebu_ai_${token()}`;
const upstreamHeaders = (r: Row) => ({
  "content-type": "application/json",
  ...(r.protocol === "openai"
    ? { authorization: `Bearer ${unseal(r.key_cipher)}` }
    : { "x-api-key": unseal(r.key_cipher), "anthropic-version": "2023-06-01" }),
});
const endpoint = (r: Row, tail: string) =>
  r.base_url.replace(/\/+$/, "") + "/" + tail;
async function limitedJSON(response: Response) {
  if (!response.body) throw Error("Empty upstream response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16 * 1024 * 1024) throw Error("Response too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function aiRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/admin/ai-routes", async (req) => {
    requireAdmin(req);
    const { page } = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .parse(req.query);
    const [items, [count]] = await Promise.all([
      db.query(
        `SELECT ${fields},(SELECT count(*)::int FROM ai_calls c WHERE c.route_id=r.id AND c.created_at>=now()-interval '24 hours') calls,(SELECT count(*)::int FROM ai_calls c WHERE c.route_id=r.id AND c.status>=400 AND c.created_at>=now()-interval '24 hours') failures FROM ai_routes r ORDER BY created_at DESC,id LIMIT 10 OFFSET $1`,
        [(page - 1) * 10],
      ),
      db.query("SELECT count(*)::int total FROM ai_routes"),
    ]);
    return { items, total: count!.total };
  });
  app.get("/api/admin/ai-routes/:id", async (req) => {
    requireAdmin(req);
    const id = z.uuid().parse((req.params as any).id);
    const [row] = await db.query(
      `SELECT ${fields},key_cipher<>'' key_set FROM ai_routes WHERE id=$1`,
      [id],
    );
    if (!row) fail(404, "转发路由不存在");
    return row;
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/ai-routes${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const user = requireAdmin(req),
          data = routeInput.parse(req.body),
          id =
            method === "PUT"
              ? z.uuid().parse((req.params as any).id)
              : crypto.randomUUID();
        const accessKey = method === "POST" ? key() : undefined;
        await db.transaction(async (tx) => {
          const [old] = await tx.query(
            "SELECT key_cipher FROM ai_routes WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (method === "PUT" && !old) fail(404, "转发路由不存在");
          if (!data.api_key && !old?.key_cipher)
            fail(400, "请填写上游 API 密钥");
          const keyCipher = data.api_key ? seal(data.api_key) : old!.key_cipher;
          const values = [
            data.name,
            data.enabled,
            data.protocol,
            data.base_url.replace(/\/+$/, ""),
            keyCipher,
            JSON.stringify(data.models),
            data.rpm,
            data.daily_limit,
            data.concurrency,
            data.max_tokens,
            data.timeout_seconds,
            id,
          ];
          if (method === "POST")
            await tx.query(
              "INSERT INTO ai_routes(name,enabled,protocol,base_url,key_cipher,models,rpm,daily_limit,concurrency,max_tokens,timeout_seconds,id,access_hash,access_prefix) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
              [...values, digest(accessKey!), accessKey!.slice(0, 16)],
            );
          else
            await tx.query(
              "UPDATE ai_routes SET name=$1,enabled=$2,protocol=$3,base_url=$4,key_cipher=$5,models=$6,rpm=$7,daily_limit=$8,concurrency=$9,max_tokens=$10,timeout_seconds=$11,updated_at=now() WHERE id=$12",
              values,
            );
          await audit(
            tx,
            user.id,
            method === "POST" ? "ai.create" : "ai.update",
            id,
          );
        });
        return { id, ...(accessKey ? { access_key: accessKey } : {}) };
      },
    });
  app.patch("/api/admin/ai-routes/:id", async (req) => {
    const user = requireAdmin(req),
      id = z.uuid().parse((req.params as any).id),
      { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      const rows = await tx.query(
        "UPDATE ai_routes SET enabled=$2,updated_at=now() WHERE id=$1 RETURNING id",
        [id, enabled],
      );
      if (!rows.length) fail(404, "转发路由不存在");
      await audit(tx, user.id, "ai.toggle", id);
    });
    return { ok: true };
  });
  app.post("/api/admin/ai-routes/:id/rotate", async (req) => {
    const user = requireAdmin(req),
      id = z.uuid().parse((req.params as any).id),
      accessKey = key();
    await db.transaction(async (tx) => {
      const rows = await tx.query(
        "UPDATE ai_routes SET access_hash=$2,access_prefix=$3,updated_at=now() WHERE id=$1 RETURNING id",
        [id, digest(accessKey), accessKey.slice(0, 16)],
      );
      if (!rows.length) fail(404, "转发路由不存在");
      await audit(tx, user.id, "ai.rotate", id);
    });
    return { access_key: accessKey };
  });
  app.delete("/api/admin/ai-routes/:id", async (req) => {
    const user = requireAdmin(req),
      id = z.uuid().parse((req.params as any).id);
    await db.transaction(async (tx) => {
      const rows = await tx.query(
        "DELETE FROM ai_routes WHERE id=$1 RETURNING id",
        [id],
      );
      if (!rows.length) fail(404, "转发路由不存在");
      await audit(tx, user.id, "ai.delete", id);
    });
    return { ok: true };
  });
  app.post("/api/admin/ai-routes/:id/test", async (req) => {
    const user = requireAdmin(req),
      id = z.uuid().parse((req.params as any).id);
    await rate(db, `ai-test:${user.id}`, 5, 60);
    const [row] = await db.query("SELECT * FROM ai_routes WHERE id=$1", [id]);
    if (!row) fail(404, "转发路由不存在");
    try {
      const res = await fetch(endpoint(row!, "models"), {
        headers: upstreamHeaders(row!),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      await res.body?.cancel();
      if (!res.ok) fail(400, `上游返回 HTTP ${res.status}`);
    } catch (e) {
      if ((e as any).statusCode) throw e;
      fail(400, "无法连接上游，请检查地址与凭据");
    }
    return { ok: true };
  });
  async function authenticate(req: FastifyRequest) {
    const id = z.uuid().parse((req.params as any).route),
      supplied =
        req.headers.authorization?.replace(/^Bearer /i, "") ??
        req.headers["x-api-key"];
    if (
      typeof supplied !== "string" ||
      !supplied.startsWith("nebu_ai_") ||
      supplied.length > 128
    )
      return fail(401, "Invalid API key");
    const [row] = await db.query(
      "SELECT * FROM ai_routes WHERE id=$1 AND enabled",
      [id],
    );
    if (!row || !equal(row.access_hash, digest(supplied)))
      fail(401, "Invalid API key");
    return row!;
  }
  const errorHandler = (err: any, _req: FastifyRequest, reply: any) => {
    const status = err instanceof z.ZodError ? 400 : (err.statusCode ?? 502);
    return reply.code(status).send({
      type: "error",
      error: {
        type:
          status === 401
            ? "authentication_error"
            : status === 429
              ? "rate_limit_error"
              : "invalid_request_error",
        message:
          status >= 500
            ? "Upstream service unavailable"
            : err instanceof z.ZodError
              ? "Invalid request"
              : err.message,
      },
    });
  };
  app.get(
    "/api/ai/:route/v1/models",
    { config: { aiProxy: true }, errorHandler },
    async (req) => {
      const row = await authenticate(req);
      return {
        object: "list",
        has_more: false,
        first_id: row.models[0]?.alias,
        last_id: row.models.at(-1)?.alias,
        data: row.models.map((m: any) => ({
          id: m.alias,
          object: "model",
          type: "model",
          display_name: m.alias,
          created_at: new Date(row.created_at).toISOString(),
          created: Math.floor(new Date(row.created_at).getTime() / 1000),
          owned_by: "nebuctf",
        })),
      };
    },
  );
  for (const format of ["openai", "anthropic"] as const)
    app.post(
      `/api/ai/:route/v1/${format === "openai" ? "chat/completions" : "messages"}`,
      { config: { aiProxy: true }, bodyLimit: 1024 * 1024, errorHandler },
      async (req, reply) => {
        const route = await authenticate(req);
        const body = z
          .object({
            model: z.string().max(100),
            messages: z
              .array(z.record(z.string(), z.unknown()))
              .min(1)
              .max(1000),
            stream: z.boolean().optional(),
            max_tokens: z.number().int().min(1).optional(),
            max_completion_tokens: z.number().int().min(1).optional(),
            n: z.literal(1).optional(),
          })
          .passthrough()
          .parse(req.body);
        const model = route.models.find((m: any) => m.alias === body.model);
        if (!model) fail(400, "Model is not available on this route");
        const max =
          body.max_completion_tokens ??
          body.max_tokens ??
          Math.min(4096, route.max_tokens);
        if (max > route.max_tokens)
          fail(400, "Requested output exceeds route limit");
        let outbound = translateRequest(
          { ...body, max_tokens: max },
          format,
          route.protocol,
        );
        outbound = { ...outbound, model: model.upstream };
        if (route.protocol === "openai" && outbound.max_completion_tokens)
          delete outbound.max_tokens;
        if (route.protocol === "openai" && body.stream)
          outbound.stream_options = { include_usage: true };
        if (
          route.protocol === "openai" &&
          format === "anthropic" &&
          outbound.tools
        )
          outbound.parallel_tool_calls = false;
        await rate(db, `ai-minute:${route.id}`, route.rpm, 60);
        await rate(
          db,
          `ai-day:${route.id}:${new Date().toISOString().slice(0, 10)}`,
          route.daily_limit,
          86400,
        );
        const callId = crypto.randomUUID(),
          started = Date.now(),
          controller = new AbortController();
        await db.transaction(async (tx) => {
          const [fresh] = await tx.query(
            "SELECT * FROM ai_routes WHERE id=$1 FOR UPDATE",
            [route.id],
          );
          if (
            !fresh?.enabled ||
            fresh.access_hash !== route.access_hash ||
            new Date(fresh.updated_at).getTime() !==
              new Date(route.updated_at).getTime()
          )
            fail(409, "Route changed; retry request");
          const [active] = await tx.query(
            "SELECT count(*)::int n FROM ai_calls WHERE route_id=$1 AND status=0 AND expires_at>now()",
            [route.id],
          );
          if (active!.n >= route.concurrency)
            fail(429, "Too many concurrent requests");
          await tx.query(
            "INSERT INTO ai_calls(id,route_id,model,protocol,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')",
            [callId, route.id, body.model, format, route.timeout_seconds + 5],
          );
        });
        const timer = setTimeout(
          () => controller.abort(),
          route.timeout_seconds * 1000,
        );
        timer.unref();
        const abort = () => {
          if (!reply.raw.writableFinished) controller.abort();
        };
        reply.raw.on("close", abort);
        let finished = false;
        const finish = async (status: number, input = 0, output = 0) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reply.raw.off("close", abort);
          await db.query(
            "UPDATE ai_calls SET status=$2,input_tokens=$3,output_tokens=$4,elapsed_ms=$5 WHERE id=$1",
            [
              callId,
              status,
              Math.trunc(Math.max(0, Math.min(2147483647, Number(input) || 0))),
              Math.trunc(
                Math.max(0, Math.min(2147483647, Number(output) || 0)),
              ),
              Date.now() - started,
            ],
          );
        };
        try {
          const response = await fetch(
            endpoint(
              route,
              route.protocol === "openai" ? "chat/completions" : "messages",
            ),
            {
              method: "POST",
              headers: upstreamHeaders(route),
              body: JSON.stringify(outbound),
              redirect: "error",
              signal: controller.signal,
            },
          );
          if (!response.ok) {
            await response.body?.cancel();
            await finish(response.status);
            fail(
              response.status === 429 ? 429 : 502,
              "Upstream service unavailable",
            );
          }
          if (body.stream) {
            if (
              !response.body ||
              !response.headers
                .get("content-type")
                ?.includes("text/event-stream")
            )
              throw Error("Invalid upstream stream");
            const translator = new StreamTranslator(
              route.protocol,
              format,
              body.model,
            );
            const stream = async function* () {
              let status = 200;
              try {
                for await (const frame of parseSSE(response.body!))
                  for (const line of translator.feed(frame)) yield line;
                if (!translator.ended) throw Error("Truncated upstream stream");
              } catch {
                status = controller.signal.aborted ? 499 : 502;
                yield sse(
                  {
                    type: "error",
                    error: {
                      type: "api_error",
                      message: "Upstream stream interrupted",
                    },
                  },
                  format === "anthropic" ? "error" : undefined,
                );
              } finally {
                controller.abort();
                await finish(
                  status === 200 && !translator.ended ? 499 : status,
                  translator.input,
                  translator.output,
                );
              }
            };
            return reply
              .header("Content-Type", "text/event-stream; charset=utf-8")
              .header("X-Accel-Buffering", "no")
              .send(Readable.from(stream()));
          }
          const value = await limitedJSON(response),
            result = translateResponse(
              value,
              route.protocol,
              format,
              body.model,
            );
          await finish(
            200,
            value.usage?.input_tokens ?? value.usage?.prompt_tokens,
            value.usage?.output_tokens ?? value.usage?.completion_tokens,
          );
          return result;
        } catch (e) {
          controller.abort();
          await finish(502);
          throw e;
        }
      },
    );
}
