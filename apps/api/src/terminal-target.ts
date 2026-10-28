import { isIP } from "node:net";
import { z } from "zod";
import type { DB } from "./db.js";
import { challengeAccess, ownerFor, type User } from "./context.js";
import { ownerPermissions } from "./group-permissions.js";
import { fail } from "./security.js";

export const terminalTargetQuery = z
  .object({ target: z.uuid().optional() })
  .strict();
export type TerminalTarget = { id: string; host: string; port: number };

// No command text is accepted from the client. Only a stored, authorized endpoint.
export function parseTerminalEndpoint(endpoint: string) {
  const match = /^(\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+):([0-9]{1,5})$/.exec(
    endpoint,
  );
  if (!match) return fail(409, "靶机连接地址无效");
  const host = match[1]!.replace(/^\[|\]$/g, "");
  const port = Number(match[2]);
  if (
    port < 1 ||
    port > 65535 ||
    host.length > 253 ||
    (!isIP(host) &&
      !host
        .split(".")
        .every((part) =>
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part),
        ))
  )
    return fail(409, "靶机连接地址无效");
  return { host, port };
}

export async function terminalTarget(db: DB, id: string, user: User) {
  const [row] = await db.query(
    `SELECT i.*,c.title,c.challenge_type,
      CASE WHEN i.scope='test' THEN coalesce(i.spec->>'protocol','http')
      ELSE coalesce(c.resources->'container'->>'protocol',i.spec->>'protocol','http') END protocol
     FROM instances i JOIN challenges c ON c.id=i.challenge_id
     WHERE i.id=$1 AND i.resource_type='container'`,
    [id],
  );
  if (!row) return fail(404, "靶机不存在");
  const href =
    row.scope === "test"
      ? `/admin/challenges/${row.challenge_id}/edit`
      : row.scope === "practice"
        ? `/challenges?challenge=${row.challenge_id}`
        : `/contests/${row.scope}/challenges?challenge=${row.challenge_id}`;
  if (row.scope === "test") {
    if (user.role !== "admin" || row.requested_by !== user.id)
      return fail(403, "无权访问此靶机");
  } else {
    await challengeAccess(
      db,
      row.challenge_id,
      row.scope,
      user,
      true,
      "resources",
    );
    const owner = await ownerFor(db, row.scope, user);
    if (row.owner_key !== "shared" && row.owner_key !== owner) {
      if (row.scope === "practice" || row.challenge_type !== "awd")
        return fail(403, "无权访问此靶机");
      const [team] = await db.query(
        "SELECT 1 FROM accepted_registrations WHERE contest_id::text=$1 AND 't:'||team_id=$2",
        [row.scope, row.owner_key],
      );
      const permission = await ownerPermissions(
        db,
        row.scope,
        row.owner_key,
        row.challenge_id,
      );
      if (!team || !permission.view || !permission.resources)
        return fail(403, "无权访问此靶机");
    }
  }
  if (
    row.status !== "running" ||
    new Date(row.expires_at).getTime() <= Date.now()
  )
    return fail(409, "靶机未启动或已到期", { label: "返回题目", href });
  if (row.protocol !== "nc" || !row.endpoint)
    return fail(409, "此靶机不使用 nc 连接", { label: "返回题目", href });
  return {
    id,
    title: row.title as string,
    endpoint: row.endpoint as string,
    href,
    ...parseTerminalEndpoint(row.endpoint),
  };
}
