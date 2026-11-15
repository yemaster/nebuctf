import { z } from "zod";
import { imageReference } from "./image-reference.js";

const name = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);
const text = (length: number) =>
  z
    .string()
    .max(length)
    .refine((value) => !value.includes("\0"), "不能包含 NUL 字符");
export const serviceRuntimeInput = z.object({
  command: z.array(text(1024)).max(32).optional(),
  environment: z
    .record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), text(2048))
    .refine((value) => Object.keys(value).length <= 32, "环境变量最多 32 个")
    .optional(),
});
const memberships = z.array(name).min(1).max(4);
export const topologyInput = z
  .object({
    networks: z
      .array(z.object({ name, internal: z.boolean() }).strict())
      .min(1)
      .max(4),
    primary_networks: memberships,
    services: z
      .array(
        z
          .object({
            name: name.refine(
              (value) => value !== "main",
              "main 为主服务保留名称",
            ),
            image: imageReference,
            cpu: z.number().int().min(100).max(4000),
            memory: z.number().int().min(32).max(4096),
            ...serviceRuntimeInput.shape,
            networks: memberships,
            depends_on: z.array(name).max(6),
            inject_flag: z.boolean().default(false),
          })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .superRefine((topology, ctx) => {
    const error = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const unique = (values: string[], path: (string | number)[]) => {
      if (new Set(values).size !== values.length)
        error(path, "名称或引用不能重复");
    };
    const networks = new Set(topology.networks.map((network) => network.name));
    const services = new Map(
      topology.services.map((service) => [service.name, service]),
    );
    unique(
      topology.networks.map((network) => network.name),
      ["networks"],
    );
    unique(
      topology.services.map((service) => service.name),
      ["services"],
    );
    if (!networks.has("default")) error(["networks"], "必须声明 default 网络");
    if (!topology.primary_networks.includes("default"))
      error(["primary_networks"], "主服务必须加入 default 网络");
    const checkNetworks = (values: string[], path: (string | number)[]) => {
      unique(values, path);
      for (const value of values)
        if (!networks.has(value)) error(path, `未声明的网络：${value}`);
    };
    checkNetworks(topology.primary_networks, ["primary_networks"]);
    topology.services.forEach((service, index) => {
      checkNetworks(service.networks, ["services", index, "networks"]);
      unique(service.depends_on, ["services", index, "depends_on"]);
      for (const dependency of service.depends_on)
        if (dependency === service.name || !services.has(dependency))
          error(["services", index, "depends_on"], "依赖必须是其他辅助服务");
    });
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (service: string): boolean => {
      if (visiting.has(service)) return false;
      if (visited.has(service)) return true;
      visiting.add(service);
      for (const dependency of services.get(service)?.depends_on ?? [])
        if (services.has(dependency) && !visit(dependency)) return false;
      visiting.delete(service);
      visited.add(service);
      return true;
    };
    if (topology.services.some((service) => !visit(service.name)))
      error(["services"], "辅助服务依赖不能形成循环");
  });

export type ContainerTopology = z.infer<typeof topologyInput>;
type RuntimeProfile = {
  command?: string[];
  environment?: Record<string, string>;
  topology?: ContainerTopology;
};
export function containerFootprint(
  profile: RuntimeProfile & { cpu: number; memory: number },
) {
  let containers = 1,
    cpu = profile.cpu,
    memory = profile.memory;
  for (const service of profile.topology?.services ?? []) {
    containers++;
    cpu += service.cpu;
    memory += service.memory;
  }
  return { containers, cpu, memory };
}

export function containerProfileSnapshot(
  profile: RuntimeProfile,
): RuntimeProfile {
  return {
    ...(profile.command !== undefined ? { command: [...profile.command] } : {}),
    ...(profile.environment !== undefined
      ? { environment: { ...profile.environment } }
      : {}),
    ...(profile.topology !== undefined
      ? {
          topology: {
            networks: profile.topology.networks.map((network) => ({
              ...network,
            })),
            primary_networks: [...profile.topology.primary_networks],
            services: profile.topology.services.map((service) => ({
              ...service,
              ...containerProfileSnapshot(service),
              networks: [...service.networks],
              depends_on: [...service.depends_on],
            })),
          },
        }
      : {}),
  };
}
