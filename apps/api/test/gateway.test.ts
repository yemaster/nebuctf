import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instanceFromHost,
  proxyHeaders,
  resolveTarget,
} from "../src/gateway.js";
import { containerConfig } from "../src/worker.js";
import { config } from "../src/config.js";
import type { DB } from "../src/db.js";
const id = "11111111-1111-4111-8111-111111111111";
test("wildcard routing requires an exact managed domain and UUID host", () => {
  assert.equal(
    instanceFromHost(`${id}.labs.example.net`, "labs.example.net"),
    id,
  );
  for (const host of [
    `${id}.labs.example.net.evil.test`,
    "labs.example.net",
    "127.0.0.1",
    "admin.labs.example.net",
    `${id}.nested.labs.example.net`,
  ])
    assert.equal(instanceFromHost(host, "labs.example.net"), null);
});
test("proxy strips platform cookies, spoofed forwarding and hop-by-hop headers", () => {
  const headers = proxyHeaders({
    headers: {
      host: "test",
      cookie: "__Host-nebu_session=SECRET; nebu_session=SECRET; challenge=ok",
      connection: "x-hidden, keep-alive",
      "x-hidden": "secret",
      "x-forwarded-for": "spoof",
      "proxy-authorization": "secret",
      "x-csrf-protection": "1",
    },
    socket: { remoteAddress: "10.0.0.1" } as any,
  });
  assert.equal(headers.cookie, "challenge=ok");
  assert.equal(headers["x-forwarded-for"], "10.0.0.1");
  assert.equal(headers["x-hidden"], undefined);
  assert.equal(headers["proxy-authorization"], undefined);
  assert.equal(headers["x-csrf-protection"], undefined);
});
test("domain instances publish no host ports while port mode preserves TCP bindings", () => {
  const base = {
    id,
    challenge_id: "c",
    scope: "practice",
    owner_key: "u:1",
    kind: "dynamic_container",
    spec: {
      image: "nebuctf/test",
      cpu: 500,
      memory: 256,
      port: 8080,
      access_mode: "domain",
    },
  };
  assert.deepEqual(containerConfig(base).HostConfig.PortBindings, {});
  const port = containerConfig({
    ...base,
    spec: { ...base.spec, access_mode: "port" },
  });
  assert.equal(port.HostConfig.PortBindings["8080/tcp"][0].HostPort, "");
});
test("gateway never forwards to loopback, public addresses or privileged ports", async () => {
  const dbFor = (host: string, port: number) =>
    ({
      query: async () => [
        {
          upstream_host: host,
          upstream_port: port,
          expires_at: new Date(Date.now() + 10000),
        },
      ],
    }) as unknown as DB;
  for (const [host, port] of [
    ["127.0.0.1", 3000],
    ["169.254.169.254", 8080],
    ["8.8.8.8", 8080],
    ["172.18.0.2", 22],
  ] as const)
    assert.equal(
      await resolveTarget(
        dbFor(host, port),
        `${id}.${config.CHALLENGE_DOMAIN}`,
      ),
      null,
    );
  assert.ok(
    await resolveTarget(
      dbFor("172.18.0.2", 8080),
      `${id}.${config.CHALLENGE_DOMAIN}`,
    ),
  );
});
