import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
  argon2,
} from "node:crypto";
import { config } from "./config.js";
import { renderFlagTemplate } from "./flag-template.js";
import type { DB } from "./db.js";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public action?: { label: string; href: string },
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export const fail = (
  code: number,
  message: string,
  action?: { label: string; href: string },
): never => {
  throw new HttpError(code, message, action);
};
export const token = () => randomBytes(32).toString("base64url");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const flagHash = (flag: string) =>
  createHmac("sha256", config.APP_SECRET).update(`flag:${flag}`).digest("hex");
export const dynamicFlag = (
  id: string,
  scope: string,
  owner: string,
  part?: string,
  template?: string | null,
) => {
  if (template)
    return renderFlagTemplate(
      template,
      createHmac("sha256", config.APP_SECRET)
        .update(
          JSON.stringify([
            "flag-template-v1",
            id,
            part ?? null,
            scope,
            owner,
            template,
          ]),
        )
        .digest(),
    );
  return `flag{${createHmac("sha256", config.APP_SECRET)
    .update(
      JSON.stringify(
        part
          ? ["dynamic-part", id, part, scope, owner]
          : ["dynamic", id, scope, owner],
      ),
    )
    .digest("hex")
    .slice(0, 40)}}`;
};
export const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
let passwordJobs = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (passwordJobs >= 8) fail(503, "认证服务繁忙，请稍后重试");
  passwordJobs++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      argon2(
        "argon2id",
        {
          message: password,
          nonce: salt,
          memory: 65536,
          passes: 3,
          parallelism: 1,
          tagLength: 32,
        },
        (err, key) => (err ? reject(err) : resolve(key)),
      ),
    );
  } finally {
    passwordJobs--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export async function verifyPassword(hash: string, password: string) {
  const parts = hash.split("$");
  if (
    parts.length !== 6 ||
    parts[1] !== "argon2id" ||
    parts[2] !== "v=19" ||
    parts[3] !== "m=65536,t=3,p=1"
  )
    return false;
  const salt = Buffer.from(parts[4]!, "base64");
  if (salt.length !== 16) return false;
  const actual = await derive(password, salt);
  const expected = Buffer.from(parts[5]!, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function rate(
  db: DB,
  key: string,
  limit: number,
  seconds: number,
) {
  const [row] = await db.query(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.expires_at END RETURNING hits`,
    [key, seconds],
  );
  if (row!.hits > limit) fail(429, "请求过于频繁，请稍后重试");
}
export function score(
  initial: number,
  minimum: number,
  decay: number,
  solves: number,
  dynamic = true,
) {
  return dynamic
    ? Math.max(
        minimum,
        Math.ceil(initial + (minimum - initial) * Math.pow(solves / decay, 2)),
      )
    : initial;
}
