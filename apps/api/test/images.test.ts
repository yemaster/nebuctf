import { verified } from "./helpers/captcha.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { ImageWorker } from "../src/image-worker.js";
import { DockerEngine, type ImageInfo, type PullEvent } from "../src/docker.js";
import {
  imageKey,
  imageReference,
  imagePrefixKey,
  cleanDockerMessage,
} from "../src/image-reference.js";
import { validateImage } from "../src/resources.js";
import { containerConfig } from "../src/worker.js";

test("Docker references, allowlist aliases and redacted diagnostics", () => {
  for (const ref of [
    "nebuctf/demo",
    "docker.io/nebuctf/demo:latest",
    "index.docker.io/nebuctf/demo",
  ])
    assert.equal(imageKey(ref), "docker.io/nebuctf/demo:latest");
  assert.equal(imageKey("alpine"), "docker.io/library/alpine:latest");
  assert.equal(
    imageKey("registry.test:5000/a/b:v1"),
    "registry.test:5000/a/b:v1",
  );
  assert.equal(
    imageKey("docker.io/my.space/demo"),
    "docker.io/my.space/demo:latest",
  );
  for (const ref of [
    "https://host/img",
    "foo?tag=x",
    "../foo",
    "repo/name;id",
    "repo/name\nother",
  ])
    assert.equal(imageReference.safeParse(ref).success, false, ref);
  assert.equal(
    imageKey("nebuctf/a:v1@sha256:" + "a".repeat(64)),
    "docker.io/nebuctf/a@sha256:" + "a".repeat(64),
  );
  assert.ok(imageReference.safeParse("nebuctf/name__one--two:tag").success);
  assert.equal(imagePrefixKey("docker.io/"), "docker.io/");
  assert.equal(
    imagePrefixKey("registry.test:5000/repo"),
    "registry.test:5000/repo",
  );
  validateImage("docker.io/nebuctf/demo:latest");
  validateImage("index.docker.io/nebuctf/demo");
  assert.throws(() => validateImage("nebuctf.evil/demo"));
  assert.throws(() => validateImage("evil/nebuctf/demo"));
  assert.equal(
    cleanDockerMessage(
      "\x1b[31mdenied\x1b[0m https://user:secret@reg.test/v2?token=private",
    ),
    "denied https://reg.test/v2",
  );
});

test("Docker pull parses streaming UTF-8 and reports errors, aborts and bounded responses", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "nct-image-"));
  const socket = join(dir, "docker.sock");
  let mode = "success",
    requested = "";
  const server = createServer((req, res) => {
    requested = req.url!;
    if (mode === "abort") {
      res.writeHead(200);
      res.write('{"status":"Waiting"}\n');
      return;
    }
    if (mode === "disconnect") {
      res.writeHead(200);
      res.write('{"status":"Waiting"}\n');
      setTimeout(() => res.destroy(), 5);
      return;
    }
    if (mode === "http") {
      res.writeHead(404);
      res.end(JSON.stringify({ message: "manifest unknown" }));
      return;
    }
    if (mode === "error") {
      res.end(
        '{"errorDetail":{"message":"pull access denied"},"error":"denied"}\n',
      );
      return;
    }
    if (mode === "oversize") {
      res.end("x".repeat(1024 * 1024 + 1));
      return;
    }
    const data = Buffer.from(
      '{"id":"layer","status":"下载中","progressDetail":{"current":5,"total":10}}\n{"status":"Done"}',
    );
    const offset = data.indexOf(Buffer.from("下载")) + 1;
    res.write(data.subarray(0, offset));
    setTimeout(() => res.end(data.subarray(offset)), 5);
  });
  server.listen(socket);
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  });
  const docker = new DockerEngine(socket),
    events: PullEvent[] = [];
  await docker.pullImage("nebuctf/demo:v1", (e) => events.push(e));
  assert.equal(requested, "/v1.45/images/create?fromImage=nebuctf%2Fdemo%3Av1");
  assert.equal(events[0]?.status, "下载中");
  assert.equal(events[0]?.progressDetail?.current, 5);
  assert.equal(events.at(-1)?.status, "Done");
  mode = "http";
  await assert.rejects(
    docker.pullImage("nebuctf/demo", () => {}),
    /manifest unknown/,
  );
  mode = "error";
  await assert.rejects(
    docker.pullImage("nebuctf/demo", () => {}),
    /pull access denied/,
  );
  mode = "oversize";
  await assert.rejects(
    docker.pullImage("nebuctf/demo", () => {}),
    /响应过长/,
  );
  mode = "disconnect";
  await assert.rejects(
    docker.pullImage("nebuctf/demo", () => {}),
    /连接中断|aborted/,
  );
  mode = "abort";
  const controller = new AbortController();
  const interrupted = docker.pullImage(
    "nebuctf/demo",
    () => controller.abort(),
    controller.signal,
  );
  await assert.rejects(interrupted, /abort/i);
});

