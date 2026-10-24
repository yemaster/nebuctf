import { test } from "node:test";
import assert from "node:assert/strict";
import { challengePortRange, config } from "../src/config.js";
import { containerConfig } from "../src/worker.js";

test("challenge port pools reject invalid, privileged and reversed ranges", () => {
  for (const value of ["", "30000-50000", "1024-65535", "30000-30000"])
    assert.equal(challengePortRange.safeParse(value).success, true, value);
  for (const value of [
    "30000",
    "0-65535",
    "1023-50000",
    "50000-30000",
    "30000-65536",
    "30000-50000/udp",
    " 30000-50000",
    "30000-50000,61001",
    "NaN-50000",
  ])
    assert.equal(challengePortRange.safeParse(value).success, false, value);
});

test("only port environments request a host port from the configured pool", () => {
  const previous = config.CHALLENGE_PORT_RANGE;
  const instance = {
    id: "11111111-1111-4111-8111-111111111111",
    challenge_id: "test",
    scope: "practice",
    owner_key: "u:test",
    kind: "dynamic_container",
    spec: { image: "nebuctf/test", port: 8080, cpu: 100, memory: 32 },
  };
  try {
    config.CHALLENGE_PORT_RANGE = "30000-50000";
    for (const kind of ["dynamic_container", "static_container"])
      assert.deepEqual(
        containerConfig({ ...instance, kind }).HostConfig.PortBindings,
        {
          "8080/tcp": [
            { HostIp: config.CHALLENGE_BIND, HostPort: "30000-50000" },
          ],
        },
      );
    for (const target of [
      { ...instance, kind: "dynamic_attachment" },
      { ...instance, spec: { ...instance.spec, access_mode: "domain" } },
    ])
      assert.deepEqual(containerConfig(target).HostConfig.PortBindings, {});
    config.CHALLENGE_PORT_RANGE = "";
    assert.equal(
      containerConfig(instance).HostConfig.PortBindings["8080/tcp"][0].HostPort,
      "",
    );
  } finally {
    config.CHALLENGE_PORT_RANGE = previous;
  }
});
