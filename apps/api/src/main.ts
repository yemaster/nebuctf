import { openDB } from "./db.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { publishScheduledChallenges } from "./challenge-publication.js";
import { publishNotificationReminders } from "./notifications.js";
const db = await openDB(),
  app = await buildApp(db, true);
const gc = setInterval(
  () =>
    db
      .query("DELETE FROM sessions WHERE expires_at<now()")
      .then(() => db.query("DELETE FROM rate_limits WHERE expires_at<now()"))
      .then(() => db.query("DELETE FROM captcha_uses WHERE expires_at<now()"))
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
let reminders: Promise<unknown> | undefined;
const remind = () => {
  if (reminders) return;
  reminders = publishNotificationReminders(db)
    .catch((err) => app.log.error(err))
    .finally(() => {
      reminders = undefined;
    });
};
remind();
const reminderTimer = setInterval(remind, 30000);
reminderTimer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    clearInterval(gc);
    clearInterval(publisher);
    clearInterval(reminderTimer);
    await app.close();
    await publication;
    await reminders;
    await db.close();
    process.exit(0);
  });
await app.listen({ port: config.PORT, host: config.HOST });
