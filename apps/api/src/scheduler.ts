import { setTimeout as delay } from "node:timers/promises";
import type { DB } from "./db.js";
import { publishScheduledChallenges } from "./challenge-publication.js";
import { publishNotificationReminders } from "./notifications.js";
import { tickRounds } from "./rounds.js";

// One serial loop bounds pending work: slow jobs never create overlapping ticks
// or a backlog. Aborting drains the current job before the caller closes its DB.
export async function runScheduler(
  db: DB,
  signal: AbortSignal,
  onError: (error: unknown) => void,
  lifecycle: {
    checkLeadership?: () => Promise<void>;
    heartbeat?: () => Promise<void>;
  } = {},
) {
  const tasks = [
    {
      every: 2000,
      next: 0,
      run: () => publishScheduledChallenges(db),
    },
    {
      every: 30000,
      next: 0,
      run: () => publishNotificationReminders(db),
    },
    {
      every: 10000,
      next: 0,
      run: () => tickRounds(db),
    },
    {
      every: 300000,
      next: 0,
      run: async () => {
        await db.query("DELETE FROM sessions WHERE expires_at<now()");
        await db.query("DELETE FROM rate_limits WHERE expires_at<now()");
        await db.query("DELETE FROM captcha_uses WHERE expires_at<now()");
      },
    },
    {
      every: 10000,
      next: 0,
      run: () =>
        db.query("DELETE FROM email_verifications WHERE expires_at<now()"),
    },
    {
      every: 60000,
      next: 0,
      run: async () => {
        await db.query(
          "UPDATE ai_calls SET status=504,elapsed_ms=LEAST(2147483647,extract(epoch FROM (expires_at-created_at))*1000)::int WHERE id IN (SELECT id FROM ai_calls WHERE status=0 AND expires_at<now() ORDER BY expires_at LIMIT 5000)",
        );
        await db.query(
          "DELETE FROM ai_calls WHERE id IN (SELECT id FROM ai_calls WHERE created_at<now()-interval '90 days' ORDER BY created_at LIMIT 5000)",
        );
      },
    },
  ];
  while (!signal.aborted) {
    await lifecycle.checkLeadership?.();
    const now = Date.now();
    let healthy = true;
    for (const task of tasks) {
      if (signal.aborted) break;
      if (task.next > now) continue;
      task.next = now + task.every;
      try {
        await task.run();
      } catch (error) {
        healthy = false;
        onError(error);
      }
    }
    if (signal.aborted) break;
    if (healthy) await lifecycle.heartbeat?.();
    try {
      await delay(2000, undefined, { signal, ref: false });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
