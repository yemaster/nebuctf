import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import { config } from "../src/config.js";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { digest } from "../src/security.js";
import { writeupPath } from "../src/writeup-storage.js";

test(
  "contest WriteUp settings, private files, shared versions, review, exports and posters",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      oldDir = config.DATA_DIR;
    config.DATA_DIR = await mkdtemp(join(tmpdir(), "nct-writeups-"));
    t.after(async () => {
      await app.close();
      await db.close();
      await rm(config.DATA_DIR, { recursive: true, force: true });
      config.DATA_DIR = oldDir;
    });
    async function player(role = "user") {
      const id = crypto.randomUUID(),
        team = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, "wp" + id.slice(0, 10), id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1::uuid,$2,$3,$1::text)",
        [team, "WP " + team, id],
      );
      await db.query("INSERT INTO memberships(user_id,team_id) VALUES($1,$2)", [
        id,
        team,
      ]);
      return { id, team, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await player("admin"),
      a = await player(),
      b = await player(),
      late = await player();
    const headers = (actor = admin) => ({
      cookie: actor.cookie,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
    });
    const request = (
      path: string,
      actor = admin,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method: method as "GET" | "POST" | "PUT" | "DELETE",
        headers: headers(actor),
        payload: body as any,
      });
    async function ok(
      path: string,
      actor = admin,
      body?: unknown,
      method?: string,
    ) {
      const res = await request(path, actor, body, method);
      assert.equal(res.statusCode, 200, `${path}: ${res.body}`);
      return res.json();
    }
    const base = {
      title: "WriteUp contest",
      description: "draft",
      published: true,
      team_limit: 4,
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      writeup: {
        enabled: true,
        required: true,
        deadline: new Date(Date.now() + 10800000).toISOString(),
        max_size_mb: 1,
        formats: ["pdf", "zip"],
        allow_resubmit: true,
        note: "附完整解题过程",
      },
    };
    await t.test(
      "legacy policies keep member submissions and invalid submitter values are rejected",
      async () => {
        const res = await request("/admin/contests", admin, {
          ...base,
          writeup: { ...base.writeup, submitter: "anyone" },
        });
        assert.equal(res.statusCode, 400);
      },
    );
    const c = await ok("/admin/contests", admin, base),
      other = await ok("/admin/contests", admin, { ...base, title: "Other" });
    await ok(`/contests/${c.id}/register`, a, { team_id: a.team });
    await ok(`/contests/${c.id}/register`, b, { team_id: b.team });
    const pdf = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
    );
    function upload(
      path: string,
      actor = a,
      data = pdf,
      name = "writeup.pdf",
      csrf = true,
      extra = "",
    ) {
      const boundary = "NebuWriteupBoundary";
      return app.inject({
        url: "/api" + path,
        method: "POST",
        headers: {
          ...headers(actor),
          ...(!csrf ? { "x-csrf-protection": "" } : {}),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          ),
          data,
          Buffer.from(`\r\n${extra}--${boundary}--\r\n`),
        ]),
      });
    }
    await t.test(
      "settings preserve omitted values and gate submissions by roster, opening and permissions",
      async () => {
        const res = await request("/admin/contests", admin, {
          ...base,
          writeup: { ...base.writeup, deadline: base.starts_at },
        });
        assert.equal(res.statusCode, 400);
        assert.equal(
          (await upload(`/contests/${c.id}/writeup?version=0`)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup`, late)).statusCode,
          403,
        );
        const old = await ok(`/admin/contests/${c.id}`),
          body = { ...base, writeup: undefined };
        assert.equal(old.writeup.submitter, "members");
        await ok(`/admin/contests/${c.id}`, admin, body, "PUT");
        assert.deepEqual(
          (await ok(`/admin/contests/${c.id}`)).writeup,
          old.writeup,
        );
        await db.query(
          "UPDATE contests SET starts_at=now()-interval '2 hour',ends_at=now()-interval '1 hour' WHERE id=$1",
          [c.id],
        );
        assert.equal((await ok(`/contests/${c.id}/writeup`, a)).window, "open");
        assert.equal((await ok(`/contests/${c.id}`, a)).writeup_access, true);
        assert.equal(
          (await request(`/admin/contests/${c.id}/writeups`, a)).statusCode,
          403,
        );
        assert.equal(
          (
            await upload(
              `/contests/${c.id}/writeup?version=0`,
              a,
              pdf,
              "writeup.pdf",
              false,
            )
          ).statusCode,
          403,
        );
        const r = await upload(`/contests/${c.id}/writeup?version=0`);
        assert.equal(r.statusCode, 200, r.body);
        const current = (await ok(`/contests/${c.id}/writeup`, a)).submission;
        assert.equal(current.name, "writeup.pdf");
        assert.equal(current.version, 1);
        assert.equal(current.file_id, undefined);
        const previewPath = `/admin/contests/${c.id}/writeups/${a.team}/file`;
        const preview = await request(`${previewPath}?version=1`);
        assert.equal(preview.statusCode, 200);
        assert.deepEqual(preview.rawPayload, pdf);
        assert.equal(preview.headers["cache-control"], "private, no-store");
        assert.equal(preview.headers["x-frame-options"], "DENY");
        assert.equal(
          (await request(`${previewPath}?version=2`)).statusCode,
          409,
        );
        assert.equal(
          (await request(`${previewPath}?version=1`, a)).statusCode,
          403,
        );
        const download = await request(`/contests/${c.id}/writeup/file`, a);
        assert.equal(download.statusCode, 200);
        assert.deepEqual(download.rawPayload, pdf);
        assert.match(
          String(download.headers["content-disposition"]),
          /^attachment;/,
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup/file`, b)).statusCode,
          404,
        );
        assert.equal(
          (await request(`/admin/contests/${other.id}/writeups/${a.team}/file`))
            .statusCode,
          404,
        );
      },
    );
    await t.test(
      "file validation bounds storage and failed replacements retain the previous submission",
      async () => {
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'writeup:%'");
        for (const [name, bytes] of [
          ["bad.pdf", Buffer.from("<script>bad</script>")],
          ["empty.pdf", Buffer.alloc(0)],
          ["bad.zip", Buffer.from("PK")],
          ["other.exe", pdf],
          ["big.pdf", Buffer.concat([pdf, Buffer.alloc(1024 * 1024)])],
        ] as const) {
          const res = await upload(
            `/contests/${c.id}/writeup?version=1`,
            a,
            bytes,
            name,
          );
          assert.ok([400, 413].includes(res.statusCode), res.body);
        }
        assert.equal(
          (await ok(`/contests/${c.id}/writeup`, a)).submission.version,
          1,
        );
        const files = await readdir(join(config.DATA_DIR, "files"));
        assert.equal(files.filter((f) => f.startsWith("writeup-")).length, 1);
      },
    );
    await t.test(
      "teammate uploads are versioned atomically and review cannot target an overwritten file",
      async () => {
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'writeup:%'");
        const [old] = await db.query(
          "SELECT file_id FROM contest_writeups WHERE contest_id=$1 AND team_id=$2",
          [c.id, a.team],
        );
        const results = await Promise.all([
          upload(
            `/contests/${c.id}/writeup?version=1`,
            a,
            pdf,
            "revision-a.pdf",
          ),
          upload(
            `/contests/${c.id}/writeup?version=1`,
            a,
            pdf,
            "revision-b.pdf",
          ),
        ]);
        assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
        await assert.rejects(access(writeupPath(old!.file_id)));
        assert.equal(
          (
            await request(
              `/admin/contests/${c.id}/writeups/${a.team}`,
              admin,
              { version: 1, status: "accepted" },
              "PUT",
            )
          ).statusCode,
          409,
        );
        await ok(
          `/admin/contests/${c.id}/writeups/${a.team}`,
          admin,
          { version: 2, status: "changes_requested", note: "补充利用过程" },
          "PUT",
        );
        assert.equal(
          (await ok(`/contests/${c.id}/writeup`, a)).submission.review_note,
          "补充利用过程",
        );
        await db.query(
          "UPDATE contests SET writeup=jsonb_set(writeup,'{allow_resubmit}','false') WHERE id=$1",
          [c.id],
        );
        assert.equal(
          (await upload(`/contests/${c.id}/writeup?version=2`)).statusCode,
          200,
        );
        assert.equal(
          (await upload(`/contests/${c.id}/writeup?version=3`)).statusCode,
          403,
        );
        const detail = await ok(`/admin/contests/${c.id}/writeups/${a.team}`);
        assert.equal(detail.history_total, 4);
        assert.equal(detail.status, "submitted");
        assert.equal(detail.review_note, "");
      },
    );
    await t.test(
      "missing teams, group filters, private archive streams and histories paginate",
      async () => {
        await db.query("DELETE FROM rate_limits WHERE key LIKE 'writeup:%'");
        const zip = new ZipFile();
        zip.addBuffer(Buffer.from("# WriteUp\n"), "README.md");
        zip.end();
        const chunks: Buffer[] = [];
        for await (const chunk of zip.outputStream)
          chunks.push(chunk as Buffer);
        const r = await upload(
          `/contests/${c.id}/writeup?version=0`,
          b,
          Buffer.concat(chunks),
          "solution.zip",
        );
        assert.equal(r.statusCode, 200, r.body);
        for (let n = 0; n < 11; n++) {
          const team = await player();
          await db.query(
            "INSERT INTO registrations(contest_id,team_id,accepted_at) VALUES($1,$2,now())",
            [c.id, team.team],
          );
        }
        const missing = await ok(
          `/admin/contests/${c.id}/writeups?status=missing`,
        );
        assert.equal(missing.total, 11);
        assert.equal(missing.items.length, 10);
        assert.equal(
          (await ok(`/admin/contests/${c.id}/writeups?status=missing&page=2`))
            .items.length,
          1,
        );
        const group = crypto.randomUUID();
        await db.query(
          "INSERT INTO contest_groups(id,contest_id,name,position) VALUES($1,$2,'测试组',0)",
          [group, c.id],
        );
        await db.query(
          "UPDATE registrations SET group_id=$3 WHERE contest_id=$1 AND team_id=$2",
          [c.id, b.team, group],
        );
        const grouped = await ok(
          `/admin/contests/${c.id}/writeups?group=${group}`,
        );
        assert.equal(grouped.total, 1);
        assert.equal(grouped.items[0].team_id, b.team);
        assert.deepEqual(grouped.counts, [{ status: "submitted", count: 1 }]);
        const filteredArchive = await request(
          `/admin/contests/${c.id}/writeups/archive?group=${group}`,
        );
        assert.equal(filteredArchive.statusCode, 200);
        assert.ok(
          filteredArchive.rawPayload.includes(
            Buffer.from(`${b.team}/solution.zip`),
          ),
        );
        assert.equal(
          filteredArchive.rawPayload.includes(Buffer.from(`${a.team}/`)),
          false,
        );
        const archive = await request(
          `/admin/contests/${c.id}/writeups/archive?teams=${a.team},${b.team}`,
        );
        assert.equal(archive.statusCode, 200, archive.body);
        assert.equal(archive.headers["content-type"], "application/zip");
        assert.ok(archive.rawPayload.includes(Buffer.from(`${a.team}/`)));
        assert.ok(archive.rawPayload.includes(Buffer.from("manifest.json")));
        assert.ok(archive.rawPayload.includes(pdf));
        assert.equal(
          (
            await request(
              `/admin/contests/${other.id}/writeups/archive?teams=${a.team}`,
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (await request(`/admin/contests/${c.id}/writeups/archive`, a))
            .statusCode,
          403,
        );
      },
    );
    await t.test(
      "post-contest membership changes never transfer private WriteUp access",
      async () => {
        await db.query(
          "INSERT INTO memberships(team_id,user_id) VALUES($1,$2)",
          [a.team, late.id],
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup`, late)).statusCode,
          403,
        );
        await db.query(
          "DELETE FROM memberships WHERE team_id=$1 AND user_id=$2",
          [a.team, a.id],
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup/file`, a)).statusCode,
          200,
        );
        await db.query(
          "UPDATE registrations SET status='suspended' WHERE contest_id=$1 AND team_id=$2",
          [c.id, a.team],
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup/file`, a)).statusCode,
          403,
        );
        await db.query(
          "UPDATE registrations SET status='accepted' WHERE contest_id=$1 AND team_id=$2",
          [c.id, a.team],
        );
        // Use the public ISO configuration format, even in the isolated fixture.
        const deadline = new Date(Date.now() - 1000).toISOString();
        await db.query(
          "UPDATE contests SET writeup=jsonb_set(writeup,'{deadline}',$2::jsonb) WHERE id=$1",
          [c.id, JSON.stringify(deadline)],
        );
        assert.equal(
          (await upload(`/contests/${c.id}/writeup?version=3`)).statusCode,
          403,
        );
        assert.equal(
          (await request(`/contests/${c.id}/writeup/file`, a)).statusCode,
          200,
        );
      },
    );
    await t.test(
      "poster replacement and removal are scoped, persist on disk and never affect contest settings",
      async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
        const r = await upload(
          `/admin/contests/${c.id}/poster`,
          admin,
          png,
          "cover.png",
        );
        assert.equal(r.statusCode, 200, r.body);
        const pid = r.json().poster_id;
        assert.deepEqual(
          await readFile(join(config.DATA_DIR, "files", `poster-${pid}`)),
          png,
        );
        assert.equal(
          (
            await request(
              `/admin/contests/${c.id}/poster`,
              a,
              undefined,
              "DELETE",
            )
          ).statusCode,
          403,
        );
        await ok(`/admin/contests/${c.id}/poster`, admin, undefined, "DELETE");
        await assert.rejects(
          access(join(config.DATA_DIR, "files", `poster-${pid}`)),
        );
        assert.equal(
          (await request(`/contests/${c.id}/poster`, a)).statusCode,
          404,
        );
        assert.equal(
          (await ok(`/admin/contests/${c.id}`)).description,
          "draft",
        );
      },
    );
    await t.test(
      "captain and member policies share exactly one team report and recheck the current captain",
      async () => {
        const captain = await player(),
          member = await player("admin");
        await db.query("DELETE FROM memberships WHERE user_id=$1", [member.id]);
        await db.query(
          "INSERT INTO memberships(user_id,team_id) VALUES($1,$2)",
          [member.id, captain.team],
        );
        const contest = await ok("/admin/contests", admin, {
          ...base,
          writeup: { ...base.writeup, submitter: "captain" },
        });
        await ok(`/contests/${contest.id}/register`, captain, {
          team_id: captain.team,
        });
        const starts_at = new Date(Date.now() - 7200000).toISOString(),
          ends_at = new Date(Date.now() - 3600000).toISOString();
        await db.query(
          "UPDATE contests SET starts_at=$2,ends_at=$3 WHERE id=$1",
          [contest.id, starts_at, ends_at],
        );
        assert.equal(
          (await ok(`/contests/${contest.id}/writeup`, captain)).can_submit,
          true,
        );
        assert.equal(
          (await ok(`/contests/${contest.id}/writeup`, member)).can_submit,
          false,
        );
        const filesBefore = await readdir(join(config.DATA_DIR, "files"));
        assert.equal(
          (await upload(`/contests/${contest.id}/writeup?version=0`, member))
            .statusCode,
          403,
        );
        assert.deepEqual(
          await readdir(join(config.DATA_DIR, "files")),
          filesBefore,
        );
        assert.equal(
          (await upload(`/contests/${contest.id}/writeup?version=0`, captain))
            .statusCode,
          200,
        );
        assert.equal(
          (await request(`/contests/${contest.id}/writeup/file`, member))
            .statusCode,
          200,
        );
        await ok(
          `/admin/contests/${contest.id}`,
          admin,
          {
            ...base,
            starts_at,
            ends_at,
            writeup: { ...base.writeup, submitter: "members" },
          },
          "PUT",
        );
        assert.equal(
          (await ok(`/contests/${contest.id}/writeup`, member)).can_submit,
          true,
        );
        assert.equal(
          (await upload(`/contests/${contest.id}/writeup?version=1`, member))
            .statusCode,
          200,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM contest_writeups WHERE contest_id=$1",
              [contest.id],
            )
          )[0]!.n,
          1,
        );
        assert.equal(
          (await ok(`/contests/${contest.id}/writeup`, captain)).submission
            .version,
          2,
        );
        await ok(
          `/admin/contests/${contest.id}`,
          admin,
          {
            ...base,
            starts_at,
            ends_at,
            writeup: { ...base.writeup, submitter: "captain" },
          },
          "PUT",
        );
        await db.query("UPDATE teams SET captain_id=$2 WHERE id=$1", [
          captain.team,
          member.id,
        ]);
        assert.equal(
          (await upload(`/contests/${contest.id}/writeup?version=2`, captain))
            .statusCode,
          403,
        );
        assert.equal(
          (await upload(`/contests/${contest.id}/writeup?version=2`, member))
            .statusCode,
          200,
        );
      },
    );
  },
);
