import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "./auth.js";
import { audit, type DB } from "./db.js";
import { rate } from "./security.js";

const profileInput = z
  .object({
    real_name: z.string().trim().max(80, "姓名不能超过 80 字"),
    student_number: z.string().trim().max(48, "学号不能超过 48 字"),
    phone: z.string().trim().max(32, "联系电话不能超过 32 字"),
  })
  .strict();

export function profileRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/account/profile", async (req) => {
    const user = requireUser(req);
    const [profile] = await db.query(
      "SELECT real_name,student_number,phone FROM users WHERE id=$1",
      [user.id],
    );
    return profile;
  });
  app.put("/api/account/profile", async (req) => {
    const user = requireUser(req),
      data = profileInput.parse(req.body);
    await rate(db, `profile:${user.id}`, 20, 60);
    return db.transaction(async (tx) => {
      const [profile] = await tx.query(
        "UPDATE users SET real_name=$2,student_number=$3,phone=$4 WHERE id=$1 RETURNING real_name,student_number,phone",
        [user.id, data.real_name, data.student_number, data.phone],
      );
      await audit(tx, user.id, "user.profile", user.id);
      return profile;
    });
  });
}
