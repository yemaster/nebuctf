import { test } from "node:test";
import assert from "node:assert/strict";
import type { DB, Row } from "../src/db.js";
import { config } from "../src/config.js";
import { DockerEngine } from "../src/docker.js";
import { Worker } from "../src/worker.js";

test(
  "Docker port pools allocate concurrently, fail when full and reuse released ports",
  {
    skip: process.env.TEST_PORT_POOL !== "1",
    timeout: 60000,
  },
  async (t) => {
    const previous = config.CHALLENGE_PORT_RANGE;
    const first = 30000 + Math.floor(Math.random() * 19999);
    config.CHALLENGE_PORT_RANGE = `${first}-${first + 1}`;
    const docker = new DockerEngine();
    const db = {
      query: async () => [{ id: "accepted" }],
    } as unknown as DB;
    const worker = new Worker(db, docker);
    const instances: Row[] = Array.from({ length: 3 }, () => ({
      id: crypto.randomUUID(),
      challenge_id: crypto.randomUUID(),
      scope: "practice",
      owner_key: "u:port-pool-test",
      kind: "dynamic_container",
      spec: {
        image: "nebuctf/example-web:local",
        port: 8080,
        cpu: 250,
        memory: 64,
        ttl: 120,
        access_mode: "port",
      },
    }));
    t.after(async () => {
      config.CHALLENGE_PORT_RANGE = previous;
      await Promise.all(instances.map((instance) => worker.cleanup(instance)));
    });
    const starts = await Promise.allSettled(
      instances.slice(0, 2).map((instance) => worker.start(instance)),
    );
    for (let index = 0; index < starts.length; index++) {
      const result = starts[index]!;
      if (result.status === "rejected") {
        const info = await docker.inspectContainer(
          `nebuctf-${instances[index]!.id}`,
        );
        t.diagnostic(JSON.stringify(info.State));
        throw result.reason;
      }
    }
    const ports = await Promise.all(
      instances.slice(0, 2).map(async (instance) => {
        const info = await docker.inspectContainer(`nebuctf-${instance.id}`);
        const port = Number(
          info.NetworkSettings.Ports["8080/tcp"]?.[0]?.HostPort,
        );
        assert.ok(port >= first && port <= first + 1);
        const response = await fetch(
          `http://${config.CHALLENGE_HOST}:${port}/`,
          {
            signal: AbortSignal.timeout(5000),
          },
        );
        assert.equal(response.status, 200);
        return port;
      }),
    );
    assert.equal(
      new Set(ports).size,
      2,
      "concurrent starts cannot share a port",
    );
    await assert.rejects(worker.start(instances[2]!));
    await worker.cleanup(instances[2]!);
    await worker.cleanup(instances[0]!);
    await worker.start(instances[2]!);
    const reused = await docker.inspectContainer(`nebuctf-${instances[2]!.id}`);
    assert.equal(
      Number(reused.NetworkSettings.Ports["8080/tcp"]?.[0]?.HostPort),
      ports[0],
    );
  },
);
