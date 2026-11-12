import { writeFile } from "node:fs/promises";
import pg from "pg";
import { config } from "./config.js";
import { openDB, type DB } from "./db.js";
import { runScheduler } from "./scheduler.js";

if (!config.DATABASE_URL) throw Error("Scheduler requires shared PostgreSQL");
// This session owns non-execution scheduling, independently of runtime 760003.
// Connection loss must terminate in-flight work, not merely stop future ticks.
const leader = new pg.Client({
  connectionString: config.DATABASE_URL,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 15000,
});
let ending = false;
const lostLeadership = (error: Error) => {
  if (ending) return;
  console.error("scheduler leadership lost", error.message);
  process.exit(1);
};
leader.on("error", lostLeadership);
leader.on("end", () => lostLeadership(Error("leader connection ended")));
await leader.connect();
let db: DB | undefined;
try {
  const election = await leader.query(
    "SELECT pg_try_advisory_lock(760004) elected",
  );
  if (!election.rows[0].elected)
    throw Error("A scheduler already owns this scheduling domain");
  db = await openDB();
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => controller.abort());
  await runScheduler(
    db,
    controller.signal,
    (error) => console.error("scheduler job failed", error),
    {
      checkLeadership: async () => {
        // Also detect a silently broken session before admitting another cycle.
        await leader.query("SELECT 1");
      },
      heartbeat: () => writeFile("/tmp/scheduler-health", String(Date.now())),
    },
  );
} finally {
  await db?.close();
  ending = true;
  await leader.end();
}
