import {
  filterContestLogic,
  lockContestChoices,
  bindContestChoice,
} from "./contest-logic.js";
import { submissionUsage, requireSubmissionSlot } from "./submission-policy.js";
import { seal } from "./settings.js";
import { visibleHints, hintRoutes } from "./hints.js";
import { contestVisibilitySQL } from "./contest-entry.js";
import { contestCutoff, isContestPractice } from "./contest-practice.js";
import { recordFlagAnomaly } from "./contest-monitor.js";
import { notifyContest } from "./activity-events.js";
import { creditSolve } from "./solve.js";
import { teamPhases } from "./contest-timing.js";
import { readContestClock } from "./contest-clock.js";
import { flagMode } from "./challenge-model.js";
import { challengeProgress } from "./challenge-parts.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type DB } from "./db.js";
import { requireUser } from "./auth.js";
import {
  challengeAccess,
  contestAccess,
  ownerFor,
  progressOwnerFor,
} from "./context.js";
import { id, page, scope as scopeSchema } from "./schemas.js";
import { dynamicFlag, equal, fail, flagHash, rate } from "./security.js";
import { visibleChallengeIds } from "./group-permissions.js";
export function challengeRoutes(app: FastifyInstance, db: DB) {
  hintRoutes(app, db);
  app.get("/api/challenges", async (req) => {
    const p = page
      .extend({
        page_size: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(req.query);
    const contest = await contestAccess(db, p.scope, req.user ?? undefined);
    const cutoff = contestCutoff(contest);
    if (!req.user && p.scope !== "practice") fail(401, "请先登录");
    const owner = await progressOwnerFor(db, p.scope, req.user ?? undefined);
    const phases = contest && owner ? await teamPhases(db, contest, owner) : [];
    const sections = phases
      .filter((p) => p.status === "active")
      .map((p) => p.section);
    let visibleIds = await visibleChallengeIds(
      db,
      p.scope,
      req.user ?? undefined,
    );
    if (contest) {
      const candidates = await db.query(
        "SELECT challenge_id id FROM contest_challenges WHERE contest_id=$1",
        [p.scope],
      );
      const available = await filterContestLogic(
        db,
        candidates,
        p.scope,
        owner,
        isContestPractice(contest),
      );
      visibleIds = available
        .map((c) => c.id)
        .filter((id: string) => visibleIds === null || visibleIds.includes(id));
    }
    const args = [
      p.scope,
      p.q,
      p.category,
      owner,
      p.scope === "practice" ? (p.page - 1) * p.page_size : 0,
      cutoff,
      sections,
      visibleIds,
      p.page_size,
    ];
    const condition = `WHERE c.published AND (($1='practice' AND c.practice) OR EXISTS(SELECT 1 FROM contest_challenges cc WHERE cc.challenge_id=c.id AND cc.contest_id::text=$1 AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND ($4='' OR CASE WHEN c.challenge_type='objective' THEN 'objective' ELSE 'practical' END=ANY($7::text[])))) AND ($8::uuid[] IS NULL OR c.id=ANY($8::uuid[])) AND ($2='' OR c.title ILIKE '%'||$2||'%') AND ($3='' OR c.category=$3)`;
    const rows = await db.query(
      `SELECT c.id,c.title,c.category,c.difficulty,c.kind,c.challenge_type,c.initial_points,c.minimum_points,c.decay,c.dynamic_score,c.created_at,c.resources,c.objective,(c.patch_config IS NOT NULL) patch_config,count(*) OVER()::int total,(SELECT count(*)::int FROM solves s WHERE s.challenge_id=c.id AND s.scope=$1 AND s.created_at<=$6 AND NOT s.contest_practice) solves,EXISTS(SELECT 1 FROM solves s WHERE s.challenge_id=c.id AND s.scope=$1 AND s.owner_key=$4) solved FROM challenges c ${condition} ORDER BY c.created_at,c.id LIMIT CASE WHEN $1='practice' THEN $9 ELSE 200 END OFFSET $5`,
      args,
    );
    const total =
      rows[0]?.total ??
      (p.page > 1 && p.scope === "practice"
        ? (
            await db.query(
              `SELECT count(*)::int total FROM challenges c WHERE c.published AND c.practice AND ($1='' OR c.title ILIKE '%'||$1||'%') AND ($2='' OR c.category=$2)`,
              [p.q, p.category],
            )
          )[0]!.total
        : 0);
    const [objectives] = contest
      ? await db.query(
          "SELECT count(*)::int total FROM challenges c JOIN contest_challenges cc ON cc.challenge_id=c.id WHERE cc.contest_id=$1 AND c.challenge_type='objective' AND c.published AND cc.published AND (cc.release_at IS NULL OR cc.release_at<=now()) AND ($2::uuid[] IS NULL OR c.id=ANY($2::uuid[]))",
          [p.scope, visibleIds],
        )
      : [];
    return {
      objective_count: objectives?.total ?? 0,
      items: (
        await challengeProgress(
          db,
          await filterContestLogic(
            db,
            rows,
            p.scope,
            owner,
            isContestPractice(contest),
          ),
          p.scope,
          owner,
          cutoff,
          isContestPractice(contest),
          { summary: true },
        )
      ).map((c) => ({
        ...c,
        description: undefined,
        hints: undefined,
        parts: c.parts.map((p) => ({ ...p, description: undefined })),
      })),
      total,
      page: p.page,
      page_size: p.scope === "practice" ? p.page_size : 200,
      phases,
      clock: contest ? await readContestClock(db, contest) : null,
    };
  });
  app.get("/api/challenges/:id", async (req) => {
    const cid = id.parse((req.params as any).id),
      scope = scopeSchema.parse((req.query as any).scope);
    const c = await challengeAccess(db, cid, scope, req.user ?? undefined);
    const contest = await contestAccess(db, scope, req.user ?? undefined);
    const cutoff = contestCutoff(contest);
    const owner = await progressOwnerFor(db, scope, req.user ?? undefined);
    const [count] = await db.query(
      "SELECT coalesce(bool_or(owner_key=$3),false) solved FROM solves WHERE challenge_id=$1 AND scope=$2",
      // Personal progress stays live during a freeze, while aggregate counts use the cutoff below.
      [cid, scope, owner],
    );
    const [visible] = await db.query(
      "SELECT count(*)::int n FROM solves WHERE challenge_id=$1 AND scope=$2 AND created_at<=$3 AND NOT contest_practice",
      [cid, scope, cutoff],
    );
    const attachments = await db.query(
      "SELECT id,name,size FROM attachments WHERE challenge_id=$1 ORDER BY created_at",
      [cid],
    );
    const [result] = await challengeProgress(
      db,
      [{ ...c, solves: visible!.n, solved: count!.solved }],
      scope,
      owner,
      cutoff,
      isContestPractice(contest),
    );
    return {
      ...result,
      hints: await visibleHints(db, c, contest, owner),
      submission_usage: await submissionUsage(db, c, scope, owner),
      attachments,
    };
  });
  app.post("/api/challenges/:id/submit", async (req) => {
    const u = requireUser(req),
      cid = id.parse((req.params as any).id),
      data = z
        .object({ flag: z.string().min(1).max(256), scope: scopeSchema })
        .parse(req.body);
    await rate(db, `submit-user:${u.id}`, 30, 60);
    return db.transaction(async (tx) => {
      const submittingOwner = await ownerFor(tx, data.scope, u);
      await lockContestChoices(tx, data.scope, submittingOwner, [cid]);
      await tx.query("SELECT id FROM challenges WHERE id=$1 FOR SHARE", [cid]);
      const c = await challengeAccess(tx, cid, data.scope, u, true, "submit");
      if (c.challenge_type === "objective")
        fail(400, "客观题请使用答案提交入口");
      if (c.challenge_type === "awd") fail(400, "AWD 请使用比赛攻防提交入口");
      const owner = await ownerFor(tx, data.scope, u);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([data.scope, cid, owner]),
      ]);
      await requireSubmissionSlot(tx, c, data.scope, owner, "flag");
      await bindContestChoice(tx, c, data.scope, owner);
      const parts = await tx.query(
        "SELECT * FROM challenge_parts WHERE challenge_id=$1 ORDER BY position,id",
        [cid],
      );
      const submitted = flagHash(data.flag);
      const candidates = parts.length
        ? parts.filter((part) => part.role !== "defense")
        : [{ ...c, id: null }];
      const bound =
        flagMode(c) === "dynamic" && data.scope !== "practice"
          ? await tx.query(
              "SELECT part_key,template FROM contest_flag_templates WHERE contest_id=$1 AND challenge_id=$2 AND owner_key=$3",
              [data.scope, cid, owner],
            )
          : [];
      const templates = new Map(
        bound.map((row) => [row.part_key, row.template]),
      );
      // Check every candidate; client never chooses the small question being credited.
      let matched: (typeof candidates)[number] | undefined;
      for (const part of candidates) {
        const expected =
          flagMode(c) === "dynamic"
            ? flagHash(
                dynamicFlag(
                  cid,
                  data.scope,
                  owner,
                  part.id ?? undefined,
                  templates.get(part.id ?? "") ??
                    part.flag_template ??
                    c.flag_template,
                ),
              )
            : part.flag_hash;
        if (equal(submitted, expected)) matched = part;
      }
      if (!matched && flagMode(c) === "dynamic" && data.scope !== "practice") {
        const issued = await tx.query(
          "SELECT part_key FROM issued_flags WHERE contest_id=$1 AND challenge_id=$2 AND owner_key=$3 AND flag_hash=$4",
          [data.scope, cid, owner, submitted],
        );
        matched = candidates.find((part) =>
          issued.some((row) => row.part_key === (part.id ?? "")),
        );
      }
      const correct = !!matched,
        submissionId = crypto.randomUUID();
      await tx.query(
        "INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct,part_id,contest_practice,flag_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          submissionId,
          u.id,
          cid,
          data.scope,
          owner,
          correct,
          matched?.id ?? null,
          !!c.contest_practice,
          correct ? null : seal(data.flag),
        ],
      );
      if (!matched) {
        if (flagMode(c) === "dynamic" && !c.contest_practice)
          await recordFlagAnomaly(
            tx,
            submissionId,
            data.scope,
            cid,
            owner,
            submitted,
          );
        await notifyContest(tx, data.scope);
        return { correct: false, already_solved: false };
      }
      return creditSolve(
        tx,
        c,
        data.scope,
        owner,
        u.id,
        matched.id ? matched : undefined,
      );
    });
  });
  app.get("/api/submissions", async (req) => {
    const u = requireUser(req);
    const p = page
      .extend({
        page_size: z.coerce.number().int().min(1).max(100).default(30),
        result: z.enum(["all", "correct", "incorrect"]).default("all"),
      })
      .parse(req.query);
    const where =
      "s.user_id=$1 AND ($2='' OR c.title ILIKE '%'||$2||'%') AND ($3='all' OR s.correct=($3='correct'))";
    const values = [u.id, p.q, p.result];
    const [items, [count]] = await Promise.all([
      db.query(
        `SELECT s.id,c.title,s.correct,s.created_at,s.scope,s.contest_practice,p.title part_title FROM submissions s LEFT JOIN challenge_parts p ON p.id=s.part_id JOIN challenges c ON c.id=s.challenge_id WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT $4 OFFSET $5`,
        [...values, p.page_size, (p.page - 1) * p.page_size],
      ),
      db.query(
        `SELECT count(*)::int total FROM submissions s JOIN challenges c ON c.id=s.challenge_id WHERE ${where}`,
        values,
      ),
    ]);
    return { items, total: count!.total, page: p.page, page_size: p.page_size };
  });
  app.get("/api/stats", async (req) => {
    const [stats] = await db.query(
      `SELECT (SELECT count(*)::int FROM challenges WHERE published AND practice) challenges,(SELECT count(*)::int FROM contests c WHERE published AND ends_at>now() AND ${contestVisibilitySQL("c", "$1::uuid", "$2::boolean")}) contests,(SELECT count(*)::int FROM teams) teams,(SELECT count(*)::int FROM solves WHERE scope='practice') solves`,
      [req.user?.id ?? null, req.user?.role === "admin"],
    );
    const activity = await db.query(
      `SELECT u.username,c.title,s.created_at FROM solves s JOIN users u ON u.id=s.user_id JOIN challenges c ON c.id=s.challenge_id WHERE s.scope='practice' AND c.published AND c.practice ORDER BY s.created_at DESC LIMIT 6`,
    );
    const [personal] = req.user
      ? await db.query(
          "SELECT count(*)::int solves FROM solves WHERE scope='practice' AND owner_key=$1",
          [`u:${req.user.id}`],
        )
      : [{ solves: 0 }];
    return { ...stats, personal, activity };
  });
}
