import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "./auth.js";
import { audit, lock, type DB } from "./db.js";
import { fail } from "./security.js";
import { id, page } from "./schemas.js";
import {
  permissionGroups,
  permissionKeys,
  refreshAccess,
} from "./access-control.js";

const permissions = z
  .array(z.string().refine((key) => permissionKeys.includes(key), "权限无效"))
  .max(40)
  .transform((keys) => [...new Set(keys)]);
const roleInput = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .refine(
      (name) => !["超级管理员", "普通用户"].includes(name),
      "此名称为内置角色",
    ),
  permissions,
});
export function roleRoutes(app: FastifyInstance, db: DB) {
  app.addHook("preHandler", async (req) => {
    if (
      req.routeOptions.url?.startsWith("/api/admin/roles") ||
      req.routeOptions.url === "/api/admin/users/:id/access"
    ) {
      if (requireUser(req).role !== "admin")
        fail(403, "仅超级管理员可以分配权限");
    }
  });
  app.get("/api/admin/roles", async (req) => {
    const p = page
      .extend({
        page_size: z.coerce.number().int().min(10).max(100).default(10),
      })
      .parse(req.query);
    return {
      groups: permissionGroups,
      keys: permissionKeys,
      total: (
        await db.query(
          "SELECT count(*)::int total FROM roles WHERE name ILIKE '%'||$1||'%'",
          [p.q],
        )
      )[0]!.total,
      items: await db.query(
        "SELECT r.*,(SELECT count(*)::int FROM user_roles ur WHERE ur.role_id=r.id) users FROM roles r WHERE r.name ILIKE '%'||$1||'%' ORDER BY r.name,r.id LIMIT $2 OFFSET $3",
        [p.q, p.page_size, (p.page - 1) * p.page_size],
      ),
    };
  });
  app.get("/api/admin/roles/:id", async (req) => {
    const [row] = await db.query("SELECT * FROM roles WHERE id=$1", [
      id.parse((req.params as any).id),
    ]);
    if (!row) fail(404, "角色不存在");
    return { ...row, groups: permissionGroups, keys: permissionKeys };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/admin/roles${method === "PUT" ? "/:id" : ""}`,
      handler: async (req) => {
        const actor = requireUser(req),
          data = roleInput.parse(req.body),
          rid =
            method === "PUT"
              ? id.parse((req.params as any).id)
              : crypto.randomUUID();
        return db.transaction(async (tx) => {
          await lock(tx);
          if (
            method === "PUT" &&
            !(await tx.query("SELECT id FROM roles WHERE id=$1", [rid])).length
          )
            fail(404, "角色不存在");
          await tx.query(
            "INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions",
            [rid, data.name, JSON.stringify(data.permissions)],
          );
          await refreshAccess(
            tx,
            (
              await tx.query(
                "SELECT user_id FROM user_roles WHERE role_id=$1",
                [rid],
              )
            ).map((u) => u.user_id),
          );
          await audit(tx, actor.id, "role.save", rid);
          return { id: rid };
        });
      },
    });
  app.delete("/api/admin/roles/:id", async (req) =>
    db.transaction(async (tx) => {
      await lock(tx);
      const rid = id.parse((req.params as any).id),
        users = await tx.query(
          "SELECT user_id FROM user_roles WHERE role_id=$1",
          [rid],
        );
      await tx.query("DELETE FROM roles WHERE id=$1", [rid]);
      await refreshAccess(
        tx,
        users.map((u) => u.user_id),
      );
      await audit(tx, requireUser(req).id, "role.delete", rid);
      return { ok: true };
    }),
  );
  app.get("/api/admin/users/:id/access", async (req) => {
    const uid = id.parse((req.params as any).id),
      [user] = await db.query(
        "SELECT id,username,role,access_profile access FROM users WHERE id=$1",
        [uid],
      );
    if (!user) fail(404, "用户不存在");
    return {
      ...user,
      grants: await db.query(
        "SELECT g.kind,g.target_id id,g.permissions,coalesce(c.title,t.title,'已删除') title FROM user_grants g LEFT JOIN challenges c ON g.kind='challenge' AND c.id=g.target_id LEFT JOIN contests t ON g.kind='contest' AND t.id=g.target_id WHERE g.user_id=$1 ORDER BY g.kind,g.target_id",
        [uid],
      ),
    };
  });
  app.put("/api/admin/users/:id/access", async (req) => {
    const uid = id.parse((req.params as any).id),
      data = z
        .object({
          role: z.enum(["admin", "user"]),
          roles: z.array(id).max(20),
          grants: z
            .array(
              z.object({
                kind: z.enum(["challenge", "contest"]),
                id,
                permissions,
              }),
            )
            .max(100),
        })
        .parse(req.body);
    for (const grant of data.grants) {
      const allowed =
        grant.kind === "challenge"
          ? ["challenges.read", "challenges.write"]
          : [
              "contests.read",
              "contests.write",
              "traffic.read",
              "traffic.write",
            ];
      if (
        !grant.permissions.length ||
        grant.permissions.some((key) => !allowed.includes(key))
      )
        fail(400, "授权范围与权限不匹配");
    }
    if (
      new Set(data.grants.map((g) => `${g.kind}:${g.id}`)).size !==
      data.grants.length
    )
      fail(400, "同一对象只能配置一次授权");
    return db.transaction(async (tx) => {
      await lock(tx);
      const [old] = await tx.query(
        "SELECT role,disabled FROM users WHERE id=$1 FOR UPDATE",
        [uid],
      );
      if (!old) fail(404, "用户不存在");
      if (
        old!.role === "admin" &&
        data.role !== "admin" &&
        !(
          await tx.query(
            "SELECT id FROM users WHERE role='admin' AND NOT disabled AND id<>$1 LIMIT 1",
            [uid],
          )
        ).length
      )
        fail(409, "至少保留一名可用的超级管理员");
      if (
        (
          await tx.query("SELECT id FROM roles WHERE id=ANY($1::uuid[])", [
            data.roles,
          ])
        ).length !== new Set(data.roles).size
      )
        fail(400, "角色不存在");
      for (const kind of ["challenge", "contest"] as const) {
        const ids = data.grants.filter((g) => g.kind === kind).map((g) => g.id);
        if (
          (
            await tx.query(
              `SELECT id FROM ${kind === "challenge" ? "challenges" : "contests"} WHERE id=ANY($1::uuid[])`,
              [ids],
            )
          ).length !== ids.length
        )
          fail(400, "授权对象不存在");
      }
      await tx.query("UPDATE users SET role=$2 WHERE id=$1", [uid, data.role]);
      await tx.query("DELETE FROM user_roles WHERE user_id=$1", [uid]);
      await tx.query("INSERT INTO user_roles SELECT $1,unnest($2::uuid[])", [
        uid,
        [...new Set(data.roles)],
      ]);
      await tx.query("DELETE FROM user_grants WHERE user_id=$1", [uid]);
      for (const grant of data.grants)
        await tx.query("INSERT INTO user_grants VALUES($1,$2,$3,$4)", [
          uid,
          grant.kind,
          grant.id,
          JSON.stringify(grant.permissions),
        ]);
      await refreshAccess(tx, [uid]);
      await audit(tx, requireUser(req).id, "user.access.update", uid);
      return { ok: true };
    });
  });
}
