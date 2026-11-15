import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DockerEngine,
  DockerError,
  type ContainerInfo,
  type NetworkInfo,
} from "../src/docker.js";
import { containerConfig, Worker } from "../src/worker.js";
import type { DB } from "../src/db.js";
import { config } from "../src/config.js";
import {
  cleanupContainerGroup,
  ensureContainerGroup,
  reconcileContainerGroup,
  type ContainerGroupOptions,
} from "../src/container-runtime.js";

const ownerLabel = "io.nebuctf.instance";
const id = "382a7daa-3a8e-46d8-9aee-65e23325a489";
const row = {
  id,
  challenge_id: id,
  kind: "dynamic_container",
  scope: "practice",
  owner_key: "u:test",
  spec: {
    image: "nebuctf/test",
    port: 8080,
    cpu: 500,
    memory: 128,
    ttl: 120,
    access_mode: "port",
    command: ["serve"],
    environment: { CUSTOM: "main", FLAG: "untrusted" },
  },
};
function options(): ContainerGroupOptions {
  return {
    namespace: `nebuctf-${id}`,
    ownerLabel,
    ownerId: id,
    primary: containerConfig(row),
    flagEnvironment: ["FLAG=secret"],
    topology: {
      networks: [
        { name: "default", internal: false },
        { name: "data", internal: true },
      ],
      primary_networks: ["default"],
      services: [
        {
          name: "api",
          image: "nebuctf/api",
          cpu: 250,
          memory: 64,
          networks: ["default", "data"],
          depends_on: ["db"],
          inject_flag: true,
          environment: { FLAG: "fake", CUSTOM: "helper" },
          command: ["helper"],
        },
        {
          name: "db",
          image: "nebuctf/db",
          cpu: 100,
          memory: 32,
          networks: ["data"],
          depends_on: [],
          inject_flag: false,
        },
      ],
    },
  };
}
class GroupDocker extends DockerEngine {
  containers = new Map<string, ContainerInfo>();
  networks = new Map<string, NetworkInfo>();
  configs = new Map<string, Record<string, any>>();
  networkConfigs = new Map<string, Record<string, any>>();
  events: string[] = [];
  missingImage?: string;
  failService?: string;
  delayedService?: string;
  healthReads = 0;
  override async inspectImage(image: string) {
    this.events.push(`image:${image}`);
    if (image === this.missingImage) throw new DockerError(404);
    return {};
  }
  override async inspectContainer(name: string) {
    const info = this.containers.get(name);
    if (!info) throw new DockerError(404);
    if (info.State.Health?.Status === "starting" && ++this.healthReads >= 2) {
      info.State.Health.Status = "healthy";
      this.events.push(`healthy:${name}`);
    }
    return info;
  }
  override async inspectNetwork(name: string) {
    const info = this.networks.get(name);
    if (!info) throw new DockerError(404);
    return info;
  }
  override async createNetwork(spec: Record<string, any>) {
    this.events.push(`network:${spec.Name}`);
    this.networkConfigs.set(spec.Name, spec);
    this.networks.set(spec.Name, {
      Id: spec.Name,
      Labels: spec.Labels,
      Containers: {},
    });
    return {};
  }
  override async createContainer(spec: Record<string, any>) {
    this.events.push(`create:${spec.name}`);
    this.configs.set(spec.name, spec);
    this.containers.set(spec.name, {
      Id: spec.name,
      Config: { Labels: spec.Labels, Env: spec.Env, Cmd: spec.Cmd },
      State: { Running: false, Status: "created" },
      HostConfig: spec.HostConfig,
      NetworkSettings: {
        Ports: { "8080/tcp": [{ HostPort: "32002" }] },
        Networks: Object.fromEntries(
          Object.entries(spec.NetworkingConfig?.EndpointsConfig ?? {}).map(
            ([name, endpoint]) => {
              const aliases = endpoint as { Aliases: string[] };
              return [
                name,
                { IPAddress: "172.20.0.2", Aliases: aliases.Aliases },
              ];
            },
          ),
        ),
      },
    });
    return { Id: spec.name };
  }
  override async startContainer(name: string) {
    this.events.push(`start:${name}`);
    const info = await this.inspectContainer(name);
    info.State = name.endsWith(`-${this.failService}`)
      ? { Running: false, Status: "exited" }
      : { Running: true, Status: "running", Health: { Status: "healthy" } };
    if (name.endsWith(`-${this.delayedService}`))
      info.State.Health = { Status: "starting" };
  }
  override async removeContainer(name: string) {
    this.events.push(`remove:${name}`);
    this.containers.delete(name);
  }
  override async removeNetwork(name: string) {
    this.networks.delete(name);
  }
  override async listContainers(label: string) {
    return [...this.containers.values()]
      .filter((c) => c.Config.Labels[label])
      .map((c) => ({ Id: c.Id, Labels: c.Config.Labels }));
  }
  override async listNetworks(label: string) {
    return [...this.networks.values()].filter((n) => n.Labels[label]);
  }
  override async connectNetwork(
    name: string,
    container: string,
    aliases?: string[],
  ) {
    (await this.inspectContainer(container)).NetworkSettings.Networks[name] = {
      IPAddress: "172.20.0.3",
      Aliases: aliases,
    };
    (await this.inspectNetwork(name)).Containers![container] = {
      Name: container,
    };
  }
  override async disconnectNetwork(name: string, container: string) {
    delete (await this.inspectContainer(container)).NetworkSettings.Networks[
      name
    ];
    delete (await this.inspectNetwork(name)).Containers![container];
  }
}

