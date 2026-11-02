import { verified } from "./helpers/captcha.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { dynamicFlag, flagHash } from "../src/security.js";
import { containerConfig } from "../src/worker.js";

test("multi-part challenges, collections and contest workflow", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db, process.env.DEBUG_FEATURES === "1");
  const previousDir = config.DATA_DIR;
  config.DATA_DIR = await mkdtemp(join(tmpdir(), "nebuctf-features-"));
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(config.DATA_DIR, { recursive: true, force: true });
    config.DATA_DIR = previousDir;
  });
  const headers = { origin: config.APP_ORIGIN, "x-csrf-protection": "1" };
  const request = (
    method: "POST" | "PUT",
    url: string,
    cookie: string,
    payload: unknown,
  ) =>
    verified(app, {
      method,
      url: `/api${url}`,
      headers: { ...headers, cookie },
      payload: payload as any,
    });
  const get = (url: string, cookie = "") =>
    verified(app, { url: `/api${url}`, headers: { cookie } });
  async function user(name: string) {
    const r = await request("POST", "/auth/register", "", {
      username: name,
      email: `${name}@test.invalid`,
      password: "eight888",
    });
    assert.equal(r.statusCode, 200, r.body);
    return {
      id: r.json().user.id,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
    };
  }
  const admin = await user("adminx"),
    alice = await user("alicex"),
    bob = await user("bobx"),
    carol = await user("carolx");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  const basic = {
    title: "分步挑战",
    category: "Misc",
    difficulty: "入门",
    kind: "static_attachment",
    published: true,
    practice: true,
    dynamic_score: false,
    initial_points: 500,
    minimum_points: 100,
  };
  const partInput = [
    {
      title: "第一步",
      flag: "flag{one}",
      initial_points: 100,
      minimum_points: 50,
    },
    {
      title: "第二步",
      flag: "flag{two}",
      initial_points: 200,
      minimum_points: 100,
    },
  ];
  const created = await request("POST", "/admin/challenges", admin.cookie, {
    ...basic,
    parts: partInput,
  });
  assert.equal(created.statusCode, 200, created.body);
  const cid = created.json().id;
  const submit = (
    id: string,
    cookie: string,
    flag: string,
    scope = "practice",
  ) => request("POST", `/challenges/${id}/submit`, cookie, { flag, scope });
  await t.test(
    "eight-character passwords work and seven-character passwords fail",
    async () => {
      const bad = await request("POST", "/auth/register", "", {
        username: "shortpw",
        email: "short@test.invalid",
        password: "short77",
      });
      assert.equal(bad.statusCode, 400);
    },
  );
  await t.test(
    "auto-match parts, partial score, duplicate concurrency and full completion",
    async () => {
      const before = await get(`/challenges/${cid}`, alice.cookie);
      assert.equal(before.statusCode, 200, before.body);
      assert.equal(before.json().parts.length, 2);
      assert.equal(before.json().points, 300);
      assert.ok(!before.body.includes("flag_hash"));
      assert.ok(!before.body.includes("flag{one}"));
      const [one, ...duplicates] = await Promise.all(
        Array.from({ length: 4 }, () => submit(cid, alice.cookie, "flag{one}")),
      );
      assert.equal(one!.statusCode, 200, one!.body);
      assert.equal(one!.json().completed, false);
      assert.equal(duplicates.filter((r) => r.json().already_solved).length, 3);
      const progress = (await get(`/challenges/${cid}`, alice.cookie)).json();
      assert.equal(progress.solved_parts, 1);
      assert.equal(progress.solved, false);
      assert.equal(progress.earned_points, 100);
      const board = (await get("/scoreboard"))
        .json()
        .items.find((r: any) => r.name === "alicex");
      assert.equal(board.score, 100);
      assert.equal(board.solves, 0);
      assert.equal(board.flags, 1);
      assert.equal(
        (await submit(cid, alice.cookie, "wrong")).json().correct,
        false,
      );
      const final = (await submit(cid, alice.cookie, "flag{two}")).json();
      assert.equal(final.completed, true);
      assert.equal(final.solved_parts, 2);
      const [full] = await db.query(
        "SELECT count(*)::int n FROM solves WHERE challenge_id=$1",
        [cid],
      );
      assert.equal(full!.n, 1);
      assert.equal(
        (await submit(cid, alice.cookie, "still-wrong")).json().correct,
        false,
      );
      const history = await get("/submissions", alice.cookie);
      assert.ok(
        history.json().items.some((s: any) => s.part_title === "第二步"),
      );
    },
  );
  await t.test(
    "ambiguous flags and changes to credited parts are rejected",
    async () => {
      assert.equal(
        (
          await request("POST", "/admin/challenges", admin.cookie, {
            ...basic,
            parts: [partInput[0], { ...partInput[1], flag: "flag{one}" }],
          })
        ).statusCode,
        400,
      );
      const c = (await get("/admin/challenges", admin.cookie))
        .json()
        .items.find((c: any) => c.id === cid);
      assert.equal(
        (
          await request("PUT", `/admin/challenges/${cid}`, admin.cookie, {
            ...c,
            parts: c.parts.map((p: any, i: number) => ({
              ...p,
              initial_points: p.initial_points + (i ? 0 : 1),
            })),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await request("PUT", `/admin/challenges/${cid}`, admin.cookie, {
            ...c,
            title: "更新题面",
            parts: c.parts,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await request("PUT", `/admin/challenges/${cid}`, admin.cookie, {
            ...c,
            parts: [],
            flag: "flag{single}",
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "dynamic parts isolate owners and share a limited resource environment",
    async () => {
      const r = await request("POST", "/admin/challenges", admin.cookie, {
        ...basic,
        title: "动态分步",
        kind: "dynamic_container",
        image: "nebuctf/test:1",
        parts: partInput.map(({ flag, ...p }) => p),
      });
      assert.equal(r.statusCode, 200, r.body);
      const id = r.json().id;
      const c = (await get(`/challenges/${id}`, bob.cookie)).json();
      const started = await request(
        "POST",
        `/challenges/${id}/instances`,
        bob.cookie,
        {},
      );
      assert.equal(started.statusCode, 200, started.body);
      const [instance] = await db.query("SELECT * FROM instances WHERE id=$1", [
        started.json().id,
      ]);
      const spec = containerConfig(instance!);
      const values = JSON.parse(
        spec.Env.find((v: string) => v.startsWith("FLAGS_JSON=")).slice(11),
      );
      assert.equal(Object.keys(values).length, 2);
      assert.equal(
        values[c.parts[0].id],
        dynamicFlag(id, "practice", `u:${bob.id}`, c.parts[0].id),
      );
      assert.notEqual(values[c.parts[0].id], values[c.parts[1].id]);
      assert.equal(
        (await submit(id, carol.cookie, values[c.parts[0].id])).json().correct,
        false,
      );
      assert.equal(
        (await submit(id, bob.cookie, values[c.parts[0].id])).json().correct,
        true,
      );
      const oldMax = config.MAX_OWNER_INSTANCES;
      config.MAX_OWNER_INSTANCES = 1;
      try {
        const another = await request(
          "POST",
          "/admin/challenges",
          admin.cookie,
          {
            ...basic,
            title: "另一个环境",
            kind: "dynamic_container",
            image: "nebuctf/test:1",
          },
        );
        const limited = await request(
          "POST",
          `/challenges/${another.json().id}/instances`,
          bob.cookie,
          {},
        );
        assert.equal(limited.statusCode, 409);
        assert.equal(limited.json().action.href, "/instances?scope=practice");
      } finally {
        config.MAX_OWNER_INSTANCES = oldMax;
      }
    },
  );
  await t.test(
    "each small question decays using its own solve count",
    async () => {
      const made = await request("POST", "/admin/challenges", admin.cookie, {
        ...basic,
        title: "独立衰减",
        dynamic_score: true,
        decay: 2,
        parts: partInput,
      });
      const id = made.json().id;
      await submit(id, bob.cookie, "flag{one}");
      assert.equal((await get(`/challenges/${id}`)).json().parts[0].points, 88);
      await submit(id, carol.cookie, "flag{one}");
      const c = (await get(`/challenges/${id}`)).json();
      assert.equal(c.parts[0].points, 50);
      assert.equal(c.parts[1].points, 200);
      assert.equal(c.points, 250);
    },
  );
  let contest = "",
    contestChallenge = "",
    team1: any,
    team2: any,
    groups: any[] = [];
  await t.test(
    "team selection, contest groups and overlapping memberships are enforced",
    async () => {
      team1 = (
        await request("POST", "/teams", alice.cookie, { name: "First Team" })
      ).json();
      team2 = (
        await request("POST", "/teams", alice.cookie, { name: "Second Team" })
      ).json();
      assert.ok(team2.id);
      assert.equal(
        (
          await request("POST", "/team/join", bob.cookie, {
            invite: team2.invite,
          })
        ).statusCode,
        200,
      );
      const challenge = await request(
        "POST",
        "/admin/challenges",
        admin.cookie,
        { ...basic, practice: false, title: "比赛多小题", parts: partInput },
      );
      contestChallenge = challenge.json().id;
      const r = await request("POST", "/admin/contests", admin.cookie, {
        title: "Grouped",
        starts_at: new Date(Date.now() - 3600000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
        published: true,
        challenge_ids: [contestChallenge],
        groups: [{ name: "校内组" }, { name: "公开组" }],
      });
      assert.equal(r.statusCode, 200, r.body);
      contest = r.json().id;
      groups = (await get(`/contests/${contest}`, alice.cookie)).json().groups;
      const missing = await request(
        "POST",
        `/contests/${contest}/register`,
        carol.cookie,
        {},
      );
      assert.equal(missing.statusCode, 403);
      assert.equal(missing.json().action.href, "/team");
      assert.equal(
        (
          await request("POST", `/contests/${contest}/register`, bob.cookie, {
            team_id: team2.id,
            group_id: groups[0].id,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await request("POST", `/contests/${contest}/register`, alice.cookie, {
            team_id: team2.id,
            group_id: crypto.randomUUID(),
          })
        ).statusCode,
        400,
      );
      const ok = await request(
        "POST",
        `/contests/${contest}/register`,
        alice.cookie,
        { team_id: team2.id, group_id: groups[0].id },
      );
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(
        (
          await request("POST", `/contests/${contest}/register`, alice.cookie, {
            team_id: team1.id,
            group_id: groups[1].id,
          })
        ).statusCode,
        409,
      );
      const details = (await get(`/contests/${contest}`, alice.cookie)).json();
      assert.equal(details.registration.team_id, team2.id);
      assert.equal(details.registration.group_name, "校内组");
      assert.equal(
        (await submit(contestChallenge, bob.cookie, "flag{one}", contest))
          .statusCode,
        200,
      );
      const [s] = await db.query(
        "SELECT owner_key FROM part_solves WHERE challenge_id=$1",
        [contestChallenge],
      );
      assert.equal(s!.owner_key, `t:${team2.id}`);
      assert.equal(
        (await get(`/scoreboard?scope=${contest}&group=${groups[0].id}`)).json()
          .items[0].score,
        100,
      );
      assert.equal(
        (await get(`/scoreboard?scope=${contest}&group=${groups[1].id}`)).json()
          .items.length,
        0,
      );
      assert.equal(
        (
          await request("POST", "/team/leave", bob.cookie, {
            team_id: team2.id,
          })
        ).statusCode,
        409,
      );
      const adminContest = (await get("/admin/contests", admin.cookie))
        .json()
        .items.find((c: any) => c.id === contest);
      assert.equal(
        (
          await request("PUT", `/admin/contests/${contest}`, admin.cookie, {
            ...adminContest,
            groups: [],
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "freeze keeps personal progress live while hiding late part scores and aggregate counts",
    async () => {
      await db.query(
        "UPDATE part_solves SET created_at=now()-interval '2 minutes' WHERE challenge_id=$1",
        [contestChallenge],
      );
      await db.query(
        "UPDATE contests SET freeze_at=now()-interval '1 minute' WHERE id=$1",
        [contest],
      );
      assert.equal(
        (
          await submit(contestChallenge, alice.cookie, "flag{two}", contest)
        ).json().completed,
        true,
      );
      const r = await get(
        `/challenges/${contestChallenge}?scope=${contest}`,
        alice.cookie,
      );
      assert.equal(r.statusCode, 200, r.body);
      const c = r.json();
      assert.equal(c.solved_parts, 2);
      assert.equal(c.solves, 0);
      assert.equal(c.parts[1].solves, 0);
      const board = (await get(`/scoreboard?scope=${contest}`)).json();
      assert.equal(board.frozen, true);
      assert.equal(board.items[0].score, 100);
      assert.equal(board.items[0].solves, 0);
      await db.query(
        // End after the latest submission; moving the deadline into its past would
        // correctly exclude it from the final official score.
        "UPDATE contests SET ends_at=now() WHERE id=$1",
        [contest],
      );
      assert.equal(
        (await get(`/scoreboard?scope=${contest}`)).json().items[0].score,
        300,
      );
    },
  );
  await t.test(
    "large practice catalog and ordered problemsets paginate without leaking unpublished content",
    async () => {
      const ids: string[] = [];
      for (let i = 0; i < 27; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice) VALUES($1,$2,'Web','简单','static_attachment',$3,true,true)",
          [id, `分页练习${i}`, flagHash(`flag{page${i}}`)],
        );
      }
      const first = (await get("/challenges?q=分页练习&page=1")).json(),
        second = (await get("/challenges?q=分页练习&page=2")).json();
      assert.equal(first.total, 27);
      assert.equal(first.items.length, 24);
      assert.equal(second.items.length, 3);
      assert.equal(
        new Set([...first.items, ...second.items].map((c) => c.id)).size,
        27,
      );
      const draft = crypto.randomUUID();
      await db.query(
        "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,published,practice) VALUES($1,'PRIVATE','Web','简单','static_attachment','',false,true)",
        [draft],
      );
      const made = await request("POST", "/admin/problemsets", admin.cookie, {
        title: "题单",
        published: true,
        challenge_ids: [cid, ...ids.reverse(), draft],
      });
      assert.equal(made.statusCode, 200, made.body);
      const pid = made.json().id;
      const a = (await get(`/problemsets/${pid}?page=1`, alice.cookie)).json(),
        b = (await get(`/problemsets/${pid}?page=2`, alice.cookie)).json();
      assert.equal(a.total, 28);
      assert.equal(a.completed, 1);
      assert.equal(a.items[0].id, cid);
      assert.equal(a.items[1].id, ids[0]);
      assert.equal(b.items.length, 4);
      assert.ok(!JSON.stringify([a, b]).includes("PRIVATE"));
      const filtered = (
        await get(
          `/problemsets/${pid}?q=${encodeURIComponent("分页练习2")}&category=Web`,
          alice.cookie,
        )
      ).json();
      assert.equal(filtered.total, 28);
      assert.equal(filtered.completed, 1);
      assert.equal(filtered.filtered_total, 8);
      assert.deepEqual(
        filtered.items.map((c: { id: string }) => c.id),
        ids.filter((_, i) => i < 7 || i === 24),
      );
      const empty = (
        await get(
          `/problemsets/${pid}?q=${encodeURIComponent("分页练习2")}&page=3`,
        )
      ).json();
      assert.equal(empty.filtered_total, 8);
      assert.equal(empty.items.length, 0);
      assert.equal(
        (await get(`/problemsets/${pid}?category=Reverse`)).json()
          .filtered_total,
        0,
      );
      assert.equal(
        (await get(`/problemsets/${pid}?q=%25`)).json().filtered_total,
        0,
      );
      assert.equal(
        (
          await request("POST", "/admin/problemsets", alice.cookie, {
            title: "no",
          })
        ).statusCode,
        403,
      );
      const hidden = (
        await request("POST", "/admin/problemsets", admin.cookie, {
          title: "hidden",
          published: false,
        })
      ).json().id;
      assert.equal((await get(`/problemsets/${hidden}`)).statusCode, 404);
    },
  );
  await t.test(
    "calendar respects local midnight and poster upload validates content and visibility",
    async () => {
      const r = await request("POST", "/admin/contests", admin.cookie, {
        title: "跨天比赛",
        starts_at: "2001-11-01T15:00:00Z",
        ends_at: "2001-11-01T17:00:00Z",
        published: true,
      });
      assert.equal(r.statusCode, 200, r.body);
      const id = r.json().id;
      const calendar = await get(
        "/contests/calendar?from=2001-11-01&to=2001-11-03&zone=Asia%2FShanghai",
      );
      assert.equal(calendar.statusCode, 200, calendar.body);
      assert.deepEqual(
        calendar.json().days.map((d: any) => d.count),
        [1, 1, 0],
      );
      assert.deepEqual(calendar.json().days[0].contests, [
        { id, title: "跨天比赛" },
      ]);
      assert.deepEqual(calendar.json().days[2].contests, []);
      assert.equal(
        (
          await get(
            "/contests?from=2001-11-01T16%3A00%3A00Z&to=2001-11-02T16%3A00%3A00Z",
          )
        ).json().total,
        1,
      );
      const upload = async (content: Buffer) => {
        const boundary = "FeatureBoundary";
        return verified(app, {
          method: "POST",
          url: `/api/admin/contests/${id}/poster`,
          headers: {
            ...headers,
            cookie: admin.cookie,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload: Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="poster.png"\r\nContent-Type: image/png\r\n\r\n`,
            ),
            content,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]),
        });
      };
      assert.equal(
        (await upload(Buffer.from("<svg onload='alert(1)'></svg>"))).statusCode,
        400,
      );
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
        "base64",
      );
      assert.equal((await upload(png)).statusCode, 200);
      const image = await get(`/contests/${id}/poster`);
      assert.equal(image.statusCode, 200);
      assert.equal(image.headers["content-type"], "image/png");
      await db.query("UPDATE contests SET published=false WHERE id=$1", [id]);
      assert.equal((await get(`/contests/${id}/poster`)).statusCode, 404);
    },
  );
  await t.test(
    "schema replay preserves legacy and multi-part progress",
    async () => {
      const schema = await readFile(
        new URL("../src/schema.sql", import.meta.url),
        "utf8",
      );
      await db.transaction(async (tx) => {
        for (const statement of schema.split(";").filter((s) => s.trim()))
          await tx.query(statement);
      });
      const r = await get(`/challenges/${cid}`, alice.cookie);
      assert.equal(r.json().solved_parts, 2);
      assert.equal(
        (await get("/teams/mine", alice.cookie)).json().items.length,
        2,
      );
    },
  );
});
