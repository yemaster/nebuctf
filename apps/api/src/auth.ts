import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { config } from "./config.js";
import { credentials, register, password } from "./schemas.js";
import {
  digest,
  fail,
  hashPassword,
  rate,
  token,
  verifyPassword,
} from "./security.js";
import type { User } from "./context.js";
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}
export const sessionCookie =
  config.COOKIE_SECURE === "true" ? "__Host-nebu_session" : "nebu_session";
export function requireUser(req: FastifyRequest): User {
  if (!req.user) fail(401, "请先登录");
  return req.user!;
}
export function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (user.role !== "admin") fail(403, "需要管理员权限");
  return user;
}
export async function authRoutes(app: FastifyInstance, db: DB) {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !== config.APP_ORIGIN ||
        req.headers["x-csrf-protection"] !== "1"
      )
        fail(403, "请求来源验证失败");
    }
    if (req.cookies[sessionCookie]) {
      const [user] = await db.query<User>(
        "SELECT u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled",
        [digest(req.cookies[sessionCookie]!)],
      );
      if (user) req.user = user;
    }
  });
  app.get("/api/me", async (req) => ({ user: req.user }));
  app.post("/api/auth/register", async (req, reply) => {
    const data = register.parse(req.body);
    await rate(db, `register:${req.ip}`, 5, 3600);
    const hash = await hashPassword(data.password);
    const uid = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,$4)",
      [uid, data.username, data.email, hash],
    );
    const t = token();
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",
      [digest(t), uid],
    );
    reply.setCookie(sessionCookie, t, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 604800,
    });
    return {
      user: {
        id: uid,
        username: data.username,
        email: data.email,
        role: "user",
      },
    };
  });
  // A valid Argon2 hash is used for absent accounts to reduce account timing disclosure.
  const dummy = await hashPassword(token());
  app.post("/api/auth/login", async (req, reply) => {
    const data = credentials.parse(req.body);
    await rate(db, `login-ip:${req.ip}`, 30, 900);
    await rate(db, `login-account:${digest(data.email)}`, 10, 900);
    const [user] = await db.query("SELECT * FROM users WHERE lower(email)=$1", [
      data.email,
    ]);
    const valid = await verifyPassword(
      user?.password_hash ?? dummy,
      data.password,
    );
    if (!valid || !user || user.disabled) fail(401, "邮箱或密码错误");
    const t = token();
    await db.transaction(async (tx) => {
      const [fresh] = await tx.query(
        "SELECT password_hash,disabled FROM users WHERE id=$1 FOR UPDATE",
        [user!.id],
      );
      if (
        !fresh ||
        fresh.disabled ||
        fresh.password_hash !== user!.password_hash
      )
        fail(401, "邮箱或密码错误");
      await tx.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",
        [digest(t), user!.id],
      );
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash IN (SELECT token_hash FROM sessions WHERE user_id=$1 ORDER BY expires_at DESC OFFSET 10)",
        [user!.id],
      );
    });
    reply.setCookie(sessionCookie, t, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 604800,
    });
    return {
      user: {
        id: user!.id,
        username: user!.username,
        email: user!.email,
        role: user!.role,
      },
    };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies[sessionCookie])
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies[sessionCookie]!),
      ]);
    reply.clearCookie(sessionCookie, { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/password", async (req, reply) => {
    const u = requireUser(req);
    await rate(db, `password:${u.id}`, 5, 900);
    const data = z
      .object({ current: z.string().max(128), password })
      .parse(req.body);
    const [current] = await db.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [u.id],
    );
    if (!(await verifyPassword(current!.password_hash, data.current)))
      fail(400, "当前密码错误");
    const hash = await hashPassword(data.password);
    await db.transaction(async (tx) => {
      await lock(tx);
      const [fresh] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [u.id],
      );
      if (fresh!.password_hash !== current!.password_hash)
        fail(409, "密码已变更，请重新登录");
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        u.id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await audit(tx, u.id, "user.password", u.id);
    });
    reply.clearCookie(sessionCookie, { path: "/" });
    return { ok: true };
  });
}
