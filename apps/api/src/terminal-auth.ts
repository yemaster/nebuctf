import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import type { DB } from "./db.js";
const claims = z.object({
  instance: z.uuid(),
  user: z.uuid(),
  session: z.string().regex(/^[a-f0-9]{64}$/),
  expires: z.number().int(),
});
export type TerminalTicket = z.infer<typeof claims>;
const signature = (value: string) =>
  createHmac("sha256", config.APP_SECRET)
    .update(`terminal-v1:${value}`)
    .digest();
export function signTerminalTicket(value: Omit<TerminalTicket, "expires">) {
  const body = Buffer.from(
    JSON.stringify({ ...value, expires: Date.now() + 30000 }),
  ).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
export function verifyTerminalTicket(token: string): TerminalTicket {
  if (token.length > 1024) throw Error("Invalid terminal ticket");
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra) throw Error("Invalid terminal ticket");
  const actual = Buffer.from(mac, "base64url"),
    expected = signature(body);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw Error("Invalid terminal ticket");
  const value = claims.parse(
    JSON.parse(Buffer.from(body, "base64url").toString()),
  );
  if (value.expires < Date.now() || value.expires > Date.now() + 30000)
    throw Error("Expired terminal ticket");
  return value;
}
export async function terminalAccess(db: DB, ticket: TerminalTicket) {
  const [row] = await db.query(
    `SELECT i.id FROM instances i JOIN sessions s ON s.user_id=i.requested_by JOIN users u ON u.id=s.user_id
     WHERE i.id=$1 AND i.kind='terminal' AND i.owner_key='u:'||$2::text AND i.requested_by=$2::uuid
     AND i.status='running' AND i.expires_at>now() AND s.token_hash=$3 AND s.expires_at>now() AND NOT u.disabled`,
    [ticket.instance, ticket.user, ticket.session],
  );
  return !!row;
}
