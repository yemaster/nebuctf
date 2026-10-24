import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB } from "./db.js";
import { requireUser } from "./auth.js";
import { challengeAccess, ownerFor } from "./context.js";
import { objectiveAnswer, gradeObjective } from "./challenge-model.js";
import { id, scope as scopeSchema } from "./schemas.js";
import { creditSolve } from "./solve.js";
import { fail, rate } from "./security.js";
export function objectiveRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/challenges/:id/answer", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.query as any).scope);
    const challenge = await challengeAccess(db, cid, scope, user);
    if (challenge.challenge_type !== "objective") fail(400, "此题不是客观题");
    const owner = await ownerFor(db, scope, user);
    const [answer] = await db.query(
      "SELECT answer,finalized_at,correct FROM objective_answers WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3",
      [cid, scope, owner],
    );
    return answer ?? { answer: {}, finalized_at: null, correct: null };
  });
  app.post("/api/challenges/:id/answer", async (req) => {
    const user = requireUser(req),
      cid = id.parse((req.params as any).id),
      input = z
        .object({
          scope: scopeSchema,
          answer: objectiveAnswer,
          finalize: z.boolean().default(false),
        })
        .parse(req.body);
    await rate(db, `answer:${user.id}`, 30, 60);
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM challenges WHERE id=$1 FOR SHARE", [cid]);
      const challenge = await challengeAccess(
        tx,
        cid,
        input.scope,
        user,
        true,
        "submit",
      );
      if (challenge.challenge_type !== "objective") fail(400, "此题不是客观题");
      const owner = await ownerFor(tx, input.scope, user);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([input.scope, cid, owner]),
      ]);
      const [old] = await tx.query(
        "SELECT * FROM objective_answers WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3",
        [cid, input.scope, owner],
      );
      if (old?.finalized_at && input.scope !== "practice")
        return {
          answer: old.answer,
          finalized_at: old.finalized_at,
          correct: old.correct,
        };
      const correct = input.finalize
          ? gradeObjective(challenge.objective, input.answer)
          : null,
        finalized = input.finalize ? new Date() : null;
      const [saved] = await tx.query(
        "INSERT INTO objective_answers(id,challenge_id,scope,owner_key,user_id,answer,correct,finalized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(challenge_id,scope,owner_key) DO UPDATE SET answer=excluded.answer,user_id=excluded.user_id,correct=excluded.correct,finalized_at=excluded.finalized_at,updated_at=now() RETURNING answer,correct,finalized_at",
        [
          crypto.randomUUID(),
          cid,
          input.scope,
          owner,
          user.id,
          JSON.stringify(input.answer),
          correct,
          finalized,
        ],
      );
      if (input.finalize) {
        await tx.query(
          "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct) VALUES($1,$2,$3,$4,$5,$6)",
          [crypto.randomUUID(), user.id, cid, input.scope, owner, correct],
        );
        if (correct)
          await creditSolve(tx, challenge, input.scope, owner, user.id);
      }
      return saved;
    });
  });
}
