import { teamLogoRoutes } from "./team-logos.js";
import { roleRoutes } from "./roles.js";
import { trafficRoutes } from "./traffic.js";
import { avatarRoutes } from "./avatars.js";
import { notificationRoutes } from "./notifications.js";
import { notificationRealtimeRoutes } from "./notification-realtime.js";
import { contentTransferRoutes } from "./content-transfer-routes.js";
import { terminalRoutes } from "./terminal.js";
import { contestSpectatorRoutes } from "./contest-spectator.js";
import { writeupRoutes } from "./writeups.js";
import { captchaRoutes } from "./captcha.js";
import { contestMonitorRoutes, recordIssuedFlags } from "./contest-monitor.js";
import websocket from "@fastify/websocket";
import { contestRealtimeRoutes } from "./contest-realtime.js";
import { awdRoutes } from "./awd.js";
import { judgeRoutes } from "./judge.js";
import { objectiveRoutes } from "./objectives.js";
import { problemsetRoutes } from "./problemsets.js";
import { contestPosterRoutes } from "./contest-posters.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { learningRoutes } from "./learning.js";
import { authRoutes } from "./auth.js";
import { profileRoutes } from "./profiles.js";
import { teamRoutes } from "./teams.js";
import { challengeRoutes } from "./challenges.js";
import { contestRoutes } from "./contests.js";
import { resourceRoutes } from "./resources.js";
import { adminRoutes } from "./admin.js";
import { config } from "./config.js";
import { imageRoutes } from "./images.js";
import type { DB } from "./db.js";
import { systemAdminRoutes } from "./system-admin.js";
import { registrationMailRoutes } from "./mail.js";
import { aiRoutes } from "./ai-routes.js";
export async function buildApp(db: DB, logging = false) {
  const app = Fastify({
    logger: logging
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers.x-api-key",
            "req.body",
          ],
          serializers: {
            req: (r) => ({
              method: r.method,
              url: r.url?.split("?")[0],
              id: r.id,
            }),
          },
        }
      : false,
    bodyLimit: 65536,
    requestTimeout: 30000,
    trustProxy: config.TRUST_PROXY ? config.TRUST_PROXY.split(",") : false,
  });
  await app.register(websocket, {
    options: { maxPayload: 1024, perMessageDeflate: false },
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.addHook("onRequest", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "same-origin")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: error.issues[0]?.message ?? "输入无效" });
    const err = error as Error & {
      code?: string;
      statusCode?: number;
      action?: { label: string; href: string };
      retryAfter?: number;
    };
    if (err.code === "23505")
      return reply.code(409).send({ error: "记录已存在，请检查名称或账号" });
    if (err.code === "23503")
      return reply.code(400).send({ error: "引用的记录不存在" });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    if (err.retryAfter) reply.header("Retry-After", err.retryAfter);
    return reply.code(status).send({
      error: status >= 500 ? "服务暂时不可用" : err.message,
      ...(status < 500 && err.action ? { action: err.action } : {}),
      ...(err.retryAfter ? { retry_after: err.retryAfter } : {}),
    });
  });
  await authRoutes(app, db);
  roleRoutes(app, db);
  trafficRoutes(app, db);
  notificationRoutes(app, db);
  notificationRealtimeRoutes(app, db);
  profileRoutes(app, db);
  avatarRoutes(app, db);
  teamLogoRoutes(app, db);
  systemAdminRoutes(app, db);
  registrationMailRoutes(app, db);
  aiRoutes(app, db);
  captchaRoutes(app, db);
  teamRoutes(app, db);
  challengeRoutes(app, db);
  objectiveRoutes(app, db);
  judgeRoutes(app, db);
  awdRoutes(app, db);
  contestRoutes(app, db);
  contestRealtimeRoutes(app, db);
  contestSpectatorRoutes(app, db);
  contestMonitorRoutes(app, db);
  // Upgrade existing successfully issued resources without persisting their secrets.
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const batch = await db.query(
      "SELECT * FROM instances WHERE id>$1 AND owner_key LIKE 't:%' AND scope<>'practice' AND status IN ('running','ready') AND (container_id IS NOT NULL OR artifact_size IS NOT NULL) ORDER BY id LIMIT 100",
      [cursor],
    );
    for (const instance of batch) await recordIssuedFlags(db, instance);
    if (batch.length < 100) break;
    cursor = batch[batch.length - 1]!.id;
  }
  resourceRoutes(app, db);
  terminalRoutes(app, db);
  imageRoutes(app, db);
  adminRoutes(app, db);
  contentTransferRoutes(app, db);
  learningRoutes(app, db);
  problemsetRoutes(app, db);
  contestPosterRoutes(app, db);
  writeupRoutes(app, db);
  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return { status: "ok" };
  });
  return app;
}
