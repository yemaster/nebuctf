import type { FastifyInstance } from "fastify";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DB } from "./db.js";
import { audit } from "./db.js";
import { requireAdmin } from "./auth.js";
import { id, page } from "./schemas.js";
import { fail } from "./security.js";
import { config } from "./config.js";
import { getSetting } from "./settings.js";
import { captureFilename } from "./traffic-worker.js";
import { allowedIds } from "./access-control.js";

export function trafficRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/admin/traffic/contests", async (req) => {
    const user = requireAdmin(req),
      p = page.parse(req.query),
      ids = allowedIds(user, "traffic.read");
    const where =
      "($1='' OR title ILIKE '%'||$1||'%') AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[]))";
    return {
      total: (
        await db.query(
          `SELECT count(*)::int total FROM contests WHERE ${where}`,
          [p.q, ids],
        )
      )[0]!.total,
      items: await db.query(
        `SELECT id,title,(SELECT count(*)::int FROM instances i WHERE i.scope=c.id::text AND i.status='running' AND i.resource_type='container') running FROM contests c WHERE ${where} ORDER BY starts_at DESC,id LIMIT 10 OFFSET $3`,
        [p.q, ids, (p.page - 1) * 10],
      ),
    };
  });
  const scope = async (value: string) => {
    const [contest] = await db.query(
      "SELECT id,title,traffic_mode FROM contests WHERE id=$1",
      [id.parse(value)],
    );
    if (!contest) fail(404, "比赛不存在");
    return contest!;
  };
  const rates = `CASE WHEN i.status='running' AND t.sampled_at>now()-interval '3 minutes' THEN t.rx_rate ELSE 0 END rx_rate,CASE WHEN i.status='running' AND t.sampled_at>now()-interval '3 minutes' THEN t.tx_rate ELSE 0 END tx_rate`;
  app.get("/api/admin/contests/:id/traffic/context", async (req) => {
    requireAdmin(req);
    const [contest] = await db.query(
      "SELECT id,title,starts_at,ends_at FROM contests WHERE id=$1",
      [id.parse((req.params as any).id)],
    );
    if (!contest) fail(404, "比赛不存在");
    return {
      ...contest,
      groups: [],
      registered: false,
      spectator_scoreboard: false,
      spectator_enabled: false,
    };
  });
  app.get("/api/admin/contests/:id/traffic", async (req) => {
    requireAdmin(req);
    const contest = await scope((req.params as any).id),
      p = page.parse(req.query),
      policy = await getSetting(db, "traffic");
    const from = `FROM instances i JOIN instance_traffic t ON t.instance_id=i.id JOIN teams team ON i.owner_key='t:'||team.id JOIN challenges c ON c.id=i.challenge_id WHERE i.scope=$1 AND ($2='' OR strpos(lower(team.name||' '||c.title),lower($2))>0)`;
    const args = [contest.id, p.q];
    const [summary] = await db.query(
      `SELECT count(*)::int total,coalesce(sum(t.rx_bytes),0)::text received,coalesce(sum(t.tx_bytes),0)::text sent,coalesce(sum(CASE WHEN i.status='running' AND t.sampled_at>now()-interval '3 minutes' THEN t.rx_rate ELSE 0 END),0) rx_rate,coalesce(sum(CASE WHEN i.status='running' AND t.sampled_at>now()-interval '3 minutes' THEN t.tx_rate ELSE 0 END),0) tx_rate ${from}`,
      args,
    );
    return {
      contest,
      policy,
      summary,
      total: summary!.total,
      items: await db.query(
        `SELECT i.id,i.status,i.endpoint,c.title,team.name team_name,t.rx_bytes::text,t.tx_bytes::text,t.sampled_at,t.capture_status,t.capture_error,${rates},(SELECT count(*)::int FROM traffic_files f WHERE f.instance_id=i.id) files ${from} ORDER BY (i.status='running') DESC,team.name,c.title,i.created_at DESC LIMIT 10 OFFSET $3`,
        [...args, (p.page - 1) * 10],
      ),
    };
  });
  app.put("/api/admin/contests/:id/traffic/policy", async (req) => {
    const user = requireAdmin(req),
      contest = await scope((req.params as any).id),
      data = z
        .object({ mode: z.enum(["inherit", "off", "stats", "capture"]) })
        .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE contests SET traffic_mode=$2 WHERE id=$1", [
        contest.id,
        data.mode,
      ]);
      await audit(tx, user.id, "traffic.policy", contest.id);
    });
    return { ok: true };
  });
  app.get(
    "/api/admin/contests/:id/traffic/instances/:instance",
    async (req) => {
      requireAdmin(req);
      const contest = await scope((req.params as any).id),
        iid = id.parse((req.params as any).instance),
        p = page.parse(req.query);
      const [instance] = await db.query(
        `SELECT i.id,i.status,i.endpoint,c.title,team.name team_name,t.rx_bytes::text,t.tx_bytes::text,t.sampled_at,t.capture_status,t.capture_error,${rates} FROM instances i JOIN instance_traffic t ON t.instance_id=i.id JOIN teams team ON i.owner_key='t:'||team.id JOIN challenges c ON c.id=i.challenge_id WHERE i.id=$1 AND i.scope=$2`,
        [iid, contest.id],
      );
      if (!instance) fail(404, "监测记录不存在");
      return {
        contest,
        instance,
        total: (
          await db.query(
            "SELECT count(*)::int total FROM traffic_files WHERE instance_id=$1",
            [iid],
          )
        )[0]!.total,
        files: await db.query(
          "SELECT id,size::text,created_at FROM traffic_files WHERE instance_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET $2",
          [iid, (p.page - 1) * 10],
        ),
        timeline: await db.query(
          "SELECT bucket,rx_bytes::text,tx_bytes::text FROM traffic_samples WHERE instance_id=$1 AND bucket>now()-interval '1 hour' ORDER BY bucket",
          [iid],
        ),
      };
    },
  );
  app.get("/api/admin/contests/:id/traffic/files/:file", async (req, reply) => {
    const user = requireAdmin(req),
      contest = await scope((req.params as any).id),
      fid = id.parse((req.params as any).file);
    const [file] = await db.query(
      "SELECT f.* FROM traffic_files f JOIN instances i ON i.id=f.instance_id WHERE f.id=$1 AND i.scope=$2",
      [fid, contest.id],
    );
    if (!file || !captureFilename.test(file.name))
      return fail(404, "抓包文件不存在");
    let handle;
    try {
      handle = await open(
        join(config.TRAFFIC_DIR, file.instance_id, file.name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return fail(404, "抓包文件已轮转或清理");
      throw e;
    }
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== Number(file.size)) {
      await handle.close();
      return fail(409, "抓包文件状态已变化，请刷新");
    }
    try {
      await audit(db, user.id, "traffic.download", `${contest.id}:${fid}`);
    } catch (e) {
      await handle.close();
      throw e;
    }
    return reply
      .header("Content-Type", "application/vnd.tcpdump.pcap")
      .header(
        "Content-Disposition",
        `attachment; filename="capture-${file.instance_id}-${fid}.pcap"`,
      )
      .header("Content-Length", stat.size)
      .send(handle.createReadStream());
  });
}
