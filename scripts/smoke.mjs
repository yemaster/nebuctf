// Explicitly creates/reuses local demonstration accounts and challenges. Never run against production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";
import { request as httpRequest } from "node:http";
import { createHash, randomBytes } from "node:crypto";
const base = process.env.BASE_URL ?? "http://localhost:8080";
const origin = process.env.APP_ORIGIN ?? "http://localhost:8080";
const accounts = JSON.parse(
  await readFile(
    process.env.ACCOUNTS_FILE ?? ".data/local-accounts.json",
    "utf8",
  ),
);
const headers = { origin, "x-csrf-protection": "1" };
async function request(
  path,
  cookie = "",
  body,
  method = body === undefined ? "GET" : "POST",
  retries = 0,
) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  // Release shares the one-minute cooldown with creation. Honor its deadline.
  if (
    r.status === 429 &&
    /^\/instances\/[a-f0-9-]+\/stop$/.test(path) &&
    Number.isInteger(value.retry_after) &&
    value.retry_after >= 1 &&
    value.retry_after <= 60 &&
    retries < 2
  ) {
    await delay(value.retry_after * 1000 + 200);
    return request(path, cookie, body, method, retries + 1);
  }
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(value)}`);
  return { value, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const admin = (await request("/auth/login", "", accounts.admin)).cookie;
let player;
try {
  player = (await request("/auth/login", "", accounts.player)).cookie;
} catch {
  player = (await request("/auth/register", "", accounts.player)).cookie;
}
assert.ok(admin && player);
const existing = [];
for (let page = 1; ; page++) {
  const { value } = await request(
    `/admin/challenges?page=${page}&page_size=100`,
    admin,
  );
  existing.push(...value.items);
  if (existing.length >= value.total || !value.items.length) break;
}
const specifications = [
  {
    title: "端口直连靶机",
    kind: "dynamic_container",
    access_mode: "port",
  },
  {
    title: "泛域名靶机",
    kind: "dynamic_container",
    access_mode: "domain",
  },
  {
    title: "公共容器示例",
    kind: "static_container",
    access_mode: "port",
    flag: "flag{public_container_example}",
  },
  {
    title: "专属附件示例",
    kind: "dynamic_attachment",
    image: "nebuctf/example-attachment:local",
  },
];
const ids = [];
for (const spec of specifications) {
  const old = existing.find((c) => c.title === spec.title);
  ids.push(
    old?.id ??
      (
        await request("/admin/challenges", admin, {
          category: "Web",
          difficulty: "入门",
          image: "nebuctf/example-web:local",
          description:
            spec.kind === "dynamic_attachment"
              ? "生成专属附件，解码其中的 Flag。"
              : "启动环境，访问 /flag 获取示例答案。",
          practice: true,
          published: true,
          ...spec,
        })
      ).value.id,
  );
}
async function instance(cid, cookie) {
  return (await request(`/challenges/${cid}/instances`, cookie, {})).value.id;
}
async function waitFor(iid, status = "running") {
  for (let n = 0; n < 50; n++) {
    const rows = (await request("/admin/resources", admin)).value.items;
    const i = rows.find((v) => v.id === iid);
    if (i?.status === status) return i;
    assert.ok(
      i && !["failed", "stopped"].includes(i.status),
      `instance ${iid}: ${JSON.stringify(i)}`,
    );
    await delay(1000);
  }
  throw Error(`Timeout waiting for ${iid}: ${status}`);
}
async function stop(iid) {
  await request(`/instances/${iid}/stop`, admin, {});
  await waitFor(iid, "stopped");
}
async function portFlag(i) {
  const endpoint = process.env.INSTANCE_HOST
    ? i.endpoint.replace(/^localhost:/, process.env.INSTANCE_HOST + ":")
    : i.endpoint;
  const r = await fetch(`http://${endpoint}/flag`);
  assert.equal(r.status, 200);
  return r.text();
}
const port = await waitFor(await instance(ids[0], player));
const portFlagValue = await portFlag(port);
assert.equal(
  (
    await request(`/challenges/${ids[0]}/submit`, player, {
      flag: portFlagValue,
    })
  ).value.correct,
  true,
);
const domain = await waitFor(await instance(ids[1], player));
const hostname = new URL(domain.endpoint).hostname;
const gateway = process.env.GATEWAY_URL ?? "http://127.0.0.1";
function gatewayGet(path, host, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      new URL(path, gateway),
      { headers: { host, ...extra }, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("gateway timeout")));
    req.end();
  });
}
const proxyResponse = await gatewayGet("/flag", hostname);
assert.equal(proxyResponse.status, 200, proxyResponse.text);
const domainFlag = proxyResponse.text;
assert.notEqual(domainFlag, portFlagValue);
assert.equal(
  (await request(`/challenges/${ids[1]}/submit`, player, { flag: domainFlag }))
    .value.correct,
  true,
);
assert.equal((await gatewayGet("/flag", "invalid.labs.localhost")).status, 404);
const echoed = JSON.parse(
  (
    await gatewayGet("/headers", hostname, {
      cookie: "nebu_session=secret; challenge=ok",
      "x-forwarded-for": "spoof",
    })
  ).text,
);
const lower = Object.fromEntries(
  Object.entries(echoed).map(([k, v]) => [k.toLowerCase(), v]),
);
assert.equal(lower.cookie, "challenge=ok");
assert.notEqual(lower["x-forwarded-for"], "spoof");
await new Promise((resolve, reject) => {
  const key = randomBytes(16).toString("base64");
  const req = httpRequest(new URL("/ws", gateway), {
    headers: {
      host: hostname,
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": key,
    },
  });
  const timer = setTimeout(() => {
    req.destroy();
    reject(Error("WebSocket timeout"));
  }, 5000);
  req.on("error", (e) => {
    clearTimeout(timer);
    reject(e);
  });
  req.on("response", (res) => {
    clearTimeout(timer);
    res.resume();
    reject(Error(`WebSocket rejected: ${res.statusCode}`));
  });
  req.on("upgrade", (res, socket, head) => {
    assert.equal(
      res.headers["sec-websocket-accept"],
      createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64"),
    );
    const text = Buffer.from("nebu-echo"),
      mask = randomBytes(4);
    const payload = Buffer.from(text.map((v, i) => v ^ mask[i % 4]));
    let received = head;
    const check = () => {
      if (received.length < 2 + text.length) return;
      try {
        assert.equal(received[0], 0x81);
        assert.equal(received[1], text.length);
        assert.deepEqual(received.subarray(2, 2 + text.length), text);
        resolve();
      } catch (e) {
        reject(e);
      }
      clearTimeout(timer);
      socket.destroy();
    };
    socket.on("data", (b) => {
      received = Buffer.concat([received, b]);
      check();
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.write(
      Buffer.concat([Buffer.from([0x81, 0x80 | text.length]), mask, payload]),
    );
    check();
  });
  req.end();
});
await stop(port.id);
await stop(domain.id);
const shared = await waitFor(await instance(ids[2], admin));
assert.equal(await portFlag(shared), "flag{public_container_example}");
const denied = await fetch(`${base}/api/challenges/${ids[2]}/instances`, {
  method: "POST",
  headers: { ...headers, cookie: player, "content-type": "application/json" },
  body: "{}",
});
assert.equal(denied.status, 403);
const artifact = await waitFor(await instance(ids[3], player), "ready");
const zipResponse = await fetch(
  `${base}/api/instances/${artifact.id}/artifact`,
  { headers: { cookie: player } },
);
assert.equal(zipResponse.status, 200);
const zip = Buffer.from(await zipResponse.arrayBuffer());
assert.equal(zip.readUInt32LE(0), 0x04034b50);
const start = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
const compressed = zip.subarray(start, start + zip.readUInt32LE(18));
const content =
  zip.readUInt16LE(8) === 8 ? inflateRawSync(compressed) : compressed;
const flag = Buffer.from(content.toString().trim(), "base64").toString();
assert.match(flag, /^flag\{.+\}$/);
assert.equal(
  (await request(`/challenges/${ids[3]}/submit`, player, { flag })).value
    .correct,
  true,
);
await stop(artifact.id);
const staticId = (await request("/challenges", player)).value.items.find(
  (c) => c.title === "初识 Flag",
)?.id;
assert.ok(staticId);
const form = new FormData();
form.append(
  "file",
  new Blob(["NebuCTF static attachment\nflag{hello_nebuctf}\n"]),
  "welcome.txt",
);
const upload = await fetch(
  `${base}/api/admin/challenges/${staticId}/attachments`,
  { method: "POST", headers: { ...headers, cookie: admin }, body: form },
);
assert.equal(upload.status, 200, await upload.clone().text());
const aid = (await upload.json()).id;
const download = await fetch(`${base}/api/attachments/${aid}`, {
  headers: { cookie: player },
});
assert.equal(
  await download.text(),
  "NebuCTF static attachment\nflag{hello_nebuctf}\n",
);
console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "login/register",
        "admin authoring",
        "dynamic port + flag validation",
        "wildcard HTTP/WebSocket + isolated flag + header isolation",
        "public container",
        "dynamic ZIP + flag validation",
        "static upload/download",
        "stop/reclaim",
      ],
      shared: { id: shared.id, endpoint: shared.endpoint },
      challenge_ids: ids,
    },
    null,
    2,
  ),
);
