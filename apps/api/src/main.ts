import { openDB } from "./db.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { publishScheduledChallenges } from "./challenge-publication.js";
const db = await openDB(),
  app = await buildApp(db, true);
const gc = setInterval(
  () =>
    db
      .query("DELETE FROM sessions WHERE expires_at<now()")
      .then(() => db.query("DELETE FROM rate_limits WHERE expires_at<now()"))
      .catch((err) => app.log.error(err)),
  300000,
);
gc.unref();
let publication: Promise<unknown> | undefined;
const publish = () => {
  if (publication) return;
  publication = publishScheduledChallenges(db)
    .catch((err) => app.log.error(err))
    .finally(() => {
      publication = undefined;
    });
};
publish();
const publisher = setInterval(publish, 2000);
publisher.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    clearInterval(gc);
    clearInterval(publisher);
    await app.close();
    await publication;
    await db.close();
    process.exit(0);
  });
await app.listen({ port: config.PORT, host: config.HOST });