test("group inspects all images first, orders healthy helpers before main and isolates configuration", async () => {
  const docker = new GroupDocker(),
    o = options();
  docker.delayedService = "db";
  await ensureContainerGroup(docker, o);
  assert.equal(
    docker.events.slice(0, 3).every((event) => event.startsWith("image:")),
    true,
  );
  assert.deepEqual(
    docker.events.filter((event) => event.startsWith("start:")),
    [
      `start:${o.namespace}-db`,
      `start:${o.namespace}-api`,
      `start:${o.namespace}`,
    ],
  );
  assert.ok(
    docker.events.indexOf(`healthy:${o.namespace}-db`) <
      docker.events.indexOf(`start:${o.namespace}-api`),
    "dependencies must be healthy before dependents start",
  );
  const api = docker.configs.get(`${o.namespace}-api`)!;
  assert.deepEqual(api.Env, ["FLAG=secret", "CUSTOM=helper"]);
  assert.deepEqual(api.Cmd, ["helper"]);
  assert.deepEqual(docker.configs.get(`${o.namespace}-db`)!.Env, []);
  assert.equal(api.HostConfig.NanoCpus, 250e6);
  assert.equal(api.HostConfig.Memory, 64 * 1024 * 1024);
  assert.equal(api.HostConfig.MemorySwap, api.HostConfig.Memory);
  assert.deepEqual(api.HostConfig.PortBindings, {});
  assert.deepEqual(api.HostConfig.CapDrop, ["ALL"]);
  assert.equal(api.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(Object.keys(api.NetworkingConfig.EndpointsConfig), [
    o.namespace,
    `${o.namespace}-data`,
  ]);
  assert.deepEqual(api.NetworkingConfig.EndpointsConfig[o.namespace].Aliases, [
    "api",
  ]);
  assert.deepEqual(
    docker.configs.get(o.namespace)!.NetworkingConfig.EndpointsConfig[
      o.namespace
    ].Aliases,
    ["main"],
  );
  assert.deepEqual(containerConfig(row).Cmd, ["serve"]);
  assert.ok(!containerConfig(row).Env.includes("FLAG=untrusted"));
  const bridges = [...docker.networkConfigs.values()].map(
    (n) => n.Options["com.docker.network.bridge.name"],
  );
  assert.equal(new Set(bridges).size, 2);
  assert.ok(bridges.every((name) => name.length <= 15));
  await ensureContainerGroup(docker, o);
  assert.equal(
    docker.events.filter((event) => event.startsWith("create:")).length,
    3,
  );
  await cleanupContainerGroup(docker, {
    namespace: o.namespace,
    ownerLabel,
    ownerId: id,
  });
  assert.equal(docker.containers.size + docker.networks.size, 0);
});

test("missing helper images allocate nothing and helper failure rolls back the entire group", async () => {
  const docker = new GroupDocker(),
    o = options();
  docker.missingImage = "nebuctf/db";
  await assert.rejects(ensureContainerGroup(docker, o));
  assert.equal(
    docker.events.some(
      (event) =>
        event.startsWith("network:") ||
        event.startsWith("create:") ||
        event.startsWith("start:"),
    ),
    false,
  );
  docker.missingImage = undefined;
  docker.failService = "api";
  await assert.rejects(ensureContainerGroup(docker, o), /container exited/);
  assert.equal(docker.events.includes(`start:${o.namespace}`), false);
  assert.equal(docker.containers.size + docker.networks.size, 0);
});

test("ownership checks protect existing helpers, networks and orphan cleanup", async () => {
  const docker = new GroupDocker(),
    o = options();
  await docker.createNetwork({
    Name: `${o.namespace}-data`,
    Labels: { [ownerLabel]: "foreign" },
  });
  await assert.rejects(
    ensureContainerGroup(docker, o),
    /ownership mismatch|cleanup failed/,
  );
  assert.equal(docker.networks.size, 1);
  docker.networks.clear();
  await docker.createContainer({
    name: `${o.namespace}-db`,
    Labels: { [ownerLabel]: "foreign" },
    HostConfig: {},
  });
  await assert.rejects(
    ensureContainerGroup(docker, o),
    /ownership mismatch|cleanup failed/,
  );
  assert.equal(docker.containers.size, 1);
  docker.containers.clear();
  await ensureContainerGroup(docker, o);
  const helper = await docker.inspectContainer(`${o.namespace}-api`);
  helper.Config.Labels[ownerLabel] = "foreign";
  await assert.rejects(
    reconcileContainerGroup(docker, o),
    /ownership mismatch/,
  );
  await cleanupContainerGroup(docker, {
    namespace: o.namespace,
    ownerLabel,
    ownerId: id,
  });
  assert.equal(docker.containers.size, 1, "unowned helper is never removed");
});

test("reconcile repairs owned attachments and the trusted gateway, and notices helper exits", async () => {
  const docker = new GroupDocker(),
    o = options();
  o.accessMode = "domain";
  o.gateway = config.GATEWAY_CONTAINER;
  docker.containers.set(o.gateway, {
    Id: o.gateway,
    Config: { Labels: { "io.nebuctf.gateway": "true" } },
    State: { Running: true, Status: "running" },
    NetworkSettings: { Networks: {}, Ports: {} },
  });
  await ensureContainerGroup(docker, o);
  await docker.disconnectNetwork(o.namespace, `${o.namespace}-api`);
  await docker.disconnectNetwork(o.namespace, o.gateway);
  await reconcileContainerGroup(docker, o);
  assert.deepEqual(
    (await docker.inspectContainer(`${o.namespace}-api`)).NetworkSettings
      .Networks[o.namespace]!.Aliases,
    ["api"],
  );
  assert.ok(
    (await docker.inspectContainer(o.gateway)).NetworkSettings.Networks[
      o.namespace
    ],
  );
  (await docker.inspectContainer(o.gateway)).Config.Labels[
    "io.nebuctf.gateway"
  ] = "false";
  await assert.rejects(reconcileContainerGroup(docker, o), /untrusted gateway/);
  (await docker.inspectContainer(o.gateway)).Config.Labels[
    "io.nebuctf.gateway"
  ] = "true";
  (await docker.inspectContainer(`${o.namespace}-db`)).State.Running = false;
  await assert.rejects(reconcileContainerGroup(docker, o), /container exited/);
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql);
      return sql.includes("SELECT * FROM instances WHERE status='running'")
        ? [{ ...row, spec: { ...row.spec, topology: o.topology } }]
        : [{ status: "stopping" }];
    },
  } as unknown as DB;
  await new Worker(db, docker).reconcile();
  assert.ok(calls.some((sql) => sql.includes("status='stopping'")));
  assert.equal(
    docker.containers.size,
    1,
    "helper exit removes every owned member immediately",
  );
  await ensureContainerGroup(docker, o);
  (await docker.inspectContainer(o.gateway)).Config.Labels[
    "io.nebuctf.gateway"
  ] = "false";
  await assert.rejects(cleanupContainerGroup(docker, o), /untrusted gateway/);
  assert.equal(
    docker.containers.size,
    1,
    "all owned members removed despite gateway cleanup failure",
  );
});

test("judge namespace supports a renamed primary and forces internal networks", async () => {
  const docker = new GroupDocker(),
    o = options();
  o.namespace = `nebuctf-judge-${id}`;
  o.ownerLabel = "io.nebuctf.judge";
  o.primary = { ...o.primary, name: `${o.namespace}-target` };
  o.forceInternal = true;
  await ensureContainerGroup(docker, o);
  assert.ok(
    [...docker.networkConfigs.values()].every((n) => n.Internal === true),
  );
  assert.ok(docker.containers.has(`${o.namespace}-target`));
  await cleanupContainerGroup(docker, {
    namespace: o.namespace,
    ownerLabel: o.ownerLabel,
    ownerId: id,
  });
  assert.equal(docker.containers.size + docker.networks.size, 0);
});
