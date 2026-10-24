import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { config } from "./config.js";
interface Embedded {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: Embedded) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type Row = Record<string, any>;
export interface DB {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  subscribe?(
    onNotification: (scope: string) => void,
  ): Promise<() => Promise<void>>;
}
export async function openDB(memory = false): Promise<DB> {
  let db: DB;
  if (config.DATABASE_URL && !memory) {
    const pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    const wrap = (client: pg.Pool | pg.PoolClient): DB => ({
      query: async (sql, params) => (await client.query(sql, params)).rows,
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(wrap(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    });
    db = wrap(pool);
    db.subscribe = async (onNotification) => {
      let client: pg.Client | undefined,
        timer: ReturnType<typeof setTimeout> | undefined,
        closed = false,
        connecting = false;
      const connect = async () => {
        if (closed || connecting) return;
        connecting = true;
        const next = new pg.Client({
          connectionString: config.DATABASE_URL,
          keepAlive: true,
        });
        client = next;
        const retry = () => {
          if (closed || timer) return;
          timer = setTimeout(() => {
            timer = undefined;
            void connect();
          }, 2000);
          timer.unref();
        };
        next.on("error", () => {
          void next.end().catch(() => {});
          retry();
        });
        next.on("end", retry);
        next.on("notification", (message) => {
          if (message.channel === "nebuctf_activity" && message.payload)
            onNotification(message.payload);
        });
        try {
          await next.connect();
          if (closed) {
            await next.end();
            return;
          }
          await next.query("LISTEN nebuctf_activity");
        } catch {
          await next.end().catch(() => {});
          retry();
        } finally {
          connecting = false;
        }
      };
      await connect();
      return async () => {
        closed = true;
        if (timer) clearTimeout(timer);
        await client?.end().catch(() => {});
      };
    };
  } else {
    const { PGlite } = createRequire(import.meta.url)(
      "@electric-sql/pglite",
    ) as { PGlite: new (path?: string) => Embedded };
    const p = new PGlite(memory ? undefined : `${config.DATA_DIR}/pg`);
    // Serialize all embedded access so an HTTP read cannot enter another request's transaction.
    let queue: Promise<unknown> = Promise.resolve();
    const locked = <T>(fn: () => Promise<T>): Promise<T> => {
      const result = queue.then(fn);
      queue = result.catch(() => {});
      return result;
    };
    const wrap = (client: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    }): DB => ({
      query: async (sql, params) =>
        (await client.query(sql, params)).rows as any,
      transaction: async () => {
        throw Error("nested transaction");
      },
      close: async () => {},
    });
    db = {
      query: (sql, params) => locked(() => wrap(p).query(sql, params)),
      transaction: (fn) => locked(() => p.transaction((tx) => fn(wrap(tx)))),
      close: () => p.close(),
    };
  }
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(760001)");
    for (const statement of schema.split(";").filter((s) => s.trim()))
      await tx.query(statement);
  });
  return db;
}
export async function audit(
  db: DB,
  actor: string,
  action: string,
  target: string,
) {
  await db.query(
    "INSERT INTO audit_logs(id,actor_id,action,target) VALUES($1,$2,$3,$4)",
    [crypto.randomUUID(), actor, action, target],
  );
}
export async function lock(db: DB, key = 760002) {
  await db.query("SELECT pg_advisory_xact_lock($1)", [key]);
}
