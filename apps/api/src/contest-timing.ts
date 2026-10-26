import type { FastifyInstance } from "fastify";
import type { DB, Row } from "./db.js";
import { requireUser } from "./auth.js";
import { contestAccess, ownerFor } from "./context.js";
import { challengePhase, phaseName, phaseWindow } from "./competition-rules.js";
import { id } from "./schemas.js";
import { fail } from "./security.js";
import { isContestPractice } from "./contest-practice.js";
import { readContestClock } from "./contest-clock.js";

export async function teamPhases(db: DB, contest: Row, owner: string) {
  if (isContestPractice(contest))
    return (["objective", "practical"] as const).map((section) => ({
      ...phaseWindow(contest, section),
      mode: "inherit" as const,
      status: "active" as const,
      practice: true,
      deadline_at: null,
    }));
  const attempts = owner.startsWith("t:")
    ? await db.query(
        "SELECT * FROM contest_attempts WHERE contest_id=$1 AND team_id=$2",
        [contest.id, owner.slice(2)],
      )
    : [];
  return (["objective", "practical"] as const).map((section) =>
    phaseWindow(
      contest,
      section,
      attempts.find((a) => a.section === section),
    ),
  );
}
export async function questionWindow(
  db: DB,
  contest: Row,
  challenge: Row,
  owner: string,
) {
  return (await teamPhases(db, contest, owner)).find(
    (p) => p.section === challengePhase(challenge),
  )!;
}
export function timingRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/contests/:id/timing", async (req) => {
    const user = requireUser(req),
      scope = id.parse((req.params as any).id);
    const contest = (await contestAccess(db, scope, user, false))!;
    const owner = await ownerFor(db, scope, user);
    const sections = await db.query(
      "SELECT DISTINCT CASE WHEN c.challenge_type='objective' THEN 'objective' ELSE 'practical' END section FROM challenges c JOIN contest_challenges cc ON cc.challenge_id=c.id WHERE cc.contest_id=$1",
      [scope],
    );
    return {
      phases: (await teamPhases(db, contest, owner)).filter((p) =>
        sections.some((s) => s.section === p.section),
      ),
      server_time: new Date().toISOString(),
      clock: await readContestClock(db, contest),
    };
  });
  app.post("/api/contests/:id/start/:section", async (req) => {
    const user = requireUser(req),
      scope = id.parse((req.params as any).id),
      section = phaseName.parse((req.params as any).section);
    return db.transaction(async (tx) => {
      const contest = (await contestAccess(tx, scope, user))!;
      if (isContestPractice(contest)) fail(403, "赛后练习无需开始计时");
      const owner = await ownerFor(tx, scope, user);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `attempt:${scope}:${owner}:${section}`,
      ]);
      const phase = (await teamPhases(tx, contest, owner)).find(
        (p) => p.section === section,
      )!;
      if (phase.status === "active") return phase;
      if (phase.status !== "ready") fail(403, "当前阶段不能开始作答");
      const now = new Date(),
        deadline = new Date(
          Math.min(
            +now + phase.duration_seconds! * 1000,
            Date.parse(phase.closes_at),
          ),
        );
      const [attempt] = await tx.query(
        "INSERT INTO contest_attempts(contest_id,team_id,section,started_at,deadline_at,started_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *",
        [scope, owner.slice(2), section, now, deadline, user.id],
      );
      return phaseWindow(contest, section, attempt);
    });
  });
}
