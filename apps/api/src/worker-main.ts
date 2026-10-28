import { startTerminalWorker } from "./terminal-worker.js";
import { setTimeout } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { openDB } from "./db.js";
import { config } from "./config.js";
import { AwdWorker } from "./awd-worker.js";
import { JudgeWorker } from "./judge-worker.js";
import { tickRounds } from "./rounds.js";
import { Worker } from "./worker.js";
import { ImageWorker } from "./image-worker.js";
if (!config.DATABASE_URL) throw Error("Worker requires shared PostgreSQL");
// One elected scheduler per Docker domain, with four concurrent provisioning tasks.
// The session lock fences competing schedulers; losing the connection terminates this process.
const leader = new pg.Client({
  connectionString: config.DATABASE_URL,
  keepAlive: true,
});
leader.on("error", () => process.exit(1));
await leader.connect();
const election = await leader.query(
  "SELECT pg_try_advisory_lock(760003) elected",
);
if (!election.rows[0].elected) {
  await leader.end();
  throw Error("A worker already owns this scheduling domain");
}
const db = await openDB(),
  worker = new Worker(db),
  judges = new JudgeWorker(db),
  awd = new AwdWorker(db),
  images = new ImageWorker(db);
const terminalServer = startTerminalWorker(db);
terminalServer.on("error", (error) => {
  console.error("terminal server failed", error.message);
  process.exit(1);
});
let running = true,
  iteration = 0;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    running = false;
    void images.stop();
  });
while (running) {
  try {
    await worker.ping();
    await worker.tick();
    await judges.tick();
    await awd.tick();
    if (iteration % 5 === 0) await tickRounds(db);
    await images
      .tick()
      .catch((e) =>
        console.error("image inventory failed", (e as Error).message),
      );
    if (iteration++ % 15 === 0) await worker.reconcile();
    await writeFile("/tmp/worker-health", String(Date.now()));
    if (iteration % 5 === 0) {
      await db.query(
        "INSERT INTO system_settings(key,value) VALUES('worker_heartbeat','{}') ON CONFLICT(key) DO UPDATE SET updated_at=now()",
      );
      await db.query("DELETE FROM email_verifications WHERE expires_at<now()");
    }
    if (iteration % 30 === 0) {
      await db.query(
        "UPDATE ai_calls SET status=504,elapsed_ms=LEAST(2147483647,extract(epoch FROM (expires_at-created_at))*1000)::int WHERE id IN (SELECT id FROM ai_calls WHERE status=0 AND expires_at<now() ORDER BY expires_at LIMIT 5000)",
      );
      await db.query(
        "DELETE FROM ai_calls WHERE id IN (SELECT id FROM ai_calls WHERE created_at<now()-interval '90 days' ORDER BY created_at LIMIT 5000)",
      );
    }
  } catch (e) {
    console.error("worker cycle failed", (e as Error).message);
  }
  await setTimeout(2000);
}
await worker.drain();
await judges.drain();
await awd.drain();
await images.stop();
for (const peer of terminalServer.clients) peer.terminate();
await new Promise<void>((resolve) => terminalServer.close(() => resolve()));
await db.close();
await leader.end();
