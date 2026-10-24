import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { flagHash } from "../src/security.js";
import { publishScheduledChallenges } from "../src/challenge-publication.js";

test("admin pages, pagination, registration counts and scheduled publishing", async (t) => {
  const db = await openDB(process.env.TEST_POSTGRES !== "1"),
    app = await buildApp(db);
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const get = (path: string, cookie = "") =>
    app.inject({ url: `/api${path}`, headers: { cookie } });
  const write = (
    path: string,
    cookie: string,
    payload: unknown,
    method: "POST" | "PUT" = "POST",
  ) =>
    app.inject({
      url: `/api${path}`,
      method,
      headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
      payload: payload as any,
    });
  async function user(name: string) {
    const r = await write("/auth/register", "", {
      username: name,
      email: `${name}@example.test`,
      password: "eight888",
    });
    assert.equal(r.statusCode, 200, r.body);
    return {
      id: r.json().user.id,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
    };
  }
  const admin = await user("opsadmin"),
    alice = await user("opsalice"),
    bob = await user("opsbob"),
    carol = await user("opscarol");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  const first = (
      await write("/teams", alice.cookie, { name: "Ops One" })
    ).json(),
    second = (await write("/teams", carol.cookie, { name: "Ops Two" })).json();
  assert.equal(
    (await write("/team/join", bob.cookie, { invite: first.invite }))
      .statusCode,
    200,
  );
  const settings = {
    title: "Count Check",
    published: true,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
  };
  const cid = (await write("/admin/contests", admin.cookie, settings)).json()
    .id;
  const other = (
    await write("/admin/contests", admin.cookie, {
      ...settings,
      title: "Other Count",
    })
  ).json().id;
  await t.test(
    "detail counts teams, includes zero, agrees with the list and updates after registration/cancellation",
    async () => {
      const count = async (n: number) => {
        for (const cookie of ["", alice.cookie, admin.cookie]) {
          const detail = await get(`/contests/${cid}`, cookie);
          assert.equal(detail.statusCode, 200);
          assert.equal(detail.json().teams, n);
        }
        const listing = (await get("/contests")).json();
        assert.equal(listing.items.find((c: any) => c.id === cid).teams, n);
      };
      await count(0);
      assert.equal(
        (
          await write(`/contests/${cid}/register`, alice.cookie, {
            team_id: first.id,
          })
        ).statusCode,
        200,
      );
      await count(1);
      assert.equal(
        (
          await write(`/contests/${cid}/register`, carol.cookie, {
            team_id: second.id,
          })
        ).statusCode,
        200,
      );
      await count(2);
      assert.equal(
        (
          await write(`/contests/${cid}/register`, alice.cookie, {
            team_id: first.id,
          })
        ).statusCode,
        409,
      );
      await count(2);
      assert.equal((await get(`/contests/${other}`)).json().teams, 0);
      assert.equal(
        (await write(`/contests/${cid}/unregister`, alice.cookie, {}))
          .statusCode,
        200,
      );
      await count(1);
    },
  );
  const ids: string[] = [];
  await t.test(
    "admin paging is stable, filters before pagination, and detail endpoints protect secrets",
    async () => {
      for (let i = 0; i < 29; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await db.query(
          "INSERT INTO challenges(id,title,category,difficulty,kind,flag_hash,practice,published) VALUES($1,$2,'Misc','入门','static_attachment',$3,true,true)",
          [
            id,
            `Paging ${String(i).padStart(2, "0")}`,
            flagHash("flag{hidden}"),
          ],
        );
      }
      const a = (
          await get("/admin/challenges?q=Paging&page=1", admin.cookie)
        ).json(),
        b = (
          await get("/admin/challenges?q=Paging&page=2", admin.cookie)
        ).json(),
        empty = (
          await get("/admin/challenges?q=Paging&page=3", admin.cookie)
        ).json();
      assert.equal(a.items.length, 24);
      assert.equal(b.items.length, 5);
      assert.equal(a.total, 29);
      assert.equal(empty.total, 29);
      assert.equal(empty.items.length, 0);
      assert.equal(new Set([...a.items, ...b.items].map((c) => c.id)).size, 29);
      assert.equal(
        (
          await get("/admin/challenges?q=Paging&practice=false", admin.cookie)
        ).json().total,
        0,
      );
      const selected = (
        await get(
          `/admin/challenges?ids=${ids[28]},${ids[0]}&page_size=1&page=2`,
          admin.cookie,
        )
      ).json();
      assert.equal(selected.total, 2);
      assert.equal(selected.items.length, 1);
      assert.equal(selected.items[0].id, ids[0]);
      // A 500-item selection is sent in the body, not a URL exceeding proxy limits.
      const selection = await write("/admin/challenges/search", admin.cookie, {
        ids: [
          ...ids,
          ...Array.from({ length: 471 }, () => crypto.randomUUID()),
        ].join(","),
        page_size: 12,
        page: 3,
      });
      assert.equal(selection.statusCode, 200, selection.body);
      assert.equal(selection.json().total, 29);
      assert.equal(selection.json().items.length, 5);
      assert.equal(
        (
          await write("/admin/challenges/search", alice.cookie, {
            ids: ids.join(","),
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await get("/admin/challenges?page_size=101", admin.cookie)).statusCode,
        400,
      );
      const detail = (
        await get(`/admin/challenges/${ids[28]}`, admin.cookie)
      ).json();
      assert.equal(detail.title, "Paging 28");
      assert.ok(!("flag_hash" in detail));
      for (const path of [
        `/admin/challenges/${ids[0]}`,
        `/admin/contests/${cid}`,
        "/admin/articles",
        "/admin/learning/trees",
        "/admin/problemsets",
        "/admin/announcements",
      ]) {
        assert.equal((await get(path, alice.cookie)).statusCode, 403);
        assert.equal((await get(path)).statusCode, 401);
      }
    },
  );
  await t.test(
    "contests can select practice questions in order with independent settings",
    async () => {
      const selected = [ids[28]!, ids[0]!];
      const response = await write("/admin/contests", admin.cookie, {
        ...settings,
        title: "Reuse practice",
        challenge_ids: selected,
        challenge_settings: selected.map((challenge_id, i) => ({
          challenge_id,
          published: i === 0,
          release_at:
            i === 0
              ? new Date(Date.parse(settings.starts_at) + 60000).toISOString()
              : null,
          scoring: {
            mode: "fixed",
            points: { initial_points: 250, minimum_points: 250, decay: 20 },
            parts: [],
          },
        })),
      });
      assert.equal(response.statusCode, 200, response.body);
      const detail = (
        await get(`/admin/contests/${response.json().id}`, admin.cookie)
      ).json();
      assert.deepEqual(detail.challenge_ids, selected);
      assert.equal(
        detail.challenge_settings[0].scoring.points.initial_points,
        250,
      );
      assert.equal(detail.challenge_settings[1].published, false);
      const source = (
        await get(`/admin/challenges/${ids[28]}`, admin.cookie)
      ).json();
      assert.equal(source.practice, true);
      assert.equal(source.initial_points, 500);
      const edit = await write(
        `/admin/challenges/${ids[28]}`,
        admin.cookie,
        {
          title: source.title,
          category: source.category,
          difficulty: source.difficulty,
          kind: source.kind,
          practice: true,
          published: true,
          description: "Updated description",
        },
        "PUT",
      );
      assert.equal(edit.statusCode, 200, edit.body);
      const ten = (
        await get(
          "/admin/challenges?page_size=10&page=3&challenge_type=ctf",
          admin.cookie,
        )
      ).json();
      assert.equal(ten.items.length, 9);
      assert.equal(ten.total, 29);
      const otherTypes = (
        await get("/admin/challenges?challenge_type=objective", admin.cookie)
      ).json();
      assert.equal(otherTypes.total, 0);
      const ordered = await write("/admin/challenges/search", admin.cookie, {
        ids: selected.join(","),
        q: "Paging",
      });
      assert.deepEqual(
        ordered.json().items.map((c: any) => c.id),
        selected,
      );
    },
  );
  await t.test(
    "scheduled challenges stay hidden, publish atomically once, and respect cancellation",
    async () => {
      const input = {
        title: "Scheduled",
        category: "Misc",
        difficulty: "入门",
        kind: "static_attachment",
        flag: "flag{scheduled}",
        practice: false,
        published: false,
        publish_at: new Date(Date.now() + 3600000).toISOString(),
      };
      const made = await write("/admin/challenges", admin.cookie, input);
      assert.equal(made.statusCode, 200, made.body);
      const id = made.json().id;
      await db.query("INSERT INTO contest_challenges VALUES($1,$2)", [cid, id]);
      await db.query(
        "UPDATE contests SET starts_at=now()-interval '1 minute' WHERE id=$1",
        [cid],
      );
      assert.equal(
        (await get(`/challenges/${id}?scope=${cid}`, carol.cookie)).statusCode,
        404,
      );
      assert.equal(await publishScheduledChallenges(db), 0);
      assert.equal(
        (await get("/admin/challenges?state=scheduled", admin.cookie)).json()
          .items[0].id,
        id,
      );
      await db.query(
        "UPDATE challenges SET publish_at=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      const counts = await Promise.all([
        publishScheduledChallenges(db),
        publishScheduledChallenges(db),
      ]);
      assert.equal(
        counts.reduce((a, b) => a + b, 0),
        1,
      );
      assert.equal(
        (await get(`/challenges/${id}?scope=${cid}`, carol.cookie)).statusCode,
        200,
      );
      const events = await db.query(
        "SELECT id FROM contest_releases WHERE challenge_id=$1 AND contest_id=$2",
        [id, cid],
      );
      assert.equal(events.length, 1);
      assert.equal(
        (await get(`/admin/challenges/${id}`, admin.cookie)).json().publish_at,
        null,
      );
      assert.equal(
        (
          await write(`/admin/challenges/${id}/publication`, admin.cookie, {
            published: false,
            publish_at: input.publish_at,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await write(`/admin/challenges/${id}/publication`, admin.cookie, {
            published: false,
          })
        ).statusCode,
        200,
      );
      assert.equal(await publishScheduledChallenges(db), 0);
      assert.equal(
        (await get(`/admin/challenges/${id}`, admin.cookie)).json().published,
        false,
      );
      assert.equal(
        (
          await write(`/admin/challenges/${id}/publication`, admin.cookie, {
            published: true,
            publish_at: input.publish_at,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await write(`/admin/challenges/${id}/publication`, admin.cookie, {
            published: false,
            publish_at: new Date(Date.now() - 1000).toISOString(),
          })
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "graph editing persists node positions and dependencies and rejects cycles without overwriting",
    async () => {
      const a = crypto.randomUUID(),
        b = crypto.randomUUID();
      const input = {
        title: "Graph",
        published: true,
        nodes: [
          {
            id: a,
            title: "Start",
            article_id: null,
            challenge_id: ids[0],
            prerequisites: [],
            position: { x: -120.5, y: 64 },
          },
          {
            id: b,
            title: "Next",
            article_id: null,
            challenge_id: ids[1],
            prerequisites: [a],
            position: { x: 340, y: 180.25 },
          },
        ],
      };
      const made = await write("/admin/learning/trees", admin.cookie, input);
      assert.equal(made.statusCode, 200, made.body);
      const id = made.json().id;
      const stored = (
        await get(`/admin/learning/trees/${id}`, admin.cookie)
      ).json();
      assert.deepEqual(
        stored.nodes.map((n: any) => n.position),
        input.nodes.map((n) => n.position),
      );
      assert.deepEqual(stored.nodes[1].prerequisites, [a]);
      assert.equal(stored.nodes[0].challenge_title, "Paging 00");
      const publicTree = (
        await get(`/learning/trees/${id}`, alice.cookie)
      ).json();
      assert.deepEqual(publicTree.nodes[1].position, input.nodes[1]!.position);
      const invalid = {
        ...input,
        nodes: input.nodes.map((n) =>
          n.id === a ? { ...n, prerequisites: [b] } : n,
        ),
      };
      assert.equal(
        (
          await write(
            `/admin/learning/trees/${id}`,
            admin.cookie,
            invalid,
            "PUT",
          )
        ).statusCode,
        400,
      );
      assert.deepEqual(
        (await get(`/admin/learning/trees/${id}`, admin.cookie)).json().nodes[0]
          .prerequisites,
        [],
      );
      const moved = {
        ...input,
        nodes: input.nodes.map((n) => ({
          ...n,
          position: { x: n.position.x + 100, y: n.position.y + 20 },
        })),
      };
      assert.equal(
        (await write(`/admin/learning/trees/${id}`, admin.cookie, moved, "PUT"))
          .statusCode,
        200,
      );
      assert.deepEqual(
        (await get(`/admin/learning/trees/${id}`, admin.cookie))
          .json()
          .nodes.map((n: any) => n.position),
        moved.nodes.map((n) => n.position),
      );
    },
  );
  await t.test(
    "independent content editors load by id and preserve selected challenges beyond the first page",
    async () => {
      const set = await write("/admin/problemsets", admin.cookie, {
        title: "All pages",
        published: true,
        challenge_ids: ids,
      });
      assert.equal(set.statusCode, 200, set.body);
      assert.equal(
        (await get(`/admin/problemsets/${set.json().id}`, admin.cookie)).json()
          .challenges.length,
        29,
      );
      const article = await write("/admin/articles", admin.cookie, {
        title: "Guide",
        slug: "ops-guide",
        category: "Intro",
        kind: "document",
        body: "Full body",
        published: true,
      });
      assert.equal(article.statusCode, 200, article.body);
      assert.equal(
        (await get(`/admin/articles/${article.json().id}`, admin.cookie)).json()
          .body,
        "Full body",
      );
      const notice = await write("/admin/announcements", admin.cookie, {
        title: "Notice",
        body: "Before",
        contest_id: cid,
      });
      assert.equal(notice.statusCode, 200, notice.body);
      assert.equal(
        (
          await write(
            `/admin/announcements/${notice.json().id}`,
            admin.cookie,
            { title: "Changed", body: "After", contest_id: cid },
            "PUT",
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await get(`/admin/announcements/${notice.json().id}`, admin.cookie)
        ).json().body,
        "After",
      );
    },
  );
});
