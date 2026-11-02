import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { DB } from "./db.js";
import { config } from "./config.js";

const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\x00-\x1f\x7f]/.test(v), "不能包含控制字符");
export const siteInput = z
  .object({
    name: plain(48).min(1),
    footer_text: plain(160),
    footer_link_label: plain(40),
    footer_link_url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (v) =>
          !v ||
          (/^https?:\/\//.test(v) &&
            URL.canParse(v) &&
            !new URL(v).username &&
            !new URL(v).password),
        "链接需要使用 HTTP 或 HTTPS",
      ),
  })
  .strict();
export const containerPolicyInput = z
  .object({
    default_ttl: z.number().int().min(60).max(86400),
    renew_limit: z.number().int().min(0).max(100),
    renew_seconds: z.number().int().min(60).max(86400),
    auto_destroy: z.boolean(),
    max_instances: z.number().int().min(1).max(100000).nullable().optional(),
    max_owner_instances: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .nullable()
      .optional(),
    destroy_on_solve: z.boolean().optional(),
  })
  .strict();
export const mailInput = z
  .object({
    require_verification: z.boolean(),
    allowed_emails: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .max(254)
          .refine(
            (v) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ||
              /^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(v),
            "请填写邮箱或域名",
          ),
      )
      .max(200),
    host: z
      .string()
      .trim()
      .max(253)
      .refine((v) => !v || /^[a-zA-Z0-9.:-]+$/.test(v), "SMTP 地址格式不正确"),
    port: z.number().int().min(1).max(65535),
    security: z.enum(["tls", "starttls", "none"]),
    username: plain(254),
    password: z.string().max(2048).optional(),
    clear_password: z.boolean().optional(),
    from_address: z.union([z.email(), z.literal("")]),
    from_name: plain(80),
  })
  .strict();
export const defaults = {
  traffic: {
    enabled: true,
    capture_enabled: false,
    sample_seconds: 15,
    retention_days: 7,
    instance_mib: 64,
    total_mib: 2048,
    capture_limit: 8,
    snap_length: 65535,
  },
  welcome: {
    enabled: false,
    title: "欢迎加入 {site_name}",
    body: "{username}，欢迎加入 {site_name}。",
    actions: [{ label: "完善个人资料", href: "/account?section=profile" }],
  },
  site: {
    name: "NebuCTF",
    footer_text: "",
    footer_link_label: "",
    footer_link_url: "",
  },
  containers: {
    default_ttl: 1800,
    renew_limit: 7,
    renew_seconds: 1800,
    auto_destroy: false,
    max_instances: config.MAX_INSTANCES as number | null,
    max_owner_instances: config.MAX_OWNER_INSTANCES as number | null,
    destroy_on_solve: false,
  },
  mail: {
    require_verification: false,
    allowed_emails: [] as string[],
    host: "",
    port: 587,
    security: "starttls" as "tls" | "starttls" | "none",
    username: "",
    password_cipher: "",
    from_address: "",
    from_name: "",
  },
};
export type Settings = typeof defaults;
export const trafficInput = z
  .object({
    enabled: z.boolean(),
    capture_enabled: z.boolean(),
    sample_seconds: z.number().int().min(10).max(120),
    retention_days: z.number().int().min(1).max(30),
    instance_mib: z.number().int().min(8).max(1024),
    total_mib: z.number().int().min(64).max(102400),
    capture_limit: z.number().int().min(1).max(32),
    snap_length: z.number().int().min(128).max(65535),
  })
  .strict()
  .refine(
    (value) => value.total_mib >= value.instance_mib,
    "总容量不能小于单靶机容量",
  );
export async function getSetting<K extends keyof Settings>(
  db: DB,
  key: K,
): Promise<Settings[K]> {
  const [row] = await db.query(
    "SELECT value FROM system_settings WHERE key=$1",
    [key],
  );
  return {
    ...defaults[key],
    ...(key === "containers"
      ? {
          max_instances: config.MAX_INSTANCES,
          max_owner_instances: config.MAX_OWNER_INSTANCES,
        }
      : {}),
    ...row?.value,
  };
}
export async function saveSetting(db: DB, key: keyof Settings, value: unknown) {
  await db.query(
    "INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
    [key, JSON.stringify(value)],
  );
}
const secretKey = () =>
  createHash("sha256")
    .update("nebuctf-settings-v1:" + config.APP_SECRET)
    .digest();
export function seal(value: string) {
  if (!value) return "";
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function unseal(value: string) {
  if (!value) return "";
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw Error("Invalid encrypted setting");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
