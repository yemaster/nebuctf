import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { config } from "./config.js";
import { equal, fail, rate } from "./security.js";

const lifetime = 300;
const purposeInput = z.enum(["login", "register", "team-create", "team-join"]);
type Purpose = z.infer<typeof purposeInput>;
const signedInput = z.object({
  version: z.literal(1),
  id: z.uuid(),
  purpose: purposeInput,
  salt: z.string().regex(/^[a-f0-9]{64}$/),
  difficulty: z.number().int().min(12).max(22),
  expires: z.number().int().positive().safe(),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
});
const proofInput = z.object({
  token: z
    .string()
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/),
  nonce: z.string().regex(/^[a-f0-9]{16}$/),
});
const mac = (kind: string, value: string) =>
  createHmac("sha256", config.APP_SECRET)
    .update(`captcha:${kind}:${value}`)
    .digest("hex");
const binding = (req: FastifyRequest) =>
  mac("binding", JSON.stringify([req.ip, req.user?.id ?? null]));

export function captchaRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/captcha/challenge", async (req) => {
    const { purpose } = z.object({ purpose: purposeInput }).parse(req.body);
    if (purpose.startsWith("team-") && !req.user) fail(401, "请先登录");
    await rate(db, `captcha-issue:${req.ip}`, 30, 60);
    const challenge = {
      version: 1,
      id: randomUUID(),
      purpose,
      salt: randomBytes(32).toString("hex"),
      difficulty: config.CAPTCHA_DIFFICULTY,
      expires: Date.now() + lifetime * 1000,
      binding: binding(req),
    };
    const encoded = Buffer.from(JSON.stringify(challenge)).toString(
      "base64url",
    );
    return {
      token: `${encoded}.${mac("challenge", encoded)}`,
      salt: challenge.salt,
      difficulty: challenge.difficulty,
      expires_at: new Date(challenge.expires).toISOString(),
      expires_in: lifetime,
    };
  });
}

// Validate before password hashing or business writes. One proof authorizes
// one attempt, including a failed login, and is shared atomically across API nodes.
export async function consumeCaptcha(
  db: DB,
  req: FastifyRequest,
  purpose: Purpose,
) {
  const proof = proofInput.safeParse(
    (req.body as { captcha?: unknown })?.captcha,
  );
  if (!proof.success) return fail(400, "请完成安全验证");
  await rate(db, `captcha-verify:${req.ip}`, 60, 60);
  const [encoded, signature] = proof.data.token.split(".");
  if (!equal(signature!, mac("challenge", encoded!)))
    fail(400, "验证无效，请重新验证");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
  } catch {
    fail(400, "验证无效，请重新验证");
  }
  const parsed = signedInput.safeParse(value);
  if (!parsed.success) return fail(400, "验证无效，请重新验证");
  const challenge = parsed.data;
  if (challenge.purpose !== purpose || !equal(challenge.binding, binding(req)))
    fail(400, "验证无效，请重新验证");
  if (challenge.expires <= Date.now()) fail(400, "验证已过期，请重新验证");
  const hash = createHash("sha256")
    .update(Buffer.from(challenge.salt, "hex"))
    .update(Buffer.from(proof.data.nonce, "hex"))
    .digest();
  for (let bit = 0; bit < challenge.difficulty; bit++)
    if (hash[bit >> 3]! & (0x80 >> (bit & 7))) fail(400, "验证未通过，请重试");
  const used = await db.query(
    "INSERT INTO captcha_uses(id,expires_at) SELECT $1,$2::timestamptz WHERE $2::timestamptz>now() ON CONFLICT DO NOTHING RETURNING id",
    [challenge.id, new Date(challenge.expires)],
  );
  if (!used.length) fail(400, "验证已失效，请重新验证");
}
