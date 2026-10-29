import {
  registrationFormInput,
  registrationAnswers,
} from "./registration-form-input.js";
export { registrationAnswers } from "./registration-form-input.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB, Row } from "./db.js";
import { requireUser } from "./auth.js";
import { contestAccess, getTeam } from "./context.js";
import { digest, fail } from "./security.js";

export const formRevision = (fields: unknown) =>
  digest(JSON.stringify(fields ?? []));

export function validateRegistrationAnswers(
  fields: z.infer<typeof registrationFormInput>,
  answers: z.infer<typeof registrationAnswers>,
  members: Row[],
) {
  const allowed = new Set(members.map((m) => m.id));
  if (Object.keys(answers.members).some((id) => !allowed.has(id)))
    fail(400, "报名资料包含非本队成员");
  function validate(
    scope: "team" | "member",
    values: Record<string, string | string[]>,
    name: string,
  ) {
    if (
      Object.keys(values).some(
        (id) => !fields.some((f) => f.id === id && f.scope === scope),
      )
    )
      fail(400, "报名表单已更新，请重新核对填写内容");
    for (const f of fields.filter((f) => f.scope === scope)) {
      const input = values[f.id];
      if (f.required && (!input || !input.length))
        fail(400, `请填写${name}${f.label}`);
      if (!input || !input.length) continue;
      if (f.type === "multi") {
        if (
          !Array.isArray(input) ||
          new Set(input).size !== input.length ||
          input.some((v) => !f.options.includes(v))
        )
          fail(400, `${name}${f.label}选项无效`);
      } else {
        if (typeof input !== "string") fail(400, `${name}${f.label}格式不正确`);
        const text = input as string;
        if (f.type === "email" && !z.email().safeParse(text).success)
          fail(400, `${name}${f.label}格式不正确`);
        if (f.type === "phone" && !/^\+?[\d ()-]{5,30}$/.test(text))
          fail(400, `${name}${f.label}格式不正确`);
        if (f.type === "select" && !f.options.includes(text))
          fail(400, `${name}${f.label}选项无效`);
      }
    }
  }
  validate("team", answers.team, "");
  for (const m of members)
    validate("member", answers.members[m.id] ?? {}, `${m.username}的`);
}

export function registrationFormRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/contests/:id/registration-form", async (req) => {
    const user = requireUser(req),
      cid = z.uuid().parse((req.params as any).id);
    const { team: tid } = z.object({ team: z.uuid() }).parse(req.query);
    const contest = await contestAccess(db, cid, user, false);
    const team = await getTeam(db, user.id, tid);
    if (!team || team.captain_id !== user.id)
      fail(403, "仅队长可以填写报名资料");
    let [saved] = await db.query(
      "SELECT status,form_answers,form_snapshot,submitted_members FROM registrations WHERE contest_id=$1 AND team_id=$2",
      [cid, tid],
    );
    if (
      saved?.form_snapshot?.length &&
      saved.submitted_members?.length &&
      !saved.submitted_members.some((m: Row) => m.id === user.id)
    ) {
      if (saved.status === "rejected") saved = undefined;
      else fail(403, "无权查看原参赛成员的报名资料");
    }
    const members = await db.query(
      `SELECT u.id,u.username,u.avatar_id,
      CASE WHEN u.id=$2 THEN u.email ELSE '' END email,
      CASE WHEN u.id=$2 THEN u.phone ELSE '' END phone
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.id=$2 DESC,u.username,u.id`,
      [tid, user.id],
    );
    return {
      fields: contest!.registration_form ?? [],
      revision: formRevision(contest!.registration_form),
      members,
      saved: saved ?? null,
    };
  });
}
