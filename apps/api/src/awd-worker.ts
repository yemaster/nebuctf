import { contestResourcePolicy } from "./contest-resource-limits.js";
import { permissionSQL } from "./group-permissions.js";
import { notifyContest } from "./activity-events.js";
import { resourceUsage } from "./resource-usage.js";
import type { DB, Row } from "./db.js";
import { DockerEngine } from "./docker.js";
import { dynamicFlag, flagHash, score } from "./security.js";
import { ensureRound } from "./rounds.js";
import { resourceProfiles } from "./challenge-model.js";
import { phaseWindow } from "./competition-rules.js";
import { activeStatuses } from "./resources.js";
import { config } from "./config.js";
import { runChecker } from "./judge-worker.js";

export class AwdWorker {
  private checks = new Map<string, Promise<void>>();
  private reconciledAt = 0;
  constructor(
    private db: DB,
    private docker = new DockerEngine(),
  ) {}
  async drain() {
    await Promise.allSettled(this.checks.values());
  }
  async tick() {
    if (Date.now() - this.reconciledAt > 30000) {
      // A completed check can leave a container behind if Docker cleanup was interrupted.
      const containers = await this.docker.listContainers(
        "io.nebuctf.awd-check",
      );
      for (const container of containers) {
        const checkId = container.Labels?.["io.nebuctf.awd-check"];
        if (checkId && !this.checks.has(checkId))
          await this.docker.removeContainer(container.Id).catch((error) => {
            if (error.statusCode !== 404) throw error;
          });
      }
      this.reconciledAt = Date.now();
    }
    const interrupted = await this.db.query(
      "SELECT id FROM awd_checks WHERE status='checking'",
    );
    for (const row of interrupted)
      if (!this.checks.has(row.id)) {
        const name = `nebuctf-check-${row.id}`;
        try {
          const info = await this.docker.inspectContainer(name);
          if (info.Config.Labels["io.nebuctf.awd-check"] === row.id)
            await this.docker.removeContainer(name);
        } catch (e) {
          if ((e as any).statusCode !== 404) throw e;
        }
        await this.db.query(
          "UPDATE awd_checks SET status='error',error='巡检中断',updated_at=now() WHERE id=$1",
          [row.id],
        );
      }
    const links = await this.db.query(
      `SELECT cc.*,row_to_json(c) challenge,row_to_json(g) contest FROM contest_challenges cc JOIN challenges c ON c.id=cc.challenge_id JOIN contests g ON g.id=cc.contest_id WHERE c.challenge_type='awd' AND cc.published AND c.published AND g.published AND cc.scoring->>'mode'='round' AND g.starts_at<=now() AND g.ends_at>now()-interval '6 hours'`,
    );
    for (const link of links) {
      const phase = phaseWindow(link.contest, "practical"),
        active = phase.status === "active";
      if (
        active &&
        (!link.release_at || new Date(link.release_at).getTime() <= Date.now())
      ) {
        await this.provision(link);
        const round = await ensureRound(this.db, link.contest, link);
        if (round) await this.scheduleChecks(link, round);
      }
      const rounds = await this.db.query(
        "SELECT * FROM contest_rounds WHERE contest_id=$1 AND challenge_id=$2 AND status='open' AND ends_at<=now() ORDER BY number",
        [link.contest_id, link.challenge_id],
      );
      for (const round of rounds) {
        const expiration =
          new Date(round.ends_at).getTime() +
          ((round.settings.round.flag_lifetime ?? 1) - 1) *
            round.settings.round.interval *
            1000;
        if (expiration > Date.now()) continue;
        await this.settle(link, round);
      }
    }
  }
  private async provision(link: Row) {
    const profile = resourceProfiles(link.challenge).container!,
      phase = phaseWindow(link.contest, "practical");
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(760002)");
      const teams = await tx.query(
        `SELECT r.team_id,t.captain_id FROM ranked_registrations r JOIN teams t ON t.id=r.team_id LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id=$1 AND ${permissionSQL("g", "$2::uuid", "view")} AND ${permissionSQL("g", "$2::uuid", "resources")} AND NOT EXISTS(SELECT 1 FROM instances i WHERE i.challenge_id=$2 AND i.scope=$1::text AND i.owner_key='t:'||r.team_id AND (i.status=ANY($3::text[]) OR (i.status='failed' AND i.updated_at>now()-interval '60 seconds'))) ORDER BY r.created_at`,
        [link.contest_id, link.challenge_id, activeStatuses],
      );
      const usage = await resourceUsage(tx);
      for (const team of teams) {
        if (
          usage!.n + 2 > config.MAX_INSTANCES ||
          usage!.cpu + profile.cpu + 250 > config.MAX_CPU ||
          usage!.memory + profile.memory + 128 > config.MAX_MEMORY
        )
          break;
        const owner = "t:" + team.team_id;
        const quota = await contestResourcePolicy(
          tx,
          link.contest_id,
          owner,
          "container",
        );
        if (quota?.blocked) continue;
        const [patch] = await tx.query(
          "SELECT id,result->>'image' image FROM judge_jobs WHERE challenge_id=$1 AND scope=$2 AND owner_key=$3 AND status='passed' AND result->>'image' IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
          [link.challenge_id, link.contest_id, owner],
        );
        const spec = {
          ...profile,
          image: patch?.image ?? profile.image,
          patch_job_id: patch?.id,
          awd: true,
          flag_mode: "static",
          ttl: Math.max(
            60,
            Math.ceil((Date.parse(phase.closes_at) - Date.now()) / 1000),
          ),
        };
        await tx.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,expires_at,max_expires_at,resource_type) VALUES($1,$2,$3,$4,$5,'dynamic_container','queued',$6,LEAST(now()+interval '5 minutes',$7::timestamptz),$7,'container')",
          [
            crypto.randomUUID(),
            link.challenge_id,
            link.contest_id,
            owner,
            team.captain_id,
            JSON.stringify(spec),
            phase.closes_at,
          ],
        );
        usage!.n += 2;
        usage!.cpu += profile.cpu + 250;
        usage!.memory += profile.memory + 128;
      }
    });
  }
  private async scheduleChecks(link: Row, round: Row) {
    const instances = await this.db.query(
      "SELECT * FROM instances WHERE challenge_id=$1 AND scope=$2 AND status='running'",
      [link.challenge_id, link.contest_id],
    );
    for (const instance of instances) {
      if (this.checks.size >= 4) break;
      const [exists] = await this.db.query(
        "SELECT * FROM awd_checks WHERE round_id=$1 AND owner_key=$2",
        [round.id, instance.owner_key],
      );
      if (exists) {
        if (exists.status === "checking" && !this.checks.has(exists.id))
          await this.db.query(
            "UPDATE awd_checks SET status='error',error='巡检中断',updated_at=now() WHERE id=$1",
            [exists.id],
          );
        // Restarted services must be checked again with the current round's flag.
        if (exists.instance_id !== instance.id && !this.checks.has(exists.id)) {
          await this.db.query(
            "UPDATE awd_checks SET instance_id=$2,status='checking',error=NULL,updated_at=now() WHERE id=$1",
            [exists.id, instance.id],
          );
          const work = this.check(link, round, instance, exists.id).finally(
            () => this.checks.delete(exists.id),
          );
          this.checks.set(exists.id, work);
        }
        continue;
      }
      const id = crypto.randomUUID();
      await this.db.query(
        "INSERT INTO awd_checks(id,round_id,instance_id,owner_key,status) VALUES($1,$2,$3,$4,'checking') ON CONFLICT DO NOTHING",
        [id, round.id, instance.id, instance.owner_key],
      );
      const promise = this.check(link, round, instance, id).finally(() =>
        this.checks.delete(id),
      );
      this.checks.set(id, promise);
    }
  }
  private async rotate(link: Row, round: Row, instance: Row) {
    const flag = dynamicFlag(
      link.challenge_id,
      link.contest_id,
      instance.owner_key,
      round.id,
      link.challenge.flag_template,
    );
    await this.docker.writeFlag(`nebuctf-${instance.id}`, flag);
    const expires = new Date(
      Math.min(
        Date.parse(phaseWindow(link.contest, "practical").closes_at),
        new Date(round.ends_at).getTime() +
          ((round.settings.round.flag_lifetime ?? 1) - 1) *
            round.settings.round.interval *
            1000,
      ),
    );
    await this.db.query(
      "INSERT INTO awd_flags(flag_hash,round_id,instance_id,owner_key,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [flagHash(flag), round.id, instance.id, instance.owner_key, expires],
    );
    return flag;
  }
  private async check(link: Row, round: Row, instance: Row, id: string) {
    try {
      const flag = await this.rotate(link, round, instance),
        network = `nebuctf-${instance.id}`;
      const info = await this.docker.inspectContainer(network),
        host = info.NetworkSettings.Networks[network]?.IPAddress;
      if (!host) throw Error("靶机不可用");
      const checker = link.challenge.awd_config;
      if (!checker) throw Error("未配置巡检镜像");
      const timeout = Math.min(
        checker.timeout,
        Math.floor((new Date(round.ends_at).getTime() - Date.now()) / 1000),
      );
      if (timeout < 1) throw Error("轮次已结束");
      const status = await runChecker(this.docker, {
        id: `nebuctf-check-${id}`,
        image: checker.checker_image,
        network,
        host,
        port: instance.spec.port,
        flag,
        mode: "availability",
        timeout,
        labels: { "io.nebuctf.awd-check": id },
      });
      await this.db.query(
        "UPDATE awd_checks SET status=$2,updated_at=now() WHERE id=$1",
        [id, status === 0 ? "up" : status === 1 ? "down" : "error"],
      );
    } catch {
      await this.db.query(
        "UPDATE awd_checks SET status='error',error='巡检执行失败',updated_at=now() WHERE id=$1",
        [id],
      );
    }
  }
  async settle(link: Row, round: Row) {
    await this.db.transaction(async (tx) => {
      const [state] = await tx.query(
        "SELECT status FROM contest_rounds WHERE id=$1 FOR UPDATE",
        [round.id],
      );
      if (state!.status === "settled") return;
      const [pending] = await tx.query(
        "SELECT 1 FROM awd_checks WHERE round_id=$1 AND status='checking'",
        [round.id],
      );
      if (pending) return;
      const attacks = await tx.query(
        "SELECT a.*,f.owner_key defender FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN ranked_registrations attacker ON attacker.contest_id=$2 AND 't:'||attacker.team_id=a.attacker_key JOIN ranked_registrations defender ON defender.contest_id=$2 AND 't:'||defender.team_id=f.owner_key WHERE f.round_id=$1",
        [round.id, link.contest_id],
      );
      const checks = await tx.query(
        "SELECT * FROM awd_checks WHERE round_id=$1",
        [round.id],
      );
      const teams = await tx.query(
        `SELECT r.team_id,${permissionSQL("g", "$3::uuid", "score")} get_score,${permissionSQL("g", "$3::uuid", "dynamic")} affect_dynamic FROM ranked_registrations r LEFT JOIN contest_groups g ON g.id=r.group_id WHERE r.contest_id=$1 AND r.created_at<$2`,
        [link.contest_id, round.ends_at, link.challenge_id],
      );
      const rules = round.settings.round,
        points = round.settings.points;
      const perAttack = score(
        points.initial_points,
        points.minimum_points,
        points.decay,
        new Set(
          attacks
            .filter((a) =>
              teams.some(
                (t) => t.affect_dynamic && "t:" + t.team_id === a.attacker_key,
              ),
            )
            .map((a) => a.attacker_key),
        ).size,
        rules.dynamic,
      );
      for (const team of teams) {
        const owner = "t:" + team.team_id,
          earned = attacks.filter((a) => a.attacker_key === owner),
          up = checks.find((c) => c.owner_key === owner)?.status === "up";
        const attack = team.get_score ? earned.length * perAttack : 0,
          defense =
            team.get_score && up && !attacks.some((a) => a.defender === owner)
              ? rules.defense_points
              : 0,
          availability = team.get_score && up ? rules.availability_points : 0;
        const members = new Map<string, number>();
        for (const a of earned)
          members.set(
            a.user_id,
            (members.get(a.user_id) ?? 0) + (team.get_score ? perAttack : 0),
          );
        await tx.query(
          "INSERT INTO round_results(id,round_id,owner_key,unit_id,points,details,created_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT DO NOTHING",
          [
            crypto.randomUUID(),
            round.id,
            owner,
            link.challenge_id,
            attack + defense + availability,
            JSON.stringify({
              kind: "awd",
              attack,
              defense,
              availability,
              health:
                checks.find((c) => c.owner_key === owner)?.status ?? "error",
              members: [...members].map(([user_id, points]) => ({
                user_id,
                points,
              })),
              team_points: defense + availability,
            }),
          ],
        );
      }
      await tx.query(
        "UPDATE contest_rounds SET status='settled',settled_at=now() WHERE id=$1",
        [round.id],
      );
      await notifyContest(tx, link.contest_id);
    });
  }
}
