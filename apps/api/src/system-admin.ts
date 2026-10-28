import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, lock, type DB } from "./db.js";
import { requireAdmin } from "./auth.js";
import { fail, rate } from "./security.js";
import { config } from "./config.js";
import {
  getSetting,
  saveSetting,
  siteInput,
  containerPolicyInput,
  mailInput,
  seal,
} from "./settings.js";
import { mailTransport, sendMail } from "./mail.js";
import { resourceUsage } from "./resource-usage.js";

export function systemAdminRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/site", async () => {
    const [site, mail] = await Promise.all([
      getSetting(db, "site"),
      getSetting(db, "mail"),
    ]);
    return { ...site, email_verification: mail.require_verification };
  });
  app.get("/api/admin/settings/:section", async (req) => {
    requireAdmin(req);
    const section = z
      .enum(["site", "containers", "mail"])
      .parse((req.params as any).section);
    const settings = await getSetting(db, section);
    if (section === "mail") {
      const { password_cipher, ...rest } = settings as Awaited<
        ReturnType<typeof getSetting<"mail">>
      >;
      return { ...rest, password_set: !!password_cipher };
    }
    return settings;
  });
  app.put("/api/admin/settings/:section", async (req) => {
    const user = requireAdmin(req),
      section = z
        .enum(["site", "containers", "mail"])
        .parse((req.params as any).section);
    await db.transaction(async (tx) => {
      await lock(tx);
      let value: unknown;
      if (section === "site") value = siteInput.parse(req.body);
      else if (section === "containers")
        value = {
          ...(
            await tx.query(
              "SELECT value FROM system_settings WHERE key='containers'",
            )
          )[0]?.value,
          ...containerPolicyInput.parse(req.body),
        };
      else {
        const { password, clear_password, ...data } = mailInput.parse(req.body),
          previous = await getSetting(tx, "mail");
        const password_cipher = password
          ? seal(password)
          : clear_password
            ? ""
            : previous.password_cipher;
        if (
          data.require_verification &&
          (!data.host ||
            !data.from_address ||
            (data.username && !password_cipher))
        )
          fail(400, "请先填写完整的发件服务器配置");
        value = {
          ...data,
          allowed_emails: [...new Set(data.allowed_emails)],
          password_cipher,
        };
      }
      await saveSetting(tx, section, value);
      await audit(tx, user.id, "settings.update", section);
    });
    return { ok: true };
  });
  app.post("/api/admin/settings/mail/test", async (req) => {
    const user = requireAdmin(req);
    const { recipient } = z
      .object({ recipient: z.email().optional() })
      .strict()
      .parse(req.body);
    await rate(db, `mail-test:${user.id}`, 5, 300);
    const settings = await getSetting(db, "mail");
    if (!settings.host || !settings.from_address) fail(400, "请先保存发件配置");
    if (recipient) {
      const site = await getSetting(db, "site");
      await sendMail(
        settings,
        recipient,
        `${site.name} 邮件测试`,
        "发件配置可用。",
      );
      await audit(db, user.id, "mail.test.send", "smtp");
    } else {
      const transport = mailTransport(settings);
      try {
        await transport.verify();
      } catch {
        fail(400, "连接或认证失败，请检查服务器、加密方式及凭据");
      } finally {
        transport.close();
      }
    }
    return { ok: true };
  });
  app.get("/api/admin/overview", async (req) => {
    requireAdmin(req);
    const { days } = z
      .object({
        days: z.coerce
          .number()
          .refine((v) => v === 7 || v === 30)
          .default(7),
      })
      .parse(req.query);
    const [
      counts,
      activity,
      usage,
      states,
      failures,
      categories,
      heartbeat,
      calls,
    ] = await Promise.all([
      db.query(
        `SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM teams) teams,(SELECT count(*)::int FROM challenges) challenges,(SELECT count(*)::int FROM challenges WHERE published) published_challenges,(SELECT count(*)::int FROM contests WHERE published AND starts_at<=now() AND ends_at>now()) active_contests,(SELECT count(*)::int FROM registrations WHERE status='pending') pending_registrations,(SELECT count(*)::int FROM users WHERE created_at>=now()-$1*interval '1 day') new_users`,
        [days],
      ),
      db.query(
        `SELECT to_char(d,'YYYY-MM-DD') AS day,coalesce(s.submissions,0)::int submissions,coalesce(s.correct,0)::int correct FROM generate_series(date_trunc('day',now() AT TIME ZONE 'UTC')-($1-1)*interval '1 day',date_trunc('day',now() AT TIME ZONE 'UTC'),interval '1 day') d LEFT JOIN (SELECT date_trunc('day',created_at AT TIME ZONE 'UTC') AS day,count(*) submissions,count(*) FILTER(WHERE correct) correct FROM submissions WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC')-($1-1)*interval '1 day' GROUP BY 1) s ON s.day=d ORDER BY d`,
        [days],
      ),
      resourceUsage(db),
      db.query(
        "SELECT resource_type,status,count(*)::int count FROM instances WHERE status NOT IN ('stopped','failed') GROUP BY resource_type,status",
      ),
      db.query(
        "SELECT i.id,coalesce(c.title,'终端') title,i.error,i.updated_at FROM instances i LEFT JOIN challenges c ON c.id=i.challenge_id WHERE i.error IS NOT NULL ORDER BY i.updated_at DESC LIMIT 5",
      ),
      db.query(
        "SELECT category,count(*)::int count FROM challenges GROUP BY category ORDER BY count(*) DESC,category",
      ),
      db.query(
        "SELECT updated_at FROM system_settings WHERE key='worker_heartbeat'",
      ),
      db.query(
        "SELECT count(*)::int requests,count(*) FILTER(WHERE status>=400)::int failed,coalesce(sum(input_tokens+output_tokens),0)::bigint tokens FROM ai_calls WHERE created_at>=now()-$1*interval '1 day'",
        [days],
      ),
    ]);
    return {
      ...counts[0],
      activity,
      categories,
      resources: {
        ...usage,
        states,
        limits: {
          n: (await getSetting(db, "containers")).max_instances,
          cpu: config.MAX_CPU,
          memory: config.MAX_MEMORY,
        },
      },
      failures,
      ai: calls[0],
      worker_at: heartbeat[0]?.updated_at ?? null,
      sampled_at: new Date().toISOString(),
      timezone: "UTC",
    };
  });
}
