import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { sessionCookie } from "../src/auth.js";
import { digest, flagHash } from "../src/security.js";
import { storage } from "../src/resources.js";
import { unpackContent, packContent } from "../src/content-archive.js";
import {
  contentManifest,
  contentPreview,
  importContent,
  validateContent,
} from "../src/content-transfer.js";

test(
  "content archives preserve complete definitions, isolate imported data and validate untrusted files",
  { timeout: 90000 },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "nebuctf-content-test-")),
      originalStorage = config.DATA_DIR;
    config.DATA_DIR = join(folder, "storage");
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db);
    await app.ready();
    t.after(async () => {
      await app.close();
      await db.close();
      config.DATA_DIR = originalStorage;
      await rm(folder, { recursive: true, force: true });
    });
    async function actor(role: string) {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,'test',$4)",
        [id, `import-${id.slice(0, 8)}`, `${id}@example.test`, role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      return { id, cookie: `${sessionCookie}=${token}` };
    }
    const admin = await actor("admin"),
      other = await actor("admin"),
      user = await actor("user");
    const headers = (who = admin) => ({
      cookie: who.cookie,
      origin: config.APP_ORIGIN,
      "x-csrf-protection": "1",
    });
    async function ok(path: string, body?: unknown) {
      const r = await app.inject({
        url: `/api${path}`,
        method: body === undefined ? "GET" : "POST",
        headers: headers(),
        payload: body as any,
      });
      assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
      return r.json();
    }
    const multipart = (data: Buffer, name = "bundle.zip") => ({
      payload: Buffer.concat([
        Buffer.from(
          `--boundary\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        data,
        Buffer.from("\r\n--boundary--\r\n"),
      ]),
      headers: {
        ...headers(),
        "content-type": "multipart/form-data; boundary=boundary",
      },
    });
    const base = {
      title: "静态题",
      category: "Web",
      difficulty: "简单",
      published: true,
      flag: "flag{static}",
      flag_mode: "static",
      practice: true,
    };
    const single = await ok("/admin/challenges", base);
    const hint = crypto.randomUUID();
    const multi = await ok("/admin/challenges", {
      ...base,
      title: "两个小题",
      practice: false,
      flag: undefined,
      hints: [{ id: hint, content: "提示" }],
      parts: [0, 1].map((i) => ({
        title: `小题${i}`,
        flag: `flag{part${i}}`,
        initial_points: 200,
        minimum_points: 50,
      })),
    });
    const parts = (await ok(`/admin/challenges/${multi.id}`)).parts;
    const objective = await ok("/admin/challenges", {
      ...base,
      title: "选择题",
      practice: false,
      challenge_type: "objective",
      objective: {
        type: "multiple",
        options: [
          { id: "A", text: "One" },
          { id: "B", text: "Two" },
        ],
        correct_options: ["A", "B"],
      },
    });
    const dynamic = {
      ...base,
      flag: undefined,
      flag_mode: "dynamic",
      practice: false,
      resources: {
        container: {
          image: "nebuctf/target:test",
          mode: "private",
          protocol: "nc",
          port: 1337,
        },
        attachment: { image: "nebuctf/generator:test" },
      },
      patch_config: { checker_image: "nebuctf/checker:test" },
      flag_template: "flag{[GUID]}",
    };
    const awdp = await ok("/admin/challenges", {
      ...dynamic,
      title: "AWDP",
      challenge_type: "awdp",
      parts: ["attack", "defense"].map((role) => ({
        title: role,
        role,
        initial_points: 100,
        minimum_points: 100,
      })),
    });
    const awd = await ok("/admin/challenges", {
      ...dynamic,
      title: "AWD",
      challenge_type: "awd",
      awd_config: { checker_image: "nebuctf/checker:test" },
    });
    const attachment = await app.inject({
      method: "POST",
      url: `/api/admin/challenges/${multi.id}/attachments`,
      ...multipart(Buffer.from("archive attachment"), "题目.txt"),
    });
    assert.equal(attachment.statusCode, 200, attachment.body);
    await db.query("UPDATE challenges SET description=$2 WHERE id=$1", [
      multi.id,
      `[附件](/api/attachments/${attachment.json().id})`,
    ]);
    const start = new Date(Date.now() + 3600000).toISOString(),
      end = new Date(Date.now() + 7200000).toISOString();
    const point = { initial_points: 300, minimum_points: 100, decay: 20 };
    const game = await ok("/admin/contests", {
      title: "导出比赛",
      description: "赛程",
      starts_at: start,
      ends_at: end,
      published: true,
      challenge_ids: [multi.id, objective.id, awdp.id, awd.id],
      challenge_settings: [
        {
          challenge_id: multi.id,
          scoring: {
            mode: "dynamic",
            points: point,
            parts: [{ id: parts[0].id, points: point }],
          },
          release_at: new Date(Date.parse(start) + 60000).toISOString(),
        },
        {
          challenge_id: awd.id,
          scoring: {
            mode: "round",
            points: point,
            round: { carry: false, flag_lifetime: 2 },
          },
        },
      ],
      groups: [
        {
          name: "公开组",
          permissions: { rank_overall: false },
          challenge_permissions: { [multi.id]: { resources: false } },
        },
      ],
      hint_policy: { mode: "factor", factor: 0.8 },
      hint_overrides: [
        {
          challenge_id: multi.id,
          hint_id: hint,
          policy: { mode: "fixed", points: 10 },
        },
      ],
      submission_limits: { flag: 20, defense: 5 },
      submission_overrides: [{ challenge_id: multi.id, flag: 10 }],
      timing: { practical: { mode: "fixed", opens_at: start, closes_at: end } },
      round_duration: 600,
      registration_opens_at: new Date(
        Date.parse(start) - 1800000,
      ).toISOString(),
      writeup: {
        enabled: true,
        deadline: new Date(Date.parse(end) + 3600000).toISOString(),
      },
    });
    await ok("/admin/announcements", {
      contest_id: game.id,
      title: "规则",
      body: "保留比赛公告",
    });
    const poster = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSmkAAAAASUVORK5CYII=",
      "base64",
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/contests/${game.id}/poster`,
          ...multipart(poster, "poster.png"),
        })
      ).statusCode,
      200,
    );
    const exported = await app.inject({
      url: `/api/admin/contests/${game.id}/export`,
      headers: headers(),
    });
    assert.equal(exported.statusCode, 200, exported.body.slice(0, 100));
    assert.equal(exported.headers["content-type"], "application/zip");
    assert.equal(exported.headers["cache-control"], "private, no-store");
    const archive = join(folder, "input.zip");
    await writeFile(archive, exported.rawPayload);
    const unpack = await mkdtemp(join(folder, "unpack-")),
      packed = await unpackContent(archive, unpack),
      manifest = contentManifest.parse(packed.data);
    validateContent(manifest, packed.files);

    await t.test(
      "preview is read-only and restricted to administrators; committing is owned and idempotent",
      async () => {
        const before = await db.query("SELECT id FROM contests ORDER BY id");
        assert.equal(
          (
            await app.inject({
              url: `/api/admin/contests/${game.id}/export`,
              headers: headers(user),
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/admin/transfers/preview?kind=contest",
              ...multipart(exported.rawPayload),
              headers: {
                ...multipart(exported.rawPayload).headers,
                ...headers(user),
              },
            })
          ).statusCode,
          403,
        );
        const preview = await app.inject({
          method: "POST",
          url: "/api/admin/transfers/preview?kind=contest",
          ...multipart(exported.rawPayload),
        });
        assert.equal(preview.statusCode, 200, preview.body);
        assert.deepEqual(
          await db.query("SELECT id FROM contests ORDER BY id"),
          before,
        );
        assert.deepEqual(preview.json().required_flags, []);
        assert(
          !preview.body.includes("flag_hash") &&
            !preview.body.includes("correct_options"),
        );
        const nextStart = new Date(Date.now() + 86400000).toISOString(),
          path = `/api/admin/transfers/${preview.json().token}/commit`,
          body = { title: "导入副本", starts_at: nextStart };
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: headers(other),
              payload: body,
            })
          ).statusCode,
          404,
        );
        const response = await app.inject({
          method: "POST",
          url: path,
          headers: headers(),
          payload: body,
        });
        assert.equal(response.statusCode, 200, response.body);
        const result = response.json();
        assert.deepEqual(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: headers(),
              payload: body,
            })
          ).json(),
          result,
        );
        const copy = await ok(`/admin/contests/${result.id}`),
          source = await ok(`/admin/contests/${game.id}`);
        assert.equal(copy.published, false);
        assert.equal(source.published, true);
        assert.equal(source.title, "导出比赛");
        assert.equal(copy.starts_at, nextStart);
        assert.equal(
          Date.parse(copy.ends_at) - Date.parse(copy.starts_at),
          Date.parse(end) - Date.parse(start),
        );
        assert.equal(copy.round_duration, 600);
        assert.equal(copy.groups[0].permissions.rank_overall, false);
        const [newMulti, newObjective, newAwdp, newAwd] = copy.challenge_ids;
        assert(
          copy.challenge_ids.every(
            (id: string) => !source.challenge_ids.includes(id),
          ),
        );
        assert.equal(
          copy.groups[0].challenge_permissions[newMulti].resources,
          false,
        );
        const imported = await ok(`/admin/challenges/${newMulti}`);
        assert(
          imported.parts.every(
            (p: any) => !parts.some((old: any) => old.id === p.id),
          ),
        );
        assert.equal(
          copy.challenge_settings[0].scoring.parts[0].id,
          imported.parts[0].id,
        );
        assert.equal(copy.hint_overrides[0].challenge_id, newMulti);
        assert.equal(copy.hint_overrides[0].hint_id, imported.hints[0].id);
        assert.equal(copy.submission_overrides[0].challenge_id, newMulti);
        assert.equal(
          Date.parse(copy.challenge_settings[0].release_at) -
            Date.parse(nextStart),
          60000,
        );
        assert.equal(copy.timing.practical.opens_at, nextStart);
        assert.equal(
          Date.parse(copy.writeup.deadline) - Date.parse(copy.ends_at),
          3600000,
        );
        assert.equal(imported.practice, false);
        assert.equal(
          imported.description,
          `[附件](/api/attachments/${imported.attachments[0].id})`,
        );
        assert.equal(
          await readFile(join(storage(), imported.attachments[0].id), "utf8"),
          "archive attachment",
        );
        const hashes = await db.query(
          "SELECT flag_hash FROM challenge_parts WHERE challenge_id=$1 ORDER BY position",
          [newMulti],
        );
        assert.deepEqual(
          hashes.map((p) => p.flag_hash),
          [flagHash("flag{part0}"), flagHash("flag{part1}")],
        );
        assert.deepEqual(
          (await ok(`/admin/challenges/${newObjective}`)).objective
            .correct_options,
          ["A", "B"],
        );
        assert.equal(
          (await ok(`/admin/challenges/${newAwdp}`)).resources.container
            .protocol,
          "nc",
        );
        assert.equal(
          (await ok(`/admin/challenges/${newAwd}`)).awd_config.checker_image,
          "nebuctf/checker:test",
        );
        assert.deepEqual(
          await readFile(join(storage(), "poster-" + copy.poster_id)),
          poster,
        );
        assert.equal(
          (
            await db.query(
              "SELECT body FROM announcements WHERE contest_id=$1",
              [result.id],
            )
          )[0]!.body,
          "保留比赛公告",
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM registrations WHERE contest_id=$1",
              [result.id],
            )
          )[0]!.n,
          0,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM instances WHERE scope=$1",
              [result.id],
            )
          )[0]!.n,
          0,
        );
        // A normal editor save accepts the complete imported configuration.
        const saved = await app.inject({
          method: "PUT",
          url: `/api/admin/contests/${result.id}`,
          headers: headers(),
          payload: {
            ...copy,
            challenge_settings: copy.challenge_settings.map((s: any) => ({
              ...s,
              release_at: s.release_at
                ? new Date(s.release_at).toISOString()
                : null,
            })),
          },
        });
        assert.equal(saved.statusCode, 200, saved.body);
      },
    );

    await t.test(
      "single-question round trip and cross-site static flag replacement",
      async () => {
        const r = await app.inject({
          url: `/api/admin/challenges/${single.id}/export`,
          headers: headers(),
        });
        const dir = await mkdtemp(join(folder, "single-")),
          zip = join(dir, "input.zip");
        await writeFile(zip, r.rawPayload);
        const unpacked = await unpackContent(zip, dir),
          m = contentManifest.parse(unpacked.data);
        const imported = await importContent(db, admin.id, m, unpacked.files, {
          title: "静态副本",
          flags: {},
        });
        const [row] = await db.query(
          "SELECT flag_hash,published,practice FROM challenges WHERE id=$1",
          [imported.id],
        );
        assert.deepEqual(row, {
          flag_hash: flagHash("flag{static}"),
          published: false,
          practice: true,
        });
        m.flag_key_id = "0".repeat(64);
        assert.equal(contentPreview(m, "token", 0).required_flags.length, 1);
        await assert.rejects(
          importContent(db, admin.id, m, unpacked.files, {
            title: "跨站",
            flags: {},
          }),
          /静态 Flag/,
        );
        const foreign = await importContent(db, admin.id, m, unpacked.files, {
          title: "跨站",
          flags: { [single.id]: "flag{reentered}" },
        });
        assert.equal(
          (
            await db.query("SELECT flag_hash FROM challenges WHERE id=$1", [
              foreign.id,
            ])
          )[0]!.flag_hash,
          flagHash("flag{reentered}"),
        );
      },
    );

    await t.test(
      "invalid references, unsupported formats, missing files and failed commits leave no partial data",
      async () => {
        const invalid = structuredClone(manifest);
        invalid.contest!.config.challenge_settings![0]!.scoring.parts[0]!.id =
          crypto.randomUUID();
        assert.throws(() => validateContent(invalid, packed.files), /小题计分/);
        assert.throws(() => validateContent(manifest, new Map()), /资源文件/);
        const wrong = await app.inject({
          method: "POST",
          url: "/api/admin/transfers/preview?kind=challenge",
          ...multipart(exported.rawPayload),
        });
        assert.equal(wrong.statusCode, 400);
        const malicious = structuredClone(manifest);
        malicious.challenges[0]!.config.resources = {
          container: null,
          attachment: {
            image: "untrusted/image:latest",
            cpu: 100,
            memory: 64,
            ttl: 60,
          },
        };
        assert.throws(() => validateContent(malicious, packed.files), /镜像/);
        const version = join(folder, "version.zip");
        await packContent(
          version,
          { ...manifest, version: 2 },
          new Map([...packed.files].map(([name, f]) => [name.slice(6), f])),
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/admin/transfers/preview?kind=contest",
              ...multipart(await readFile(version)),
            })
          ).statusCode,
          400,
        );
        const before = await db.query("SELECT count(*)::int n FROM challenges"),
          stored = await readdir(storage());
        await assert.rejects(
          importContent(db, admin.id, manifest, packed.files, {
            title: "失败副本",
            starts_at: "2020-01-01T00:00:00.000Z",
            flags: {},
          }),
          /未来/,
        );
        assert.deepEqual(
          await db.query("SELECT count(*)::int n FROM challenges"),
          before,
        );
        assert.deepEqual((await readdir(storage())).sort(), stored.sort());
      },
    );

    await t.test(
      "archive reader rejects unsafe paths, links, duplicate entries and oversized expansions",
      async () => {
        async function rejected(
          name: string,
          bytes = Buffer.from("x"),
          mode?: number,
          duplicate = false,
        ) {
          const zip = new ZipFile(),
            chunks: Buffer[] = [];
          const finished = new Promise<Buffer>((resolve, reject) => {
            zip.outputStream.on("data", (c) => chunks.push(c));
            zip.outputStream.on("error", reject);
            zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
          });
          zip.addBuffer(bytes, name, mode ? { mode } : {});
          if (duplicate) zip.addBuffer(bytes, name);
          zip.end();
          const dir = await mkdtemp(join(folder, "bad-")),
            path = join(dir, "archive.zip");
          await writeFile(path, await finished);
          await assert.rejects(unpackContent(path, dir));
        }
        await rejected("unexpected.txt");
        await rejected(
          "files/" + crypto.randomUUID(),
          Buffer.from("/etc/passwd"),
          0o120777,
        );
        await rejected("manifest.json", Buffer.from("{}"), undefined, true);
        await rejected(
          "files/" + crypto.randomUUID(),
          Buffer.alloc(20 * 1024 * 1024 + 1),
        );
      },
    );
  },
);
