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
test("private contest domains recheck the owning team's route before forwarding", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  let selected: string | null = null;
  let scope = "33333333-3333-4333-8333-333333333333";
  const db = {
    query: async (sql: string) => {
      if (sql.includes("FROM instances"))
        return [
          {
            upstream_host: "172.18.0.2",
            upstream_port: 8080,
            expires_at: new Date(Date.now() + 10000),
            scope,
            owner_key: "t:owner",
            challenge_id: id,
          },
        ];
      if (sql.includes("FROM contests"))
        return [
          { practice_mode: false, ends_at: new Date(Date.now() + 60000) },
        ];
      if (sql.includes("FROM contest_challenges"))
        return [id, other].map((challenge_id) => ({
          challenge_id,
          logic: { exclusive_group: "route", dependency: null },
        }));
      if (sql.includes("FROM contest_exclusive_choices"))
        return selected
          ? [
              {
                owner_key: "t:owner",
                group_name: "route",
                challenge_id: selected,
              },
            ]
          : [];
      if (sql.includes("FROM solves")) return [];
      throw new Error("Unexpected gateway query");
    },
  } as unknown as DB;
  const host = `${id}.${config.CHALLENGE_DOMAIN}`;
  assert.ok(await resolveTarget(db, host));
  selected = other;
  assert.equal(await resolveTarget(db, host), null);
  selected = id;
  assert.ok(await resolveTarget(db, host));
  scope = "practice";
  selected = other;
  assert.ok(await resolveTarget(db, host));
});
