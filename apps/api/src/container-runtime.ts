import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DockerEngine, type ContainerInfo } from "./docker.js";
import { validateImage } from "./resources.js";
import type { ContainerTopology } from "./container-topology.js";

export interface GroupIdentity {
  namespace: string;
  ownerLabel: string;
  ownerId: string;
  gateway?: string;
  topology?: ContainerTopology;
  primary?: Record<string, any>;
}
export interface ContainerGroupOptions extends GroupIdentity {
  primary: Record<string, any>;
  flagEnvironment?: string[];
  flagEnvironments?: Record<string, string[]>;
  flagFiles?: string[];
  accessMode?: string;
  legacyIcc?: boolean;
  forceInternal?: boolean;
  waitForPrimary?: boolean;
}
const missing = (e: unknown) =>
  e !== null &&
  typeof e === "object" &&
  "statusCode" in e &&
  e.statusCode === 404;
function owned(
  labels: Record<string, string> | undefined,
  o: GroupIdentity,
  kind: string,
) {
  if (labels?.[o.ownerLabel] !== o.ownerId)
    throw Error(`${kind} ownership mismatch`);
}
export function groupNetworkName(namespace: string, network = "default") {
  return network === "default" ? namespace : `${namespace}-${network}`;
}
function networks(o: ContainerGroupOptions) {
  if (o.primary.NetworkDisabled) return [];
  return (
    o.topology?.networks ?? [
      { name: "default", internal: o.accessMode === "domain" },
    ]
  );
}
export function mergeEnvironment(
  custom: Record<string, string> | undefined,
  injected: string[] = [],
) {
  const values = new Map(Object.entries(custom ?? {}));
  for (const entry of injected) {
    const equals = entry.indexOf("=");
    if (equals !== -1)
      values.set(entry.slice(0, equals), entry.slice(equals + 1));
  }
  return [...values].map(([key, value]) => `${key}=${value}`);
}
interface GroupMember {
  alias: string;
  name: string;
  networks: string[];
  config: Record<string, any>;
}
function members(o: ContainerGroupOptions): GroupMember[] {
  const helpers = o.topology?.services ?? [];
  const ordered: typeof helpers = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw Error("cyclic service dependency");
    const service = helpers.find((s) => s.name === name);
    if (!service) throw Error("unknown service dependency");
    visiting.add(name);
    for (const dependency of service.depends_on) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(service);
  };
  for (const service of helpers) visit(service.name);
  return [
    ...ordered.map((service) => ({
      alias: service.name,
      name: `${o.namespace}-${service.name}`,
      networks: service.networks,
      config: {
        name: `${o.namespace}-${service.name}`,
        Image: service.image,
        User: "65534:65534",
        ...(service.command ? { Cmd: service.command } : {}),
        Env: mergeEnvironment(
          service.environment,
          o.flagEnvironments?.[service.name] ??
            (service.inject_flag ? o.flagEnvironment : []),
        ),
        ExposedPorts: {},
        Labels: {
          [o.ownerLabel]: o.ownerId,
          "io.nebuctf.service": service.name,
        },
        HostConfig: {
          Memory: service.memory * 1024 * 1024,
          MemorySwap: service.memory * 1024 * 1024,
          NanoCpus: service.cpu * 1e6,
          PidsLimit: 128,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          ReadonlyRootfs: true,
          Privileged: false,
          RestartPolicy: { Name: "no" },
          Tmpfs: {
            "/tmp": "rw,noexec,nosuid,nodev,size=32m,mode=1777",
            ...(o.flagFiles?.includes(service.name)
              ? { "/run/nebuctf": "rw,noexec,nosuid,nodev,size=1m,mode=1777" }
              : {}),
          },
          PortBindings: {},
          LogConfig: {
            Type: "json-file",
            Config: { "max-size": "1m", "max-file": "2" },
          },
          Ulimits: [{ Name: "nofile", Soft: 1024, Hard: 1024 }],
        },
      } as Record<string, any>,
    })),
    {
      alias: "main",
      name: String(o.primary.name),
      networks: o.primary.NetworkDisabled
        ? []
        : (o.topology?.primary_networks ?? ["default"]),
      config: {
        ...o.primary,
        Labels: {
          ...o.primary.Labels,
          [o.ownerLabel]: o.ownerId,
          "io.nebuctf.service": "main",
        },
      },
    },
  ];
}
async function inspectOwnedContainer(
  docker: DockerEngine,
  name: string,
  o: GroupIdentity,
) {
  try {
    const info = await docker.inspectContainer(name);
    owned(info.Config.Labels, o, "container");
    return info;
  } catch (e) {
    if (!missing(e)) throw e;
  }
}
async function ensureNetworks(docker: DockerEngine, o: ContainerGroupOptions) {
  for (const network of networks(o)) {
    const name = groupNetworkName(o.namespace, network.name);
    try {
      owned((await docker.inspectNetwork(name)).Labels, o, "network");
    } catch (e) {
      if (!missing(e)) throw e;
      const internal = o.forceInternal || network.internal;
      const hash = createHash("sha256").update(name).digest("hex").slice(0, 10);
      await docker.createNetwork({
        Name: name,
        Driver: "bridge",
        Internal: internal,
        Labels: {
          [o.ownerLabel]: o.ownerId,
          "io.nebuctf.access":
            network.name === "default" ? (o.accessMode ?? "port") : "private",
        },
        Options: {
          "com.docker.network.bridge.enable_icc":
            o.topology || o.legacyIcc || internal ? "true" : "false",
          "com.docker.network.bridge.name": `${internal ? "nctd" : "nctf"}-${hash}`,
        },
      });
    }
  }
}
async function attachGateway(docker: DockerEngine, o: ContainerGroupOptions) {
  if (!o.gateway || o.accessMode !== "domain" || o.primary.NetworkDisabled)
    return;
  const name = groupNetworkName(o.namespace);
  owned((await docker.inspectNetwork(name)).Labels, o, "network");
  const gateway = await docker.inspectContainer(o.gateway);
  if (gateway.Config.Labels?.["io.nebuctf.gateway"] !== "true")
    throw Error("untrusted gateway container");
  if (!gateway.NetworkSettings.Networks[name])
    await docker.connectNetwork(name, o.gateway);
}
async function repairAttachments(
  docker: DockerEngine,
  o: ContainerGroupOptions,
  member: GroupMember,
  info: ContainerInfo,
) {
  const expected = member.networks.map((n) => groupNetworkName(o.namespace, n));
  for (const attached of Object.keys(info.NetworkSettings.Networks)) {
    if (
      o.primary.NetworkDisabled &&
      member.alias === "main" &&
      attached === "none"
    )
      continue;
    if (!expected.includes(attached))
      throw Error("unexpected container network attachment");
    owned((await docker.inspectNetwork(attached)).Labels, o, "network");
  }
  for (const name of expected) {
    owned((await docker.inspectNetwork(name)).Labels, o, "network");
    const endpoint = info.NetworkSettings.Networks[name];
    if (!endpoint)
      await docker.connectNetwork(name, member.name, [member.alias]);
    else if (o.topology && !endpoint.Aliases?.includes(member.alias)) {
      await docker.disconnectNetwork(name, member.name);
      await docker.connectNetwork(name, member.name, [member.alias]);
    }
  }
}
export async function createContainerGroup(
  docker: DockerEngine,
  o: ContainerGroupOptions,
) {
  const group = members(o);
  for (const service of o.topology?.services ?? [])
    validateImage(service.image);
  // Fail before allocating or starting anything if any image is unavailable.
  for (const image of new Set(group.map((m) => String(m.config.Image))))
    await docker.inspectImage(image);
  for (const member of group)
    await inspectOwnedContainer(docker, member.name, o);
  for (const network of networks(o)) {
    try {
      owned(
        (
          await docker.inspectNetwork(
            groupNetworkName(o.namespace, network.name),
          )
        ).Labels,
        o,
        "network",
      );
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  await ensureNetworks(docker, o);
  await attachGateway(docker, o);
  for (const member of group) {
    let info = await inspectOwnedContainer(docker, member.name, o);
    if (!info) {
      const endpoints = Object.fromEntries(
        member.networks.map((name) => [
          groupNetworkName(o.namespace, name),
          { Aliases: [member.alias] },
        ]),
      );
      await docker.createContainer({
        ...member.config,
        HostConfig: {
          ...member.config.HostConfig,
          NetworkMode: member.networks.length
            ? groupNetworkName(o.namespace, member.networks[0])
            : "none",
        },
        ...(member.networks.length
          ? { NetworkingConfig: { EndpointsConfig: endpoints } }
          : {}),
      });
      info = (await inspectOwnedContainer(docker, member.name, o))!;
    }
    await repairAttachments(docker, o, member, info);
  }
}
async function healthy(docker: DockerEngine, name: string, o: GroupIdentity) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const info = await inspectOwnedContainer(docker, name, o);
    if (!info?.State.Running) throw Error(`container exited: ${name}`);
    if (!info.State.Health || info.State.Health.Status === "healthy")
      return info;
    if (info.State.Health.Status !== "starting" || Date.now() >= deadline)
      throw Error(`container health check failed: ${name}`);
    await delay(500);
  }
}
export async function startContainerGroup(
  docker: DockerEngine,
  o: ContainerGroupOptions,
) {
  let primary: ContainerInfo | undefined;
  for (const member of members(o)) {
    let info = await inspectOwnedContainer(docker, member.name, o);
    if (!info) throw Error(`container missing: ${member.name}`);
    if (!info.State.Running && info.State.Status === "created")
      await docker.startContainer(member.name);
    info =
      member.alias !== "main" || o.waitForPrimary !== false
        ? await healthy(docker, member.name, o)
        : (await inspectOwnedContainer(docker, member.name, o))!;
    if (member.alias === "main") primary = info;
  }
  for (const member of members(o)) {
    if (member.alias !== "main") await healthy(docker, member.name, o);
  }
  return primary!;
}
export async function ensureContainerGroup(
  docker: DockerEngine,
  o: ContainerGroupOptions,
) {
  try {
    await createContainerGroup(docker, o);
    return await startContainerGroup(docker, o);
  } catch (error) {
    try {
      await cleanupContainerGroup(docker, o);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "container group creation and cleanup failed",
      );
    }
    throw error;
  }
}
export async function reconcileContainerGroup(
  docker: DockerEngine,
  o: ContainerGroupOptions,
) {
  const group = members(o);
  for (const member of group) {
    const info = await inspectOwnedContainer(docker, member.name, o);
    if (
      !info?.State.Running ||
      (info.State.Health && info.State.Health.Status !== "healthy")
    )
      throw Error(`container exited: ${member.name}`);
  }
  await ensureNetworks(docker, o);
  for (const member of group)
    await repairAttachments(
      docker,
      o,
      member,
      (await inspectOwnedContainer(docker, member.name, o))!,
    );
  await attachGateway(docker, o);
}
export async function cleanupContainerGroup(
  docker: DockerEngine,
  o: GroupIdentity,
) {
  const errors: unknown[] = [];
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (!missing(e)) errors.push(e);
    }
  };
  const containers = await docker.listContainers(o.ownerLabel);
  const containerIds = new Set(
    containers
      .filter((c) => c.Labels?.[o.ownerLabel] === o.ownerId)
      .map((c) => c.Id),
  );
  containerIds.add(String(o.primary?.name ?? o.namespace));
  for (const service of o.topology?.services ?? [])
    containerIds.add(`${o.namespace}-${service.name}`);
  for (const name of containerIds)
    await attempt(async () => {
      const info = await docker.inspectContainer(name);
      owned(info.Config.Labels, o, "container");
      await docker.removeContainer(name);
    });
  const networkIds = new Set(
    (await docker.listNetworks(o.ownerLabel))
      .filter((n) => n.Labels?.[o.ownerLabel] === o.ownerId)
      .map((n) => n.Id),
  );
  networkIds.add(o.namespace);
  for (const network of o.topology?.networks ?? [])
    networkIds.add(groupNetworkName(o.namespace, network.name));
  for (const name of networkIds)
    await attempt(async () => {
      const info = await docker.inspectNetwork(name);
      owned(info.Labels, o, "network");
      if (
        o.gateway &&
        Object.values(info.Containers ?? {}).some((c) => c.Name === o.gateway)
      ) {
        const gateway = await docker.inspectContainer(o.gateway);
        if (gateway.Config.Labels?.["io.nebuctf.gateway"] !== "true")
          throw Error("untrusted gateway container");
        await docker.disconnectNetwork(name, o.gateway);
      }
      await docker.removeNetwork(name);
    });
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "container group cleanup failed");
}

export async function writeGroupFlag(
  docker: DockerEngine,
  namespace: string,
  primary: string,
  targets: string[],
  flag: string,
) {
  for (const target of targets)
    await docker.writeFlag(
      target === "main" ? primary : `${namespace}-${target}`,
      flag,
    );
}
