import { visibleHints } from "./hints.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DB, Row } from "./db.js";
import { requireUser } from "./auth.js";
import {
  challengeAccess,
  ownerFor,
  contestAccess,
  progressOwnerFor,
  type User,
} from "./context.js";
import { visibleChallengeIds } from "./group-permissions.js";
import { challengeProgress } from "./challenge-parts.js";
import { contestCutoff, isContestPractice } from "./contest-practice.js";
import { teamPhases } from "./contest-timing.js";
import {
  objectiveAnswer,
  gradeObjective,
  objectiveReview,
  type ObjectiveAnswer,
} from "./challenge-model.js";
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
      "SELECT answer,finalized_at,correct FROM objective_answers WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND contest_practice=$4",
      [cid, scope, owner, !!challenge.contest_practice],
    );
    return {
      ...(answer ?? { answer: {}, finalized_at: null, correct: null }),
      review: answer?.finalized_at
        ? objectiveReview(challenge.objective, answer.answer)
        : null,
      practice: scope === "practice" || !!challenge.contest_practice,
    };
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
      return saveObjectiveAnswer(tx, user, cid, input);
    });
  });
  app.get("/api/contests/:id/objective-paper", async (req) => {
    const user = requireUser(req),
      scope = id.parse((req.params as any).id);
    const contest = (await contestAccess(db, scope, user, false))!,
      owner = await progressOwnerFor(db, scope, user);
    const phase = (await teamPhases(db, contest, owner)).find(
      (p) => p.section === "objective",
    )!;
    const preview = !owner && user.role === "admin",
      practice = isContestPractice(contest);
    // Unstarted sections reveal neither questions nor answers, even when other sections are open.
    if (!preview && !["active", "ended"].includes(phase.status))
      return {
        items: [],
        phase,
        preview: false,
        practice,
        can_submit: false,
        server_time: new Date().toISOString(),
      };
    const questions = await objectiveQuestions(db, scope, user);
    const items: Row[] = await challengeProgress(
      db,
      questions,
      scope,
      owner,
      contestCutoff(contest),
      practice,
    );
    const answers = owner
      ? await db.query(
          "SELECT challenge_id,answer,correct,finalized_at,updated_at::text revision FROM objective_answers WHERE scope=$1 AND owner_key=$2 AND contest_practice=$3",
          [scope, owner, practice],
        )
      : [];
    const hintUnlocks = owner
      ? await db.query(
          "SELECT challenge_id,hint_id,policy FROM hint_unlocks WHERE contest_id=$1 AND owner_key=$2",
          [scope, owner],
        )
      : [];
    const questionHints = new Map(
      await Promise.all(
        items.map(
          async (q) =>
            [
              q.id,
              await visibleHints(
                db,
                {
                  ...questions.find((c) => c.id === q.id)!,
                  permissions: q.permissions,
                },
                contest,
                owner,
                hintUnlocks,
              ),
            ] as const,
        ),
      ),
    );
    return {
      items: items.map((q) => {
        const saved = answers.find((a) => a.challenge_id === q.id) ?? {
          answer: {},
          correct: null,
          finalized_at: null,
          revision: null,
        };
        return {
          hints: questionHints.get(q.id),
          id: q.id,
          title: q.title,
          description: q.description,
          objective: q.objective,
          points: q.points,
          permissions: q.permissions,
          saved: {
            ...saved,
            review: saved.finalized_at
              ? objectiveReview(
                  questions.find((c) => c.id === q.id)!.objective,
                  saved.answer,
                )
              : null,
          },
        };
      }),
      phase,
      server_time: new Date().toISOString(),
      preview,
      practice,
      can_submit: !!owner && phase.status === "active",
    };
  });
  app.post(
    "/api/contests/:id/objective-paper",
    { bodyLimit: 4 * 1024 * 1024 },
    async (req) => {
      const user = requireUser(req),
        scope = id.parse((req.params as any).id);
      const input = z
        .object({
          finalize: z.boolean(),
          answers: z
            .array(
              z.object({
                id,
                answer: objectiveAnswer.refine(
                  (a) => Object.keys(a.blanks ?? {}).length <= 10,
                ),
                revision: z.string().max(80).nullable(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(req.body);
      if (new Set(input.answers.map((a) => a.id)).size !== input.answers.length)
        fail(400, "答卷包含重复题目");
      await rate(db, `paper:${user.id}`, 30, 60);
      return db.transaction(async (tx) => {
        const contest = (await contestAccess(tx, scope, user))!,
          owner = await ownerFor(tx, scope, user);
        // Same permission projection as GET. A newly released question must not be silently skipped.
        if (input.finalize) {
          const questions = await objectiveQuestions(tx, scope, user),
            visible: Row[] = await challengeProgress(
              tx,
              questions,
              scope,
              owner,
              contestCutoff(contest),
              isContestPractice(contest),
            );
          const expected = visible
            .filter((c) => c.permissions.submit)
            .map((c) => c.id)
            .sort();
          if (
            JSON.stringify(expected) !==
            JSON.stringify(input.answers.map((a) => a.id).sort())
          )
            fail(409, "题目已更新，请刷新答卷后重新提交");
        }
        const items = [];
        for (const item of [...input.answers].sort((a, b) =>
          a.id.localeCompare(b.id),
        ))
          items.push({
            id: item.id,
            ...(await saveObjectiveAnswer(tx, user, item.id, {
              scope,
              answer: item.answer,
              revision: item.revision,
              finalize: input.finalize,
            })),
          });
        return { items, server_time: new Date().toISOString() };
      });
    },
  );
}

async function objectiveQuestions(
  db: DB,
  scope: string,
  user: User,
): Promise<Row[]> {
  const visible = await visibleChallengeIds(db, scope, user);
  return db.query(
    "SELECT c.* FROM challenges c JOIN contest_challenges cc ON cc.challenge_id=c.id WHERE cc.contest_id=$1 AND c.challenge_type='objective' AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND ($2::uuid[] IS NULL OR c.id=ANY($2::uuid[])) ORDER BY c.created_at,c.id LIMIT 200",
    [scope, visible],
  );
}

async function saveObjectiveAnswer(
  tx: DB,
  user: User,
  cid: string,
  input: {
    scope: string;
    answer: ObjectiveAnswer;
    finalize: boolean;
    revision?: string | null;
  },
) {
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
    "SELECT *,updated_at::text revision FROM objective_answers WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND contest_practice=$4",
    [cid, input.scope, owner, !!challenge.contest_practice],
  );
  if (
    old?.finalized_at &&
    input.scope !== "practice" &&
    !challenge.contest_practice
  )
    return {
      answer: old.answer,
      finalized_at: old.finalized_at,
      correct: old.correct,
      review: objectiveReview(challenge.objective, old.answer),
      revision: old.revision,
      practice: false,
    };
  if (
    input.revision !== undefined &&
    input.revision !== (old?.revision ?? null)
  )
    fail(409, "队友已更新答案，请刷新答卷后重新检查");
  const correct = input.finalize
      ? gradeObjective(challenge.objective, input.answer)
      : null,
    finalized = input.finalize ? new Date() : null;
  const [saved] = await tx.query(
    "INSERT INTO objective_answers(id,challenge_id,scope,owner_key,user_id,answer,correct,finalized_at,contest_practice) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(challenge_id,scope,owner_key,contest_practice) DO UPDATE SET answer=excluded.answer,user_id=excluded.user_id,correct=excluded.correct,finalized_at=excluded.finalized_at,updated_at=now() RETURNING answer,correct,finalized_at,updated_at::text revision",
    [
      crypto.randomUUID(),
      cid,
      input.scope,
      owner,
      user.id,
      JSON.stringify(input.answer),
      correct,
      finalized,
      !!challenge.contest_practice,
    ],
  );
  if (input.finalize) {
    await tx.query(
      "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct,contest_practice) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        crypto.randomUUID(),
        user.id,
        cid,
        input.scope,
        owner,
        correct,
        !!challenge.contest_practice,
      ],
    );
    if (correct) await creditSolve(tx, challenge, input.scope, owner, user.id);
  }
  return {
    ...saved,
    review: saved!.finalized_at
      ? objectiveReview(challenge.objective, saved!.answer)
      : null,
    practice: input.scope === "practice" || !!challenge.contest_practice,
  };
}