class ImagesDocker extends DockerEngine {
  images: ImageInfo[] = [];
  failure = false;
  async listImages() {
    return this.images;
  }
  async inspectImage() {
    return {};
  }
  async pullImage(ref: string, onProgress: (e: PullEvent) => void) {
    onProgress({
      id: "abc",
      status: "Downloading",
      progressDetail: { current: 50, total: 100 },
    });
    if (this.failure)
      throw Error(
        "registry unavailable https://secret:password@registry.test/v2?token=secret",
      );
    for (let i = 0; i < 230; i++) onProgress({ status: `entry ${i}` });
    onProgress({ id: "abc", status: "Pull complete" });
    this.images.push({
      Id: "sha256:abc",
      RepoTags: [ref],
      RepoDigests: [],
      Size: 1024,
    });
  }
}

test(
  "admin image inventory, persistent pulls and isolated test environments",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      docker = new ImagesDocker(),
      worker = new ImageWorker(db, docker);
    const temp = await mkdtemp(join(tmpdir(), "nct-art-")),
      oldDir = config.DATA_DIR;
    config.DATA_DIR = temp;
    t.after(async () => {
      await worker.stop();
      await app.close();
      await db.close();
      config.DATA_DIR = oldDir;
      await rm(temp, { recursive: true, force: true });
    });
    const get = (path: string, cookie = "") =>
      verified(app, { url: `/api${path}`, headers: { cookie } });
    const write = (
      path: string,
      cookie: string,
      payload: unknown = {},
      method: "POST" | "PUT" = "POST",
    ) =>
      verified(app, {
        url: `/api${path}`,
        method,
        headers: {
          cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload: payload as any,
      });
    async function register(name: string) {
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
    const admin = await register("imageadmin"),
      user = await register("imageuser");
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
    const input = {
      title: "Image draft",
      category: "Web",
      difficulty: "入门",
      kind: "dynamic_container",
      image: "nebuctf/demo:v1",
      published: false,
      practice: false,
    };
    const created = await write("/admin/challenges", admin.cookie, input);
    assert.equal(created.statusCode, 200, created.body);
    const cid = created.json().id,
      path = `/admin/challenges/${cid}/test-instance`;
    async function terminal(jid: string) {
      for (let i = 0; i < 200; i++) {
        const r = (
          await get(`/admin/images/pulls/${jid}`, admin.cookie)
        ).json();
        if (["succeeded", "failed"].includes(r.status)) return r;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error("pull did not finish");
    }
    await t.test(
      "admin and CSRF boundaries; worker unavailable and invalid references",
      async () => {
        assert.equal((await get("/admin/images")).statusCode, 401);
        assert.equal((await get("/admin/images", user.cookie)).statusCode, 403);
        assert.equal(
          (
            await write("/admin/images/pull", user.cookie, {
              image: input.image,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await verified(app, {
              url: "/api/admin/images/pull",
              method: "POST",
              headers: { cookie: admin.cookie },
              payload: { image: input.image },
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await write("/admin/images/pull", admin.cookie, {
              image: input.image,
            })
          ).statusCode,
          409,
        );
        for (const image of [
          "https://evil/image",
          "other/demo",
          "nebuctf/../evil",
        ])
          assert.equal(
            (await write("/admin/images/pull", admin.cookie, { image }))
              .statusCode,
            400,
          );
        assert.equal(
          (
            await get(
              `/admin/challenges/${crypto.randomUUID()}/test-instance`,
              admin.cookie,
            )
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      "inventory links draft challenges, reconciles missing images and paginates literal searches",
      async () => {
        docker.images = [
          {
            Id: "sha256:local",
            RepoTags: ["nebuctf/local:latest"],
            RepoDigests: [],
            Size: 2048,
          },
          {
            Id: "sha256:private",
            RepoTags: ["other/hidden:latest"],
            RepoDigests: [],
            Size: 1024,
          },
        ];
        await worker.sync();
        const list = (await get("/admin/images", admin.cookie)).json();
        assert.equal(list.total, 2);
        assert.equal(list.worker.online, true);
        assert.deepEqual(
          list.items.find((i: any) => i.image === imageKey(input.image))
            .challenges,
          [{ id: cid, title: input.title }],
        );
        assert.equal(
          (
            await get(
              "/admin/images?q=Image%20draft&state=missing",
              admin.cookie,
            )
          ).json().total,
          1,
        );
        assert.equal(
          (await get("/admin/images?q=%25", admin.cookie)).json().total,
          0,
        );
        assert.equal(
          (await get("/admin/images?page=2", admin.cookie)).json().total,
          2,
        );
        assert.equal(
          (await get("/admin/images?page=2", admin.cookie)).json().items.length,
          0,
        );
        docker.images = [];
        await worker.sync();
        assert.equal(
          (
            await get("/admin/images/status?image=nebuctf/local", admin.cookie)
          ).json().present,
          false,
        );
        assert.equal((await write(path, admin.cookie)).statusCode, 409);
      },
    );
    let jid: string;
    await t.test(
      "concurrent canonical aliases deduplicate, progress survives dialog closure and logs are bounded",
      async () => {
        const responses = await Promise.all(
          [input.image, "docker.io/nebuctf/demo:v1"].map((image) =>
            write("/admin/images/pull", admin.cookie, { image }),
          ),
        );
        for (const r of responses) assert.equal(r.statusCode, 200, r.body);
        jid = responses[0]!.json().id;
        assert.equal(jid, responses[1]!.json().id);
        assert.equal(
          (await get(`/admin/images/pulls/${jid}`, user.cookie)).statusCode,
          403,
        );
        assert.equal(
          (await get("/admin/images?state=pulling", admin.cookie)).json().total,
          1,
        );
        await worker.tick();
        const job = await terminal(jid);
        assert.equal(job.status, "succeeded");
        assert.equal(job.layers[0].status, "Pull complete");
        assert.equal(job.logs.length, 200);
        const ready = (
          await get(`/admin/images/status?image=${input.image}`, admin.cookie)
        ).json();
        assert.equal(ready.present, true);
        assert.equal(ready.job_id, jid);
      },
    );
    await t.test(
      "failures retain sanitized detail and a new attempt can succeed",
      async () => {
        docker.failure = true;
        const first = await write("/admin/images/pull", admin.cookie, {
          image: "nebuctf/failure:tag",
        });
        assert.equal(first.statusCode, 200, first.body);
        await worker.tick();
        const failed = await terminal(first.json().id);
        assert.equal(failed.status, "failed");
        assert.match(failed.error, /registry unavailable/);
        assert.doesNotMatch(JSON.stringify(failed), /password|token=|secret/);
        docker.failure = false;
        const retry = await write("/admin/images/pull", admin.cookie, {
          image: "nebuctf/failure:tag",
        });
        assert.notEqual(retry.json().id, first.json().id);
        await worker.tick();
        assert.equal((await terminal(retry.json().id)).status, "succeeded");
      },
    );
    await t.test(
      "draft preview snapshots current settings, cannot leak into practice, and respects cooldown and quotas",
      async () => {
        const current = {
          image: input.image,
          port: 9090,
          cpu: 600,
          memory: 128,
          access_mode: "domain",
        };
        const a = await write(path, admin.cookie, current);
        assert.equal(a.statusCode, 200, a.body);
        const iid = a.json().id;
        assert.equal((await write(path, admin.cookie, current)).json().id, iid);
        const [row] = await db.query("SELECT * FROM instances WHERE id=$1", [
          iid,
        ]);
        assert.equal(row!.scope, "test");
        assert.equal(row!.owner_key, `u:${admin.id}`);
        assert.equal(row!.spec.port, 9090);
        assert.equal(row!.spec.ttl, 600);
        assert.notDeepEqual(
          containerConfig(row!).Env,
          containerConfig({ ...row!, scope: "practice" }).Env,
        );
        assert.equal(
          (await get("/instances?scope=practice", admin.cookie)).json().items
            .length,
          0,
        );
        assert.equal(
          (await get("/instances?scope=test", admin.cookie)).statusCode,
          400,
        );
        assert.equal((await write(path, user.cookie)).statusCode, 403);
        assert.equal(
          (await write(`/instances/${iid}/stop`, user.cookie)).statusCode,
          403,
        );
        assert.equal(
          (await write(`/instances/${iid}/renew`, admin.cookie)).statusCode,
          400,
        );
        const cooldown = await write(`/instances/${iid}/stop`, admin.cookie);
        assert.equal(cooldown.statusCode, 429);
        assert.ok(cooldown.json().retry_after > 0);
        const edited = await write(
          `/admin/challenges/${cid}`,
          admin.cookie,
          { ...input, port: 8088 },
          "PUT",
        );
        assert.equal(edited.statusCode, 200, edited.body);
        assert.equal(
          (await db.query("SELECT spec FROM instances WHERE id=$1", [iid]))[0]!
            .spec.port,
          9090,
        );
        const limit = config.MAX_OWNER_INSTANCES;
        config.MAX_OWNER_INSTANCES = 1;
        try {
          const b = await write("/admin/challenges", admin.cookie, {
            ...input,
            title: "Second",
          });
          const r = await write(
            `/admin/challenges/${b.json().id}/test-instance`,
            admin.cookie,
          );
          assert.equal(r.statusCode, 409);
          assert.equal(r.json().action.href, "/admin/resources");
        } finally {
          config.MAX_OWNER_INSTANCES = limit;
        }
        await db.query(
          "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
          [`resource:u:${admin.id}:test:${cid}`],
        );
        assert.equal(
          (await write(`/instances/${iid}/stop`, admin.cookie)).statusCode,
          200,
        );
        await db.query("UPDATE instances SET status='stopped' WHERE id=$1", [
          iid,
        ]);
        assert.equal((await write(path, admin.cookie)).statusCode, 429);
      },
    );
    await t.test(
      "test artifacts stay admin-only even if their owner is demoted",
      async () => {
        const id = crypto.randomUUID();
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(temp, "files"));
        await writeFile(join(temp, "files", id), "testzip");
        await db.query(
          "INSERT INTO instances(id,challenge_id,scope,owner_key,requested_by,kind,status,spec,artifact_size,expires_at,max_expires_at) VALUES($1,$2,'test',$3,$4,'dynamic_attachment','ready','{}',7,now()+interval '10 minutes',now()+interval '15 minutes')",
          [id, cid, `u:${admin.id}`, admin.id],
        );
        assert.equal(
          (await get(`/instances/${id}/artifact`, admin.cookie)).body,
          "testzip",
        );
        assert.equal(
          (await get(`/instances/${id}/artifact`, user.cookie)).statusCode,
          403,
        );
        await db.query("UPDATE users SET role='user' WHERE id=$1", [admin.id]);
        assert.equal(
          (await get(`/instances/${id}/artifact`, admin.cookie)).statusCode,
          403,
        );
        assert.equal(
          (await write(`/instances/${id}/stop`, admin.cookie)).statusCode,
          403,
        );
        await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
      },
    );
    await t.test("inventory pagination and bounded pull queue", async () => {
      docker.images.push(
        ...Array.from({ length: 30 }, (_, n) => ({
          Id: `sha256:extra${n}`,
          RepoTags: [`nebuctf/extra-${n}:latest`],
          RepoDigests: [],
          Size: 1024,
        })),
      );
      await worker.sync();
      const first = (await get("/admin/images", admin.cookie)).json(),
        second = (await get("/admin/images?page=2", admin.cookie)).json();
      assert.equal(first.items.length, 24);
      assert.equal(first.items.length + second.items.length, first.total);
      assert.equal(
        new Set([...first.items, ...second.items].map((i: any) => i.image))
          .size,
        first.total,
      );
      const used = (await get("/admin/images?usage=used", admin.cookie)).json();
      const unused = (
        await get("/admin/images?usage=unused", admin.cookie)
      ).json();
      const unusedNext = (
        await get("/admin/images?usage=unused&page=2", admin.cookie)
      ).json();
      assert(used.total > 0);
      assert(unused.total >= 30);
      assert.equal(used.total + unused.total, first.total);
      assert.deepEqual(used.counts, unused.counts);
      assert.equal(used.counts.used, used.total);
      assert(used.items.every((i: any) => i.challenges.length > 0));
      assert(
        [...unused.items, ...unusedNext.items].every(
          (i: any) => i.challenges.length === 0,
        ),
      );
      assert.equal(
        new Set([...unused.items, ...unusedNext.items].map((i: any) => i.image))
          .size,
        unused.total,
      );
      const filtered = (
        await get(
          "/admin/images?usage=unused&q=extra-&state=present",
          admin.cookie,
        )
      ).json();
      assert.equal(filtered.total, 30);
      assert.deepEqual(filtered.counts, { used: 0, unused: 30 });
      const none = (
        await get("/admin/images?usage=used&q=extra-", admin.cookie)
      ).json();
      assert.equal(none.total, 0);
      assert.equal(none.items.length, 0);
      assert.equal(
        (await get("/admin/images?usage=invalid", admin.cookie)).statusCode,
        400,
      );
      const grouped = (
        await get("/admin/images?usage=used&group_by=challenge", admin.cookie)
      ).json();
      assert(grouped.group_total > 0);
      for (const group of grouped.groups) {
        const expected = used.items.filter((i: any) =>
          i.challenges.some((c: any) => c.id === group.id),
        );
        assert.deepEqual(
          group.items.map((i: any) => i.image).sort(),
          expected.map((i: any) => i.image).sort(),
        );
      }
      const fixtures = Array.from({ length: 14 }, (_, i) => ({
        id: crypto.randomUUID(),
        title: `Group fixture ${String(i).padStart(2, "0")}`,
      }));
      for (let i = 0; i < 28; i++) {
        await db.query(
          "INSERT INTO docker_images(image,present,challenges) VALUES($1,true,$2)",
          [
            `docker.io/nebuctf/group-fixture-${i}:latest`,
            JSON.stringify([fixtures[Math.floor(i / 2)]]),
          ],
        );
      }
      const groupPage1 = (
        await get(
          "/admin/images?usage=used&group_by=challenge&q=group-fixture",
          admin.cookie,
        )
      ).json();
      const groupPage2 = (
        await get(
          "/admin/images?usage=used&group_by=challenge&q=group-fixture&page=2",
          admin.cookie,
        )
      ).json();
      assert.equal(groupPage1.group_total, 14);
      assert.equal(groupPage1.groups.length, 12);
      assert.equal(groupPage2.groups.length, 2);
      assert(
        [...groupPage1.groups, ...groupPage2.groups].every(
          (g: any) => g.items.length === 2,
        ),
      );
      assert.equal(
        new Set(
          [...groupPage1.groups, ...groupPage2.groups].map((g: any) => g.id),
        ).size,
        14,
      );
      const sharedImage = "docker.io/nebuctf/group-fixture-0:latest";
      await db.query("UPDATE docker_images SET challenges=$2 WHERE image=$1", [
        sharedImage,
        JSON.stringify(fixtures.slice(0, 2)),
      ]);
      const sharedGroups = (
        await get(
          "/admin/images?usage=used&group_by=challenge&q=group-fixture-0:",
          admin.cookie,
        )
      ).json();
      assert.equal(sharedGroups.groups.length, 2);
      assert.equal(sharedGroups.counts.used, 1);
      const titleGroup = (
        await get(
          "/admin/images?usage=used&group_by=challenge&q=Group%20fixture%2000",
          admin.cookie,
        )
      ).json();
      assert.equal(titleGroup.groups.length, 1);
      assert.equal(titleGroup.groups[0].id, fixtures[0]!.id);
      for (let n = 0; n < 16; n++)
        await db.query(
          "INSERT INTO docker_image_pulls(id,image,reference,requested_by,status) VALUES($1,$2,$3,$4,'queued')",
          [
            crypto.randomUUID(),
            imageKey(`nebuctf/extra-${n}`),
            `nebuctf/extra-${n}`,
            admin.id,
          ],
        );
      const full = await write("/admin/images/pull", admin.cookie, {
        image: input.image,
      });
      assert.equal(full.statusCode, 409);
      assert.match(full.json().error, /队列已满/);
      await db.query(
        "UPDATE docker_image_pulls SET status='failed' WHERE status='queued'",
      );
    });
    await t.test(
      "restart marks an interrupted pull failed and stale worker status blocks new pulls",
      async () => {
        await db.query(
          "UPDATE docker_image_pulls SET status='pulling',finished_at=NULL WHERE id=$1",
          [jid],
        );
        await new ImageWorker(db, docker).tick();
        assert.equal((await terminal(jid)).status, "failed");
        await db.query(
          "UPDATE docker_worker_status SET checked_at=now()-interval '2 minutes'",
        );
        assert.equal(
          (
            await write("/admin/images/pull", admin.cookie, {
              image: input.image,
            })
          ).statusCode,
          409,
        );
      },
    );
  },
);
