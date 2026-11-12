import { openDB } from "./db.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { runScheduler } from "./scheduler.js";
const schedulerAbort = new AbortController();
const db = await openDB(),
  app = await buildApp(db, true);
// PGlite must have one process and one serialized DB handle. Development embeds
// the same scheduler; PostgreSQL development runs its standalone elected entrypoint.
const scheduling =
  config.NODE_ENV === "development" && !config.DATABASE_URL
    ? runScheduler(db, schedulerAbort.signal, (error) => app.log.error(error))
    : undefined;
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    if (closing) return;
    closing = true;
    schedulerAbort.abort();
    await app.close();
    await scheduling;
    await db.close();
    process.exit(0);
  });
await app.listen({ port: config.PORT, host: config.HOST });
