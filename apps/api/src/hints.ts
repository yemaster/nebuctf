import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB, Row } from "./db.js";
import { audit } from "./db.js";
import { requireUser } from "./auth.js";
import { challengeAccess, contestAccess, progressOwnerFor } from "./context.js";
import { isContestPractice } from "./contest-practice.js";
import { hintDefinitions, hintQuote, type HintPolicy } from "./hint-rules.js";
import { id, scope as scopeInput } from "./schemas.js";
import { fail, rate } from "./security.js";
import { notifyContest } from "./activity-events.js";

export async function visibleHints(
  db: DB,
  c: Row,
  contest: Row | null,
  owner: string,
  preloaded?: Row[],
) {
  const free =
    !contest || !owner || isContestPractice(contest) || !c.permissions?.score;
  const unlocks =
    preloaded ??
    (contest && owner
      ? await db.query(
          "SELECT hint_id,challenge_id,policy FROM hint_unlocks WHERE contest_id=$1 AND challenge_id=$2 AND owner_key=$3",
          [contest.id, c.id, owner],
        )
      : []);
  return hintDefinitions(c as any).map((hint) => {
    const unlocked = unlocks.find(
      (v) => v.hint_id === hint.id && v.challenge_id === c.id,
    );
    const policy: HintPolicy = free
      ? { mode: "free" }
      : (unlocked?.policy ??
        contest!.hint_overrides?.find(
          (v: any) => v.challenge_id === c.id && v.hint_id === hint.id,
        )?.policy ??
        contest!.hint_policy ?? { mode: "free" });
    const visible = free || !!unlocked;
    return {
      id: hint.id,
      ...(visible ? { content: hint.content } : {}),
      unlocked: visible,
      policy,
      quote: hintQuote(hint.id, hint.content, policy, [
        contest?.id ?? "practice",
        owner,
      ]),
    };
  });
}

export function hintRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/challenges/:id/hints/:hintId/unlock", async (req) => {
    const user = requireUser(req);
    const cid = id.parse((req.params as any).id),
      hid = id.parse((req.params as any).hintId);
    const input = z
      .object({
        scope: scopeInput,
        quote: z.string().length(64),
        confirmed: z.boolean().default(false),
      })
      .parse(req.body);
    await rate(db, `hint:${user.id}`, 30, 60);
    return db.transaction(async (tx) => {
      // Lock in the same order as contest/challenge editing. Serialize purchases across team members.
      if (input.scope !== "practice")
        await tx.query("SELECT id FROM contests WHERE id=$1 FOR SHARE", [
          input.scope,
        ]);
      await tx.query("SELECT id FROM challenges WHERE id=$1 FOR SHARE", [cid]);
      const c = await challengeAccess(tx, cid, input.scope, user);
      const contest = await contestAccess(tx, input.scope, user);
      const owner = await progressOwnerFor(tx, input.scope, user);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `hint:${input.scope}:${owner}`,
      ]);
      const hint = (await visibleHints(tx, c, contest, owner)).find(
        (v) => v.id === hid,
      );
      if (!hint) fail(404, "提示不存在");
      if (hint!.unlocked) return hint;
      if (hint!.quote !== input.quote)
        fail(409, "提示或扣分规则已更新，请重新确认");
      if (hint!.policy.mode !== "free" && !input.confirmed)
        fail(400, "请确认查看提示的扣分规则");
      await tx.query(
        "INSERT INTO hint_unlocks(id,contest_id,challenge_id,hint_id,owner_key,user_id,policy) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          input.scope,
          cid,
          hid,
          owner,
          user.id,
          JSON.stringify(hint!.policy),
        ],
      );
      await audit(
        tx,
        user.id,
        "hint.unlock",
        JSON.stringify({
          contest: input.scope,
          challenge: cid,
          hint: hid,
          owner,
          policy: hint!.policy,
        }),
      );
      await notifyContest(tx, input.scope);
      return (await visibleHints(tx, c, contest, owner)).find(
        (v) => v.id === hid,
      );
    });
  });
}
