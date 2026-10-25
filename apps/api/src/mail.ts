import nodemailer from "nodemailer";
import { randomInt, createHmac } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { type DB, lock } from "./db.js";
import { config } from "./config.js";
import { fail, rate, equal, digest } from "./security.js";
import { getSetting, unseal, type Settings } from "./settings.js";
import { consumeCaptcha } from "./captcha.js";

export function emailAllowed(email: string, rules: string[]) {
  const normalized = email.toLowerCase(),
    domain = normalized.split("@")[1]!;
  return (
    !rules.length ||
    rules.some((rule) =>
      rule.includes("@")
        ? rule === normalized
        : rule.startsWith("*.")
          ? domain.endsWith(rule.slice(1)) && domain !== rule.slice(2)
          : domain === rule,
    )
  );
}
export function mailTransport(settings: Settings["mail"]) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.username
      ? { user: settings.username, pass: unseal(settings.password_cipher) }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}
export async function sendMail(
  settings: Settings["mail"],
  to: string,
  subject: string,
  text: string,
) {
  const transport = mailTransport(settings);
  try {
    await transport.sendMail({
      from: { address: settings.from_address, name: settings.from_name },
      to,
      subject,
      text,
    });
  } catch {
    fail(502, "邮件发送失败，请稍后重试");
  } finally {
    transport.close();
  }
}
const proofHash = (id: string, email: string, code: string) =>
  createHmac("sha256", config.APP_SECRET)
    .update(JSON.stringify(["email-code", id, email, code]))
    .digest("hex");
export async function verifyRegistrationEmail(
  db: DB,
  email: string,
  value: unknown,
) {
  if (!value) return fail(400, "请先验证注册邮箱");
  const proof = z
    .object({
      id: z.uuid(),
      code: z.string().regex(/^\d{6}$/, "请输入 6 位验证码"),
    })
    .parse(value);
  // Commit failed attempts as well; a rollback must not restore the guessing budget.
  const valid = await db.transaction(async (tx) => {
    const [row] = await tx.query(
      "SELECT * FROM email_verifications WHERE id=$1 FOR UPDATE",
      [proof.id],
    );
    if (
      !row ||
      row.email !== email.toLowerCase() ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      row.attempts >= 5
    )
      return false;
    const ok = equal(row.code_hash, proofHash(proof.id, row.email, proof.code));
    await tx.query(
      "UPDATE email_verifications SET attempts=attempts+1 WHERE id=$1",
      [proof.id],
    );
    return ok;
  });
  if (!valid) fail(400, "验证码错误或已过期，请重新验证");
  return proof.id;
}
export function registrationMailRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/auth/email-code", async (req) => {
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .parse(req.body);
    await consumeCaptcha(db, req, "register");
    const settings = await getSetting(db, "mail");
    if (!settings.require_verification)
      fail(409, "邮箱验证设置已更新，请重新注册");
    if (!emailAllowed(email, settings.allowed_emails))
      fail(400, "此邮箱不在允许注册的范围内");
    await rate(db, `mail-ip:${req.ip}`, 10, 3600);
    await rate(db, `mail-address:${digest(email)}`, 1, 60);
    await rate(db, "registration-mail-day", 1000, 86400);
    const id = crypto.randomUUID(),
      code = String(randomInt(0, 1000000)).padStart(6, "0");
    await db.transaction(async (tx) => {
      await lock(tx, 760010);
      await tx.query(
        "DELETE FROM email_verifications WHERE email=$1 OR expires_at<now()",
        [email],
      );
      await tx.query(
        "INSERT INTO email_verifications(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
        [id, email, proofHash(id, email, code)],
      );
    });
    try {
      const site = await getSetting(db, "site");
      await sendMail(
        settings,
        email,
        `${site.name} 注册验证码`,
        `验证码：${code}\n\n10 分钟内有效。如果这不是你的操作，请忽略此邮件。`,
      );
    } catch (e) {
      await db.query("DELETE FROM email_verifications WHERE id=$1", [id]);
      throw e;
    }
    return { id, expires_in: 600, resend_after: 60 };
  });
}
