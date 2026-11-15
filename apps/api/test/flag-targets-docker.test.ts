import { test } from "node:test";
import assert from "node:assert/strict";
import { DockerEngine } from "../src/docker.js";
import { containerConfig, Worker } from "../src/worker.js";
import { flagForInstance } from "../src/flag-environment.js";
import type { DB, Row } from "../src/db.js";
import {
  createContainerGroup,
  startContainerGroup,
  cleanupContainerGroup,
  writeGroupFlag,
} from "../src/container-runtime.js";

test(
  "real containers receive disjoint flag environments and AWD files only in chosen targets",
  { skip: process.env.TEST_DOCKER !== "1", timeout: 90000 },
  async (t) => {
    const docker = new DockerEngine(),
      id = crypto.randomUUID();
    const row: Row = {
      id,
      challenge_id: crypto.randomUUID(),
      scope: "practice",
      owner_key: "u:flag-routing-test",
      kind: "dynamic_container",
      spec: {
        image: "nebuctf/example-web:local",
        port: 8080,
        cpu: 500,
        memory: 128,
        ttl: 180,
        access_mode: "port",
        command: ["python", "-B", "-m", "http.server", "8080"],
        parts: ["a", "b"],
        part_targets: { a: ["main"], b: ["vault"] },
        topology: undefined,
      },
    };
    row.spec.topology = {
      networks: [{ name: "default", internal: false }],
      primary_networks: ["default"],
      services: ["vault", "database"].map((name) => ({
        name,
        image: row.spec.image,
        cpu: 500,
        memory: 128,
        networks: ["default"],
        depends_on: [],
        inject_flag: name === "database",
        command: ["python", "-B", "-m", "http.server", "8080"],
      })),
    };
    const db = { query: async () => [{ id: "accepted" }] } as unknown as DB,
      worker = new Worker(db, docker);
    t.after(async () => worker.cleanup(row));
    await worker.start(row);
    const expected = { main: "a", vault: "b", database: null } as const;
    for (const [service, part] of Object.entries(expected)) {
      const info = await docker.inspectContainer(
        `nebuctf-${id}${service === "main" ? "" : "-" + service}`,
      );
      const env = info.Config.Env ?? [];
      for (const key of ["a", "b"])
        assert.equal(
          env.join("\n").includes(flagForInstance(row, key)),
          key === part,
          `${service} receives only assigned flag`,
        );
      assert.ok(!part || env.includes("FLAG_COUNT=1"));
      assert.equal(info.HostConfig?.ReadonlyRootfs, true);
      assert.equal(info.HostConfig?.MemorySwap, info.HostConfig?.Memory);
      assert.ok(info.HostConfig?.CapDrop?.includes("ALL"));
    }
    await worker.cleanup(row);
    const namespace = "nebuctf-file-" + crypto.randomUUID();
    const options = {
      namespace,
      ownerLabel: "io.nebuctf.instance",
      ownerId: id,
      primary: {
        ...containerConfig({
          ...row,
          spec: {
            ...row.spec,
            awd: true,
            flag_mode: "static",
            flag_targets: ["vault"],
          },
        }),
        name: namespace,
        Image: row.spec.image,
        User: "65534:65534",
        Cmd: ["python", "-B", "-m", "http.server", "8080"],
      },
      topology: row.spec.topology,
      flagFiles: ["vault"],
    };
    t.after(async () => cleanupContainerGroup(docker, options));
    await createContainerGroup(docker, options);
    await startContainerGroup(docker, options);
    await writeGroupFlag(
      docker,
      namespace,
      namespace,
      ["vault"],
      "flag{routing-test}",
    );
    // writeFlag executes as the unprivileged target user; missing mounts on an
    // unselected service must prevent writing this file there.
    await assert.rejects(docker.writeFlag(namespace, "flag{routing-test}"));
    await assert.rejects(
      docker.writeFlag(namespace + "-database", "flag{routing-test}"),
    );
  },
);
