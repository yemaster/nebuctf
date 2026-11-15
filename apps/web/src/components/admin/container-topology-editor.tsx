import { ResourceLimits } from "./resource-limits";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Box,
  ChevronRight,
  CircleHelp,
  Network,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ResourceProfile,
  ResourceRuntime,
  ResourceService,
  ResourceTopology,
} from "@/lib/competition";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { CheckerImageTools as ServiceImageTools } from "./image-tools";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Separator } from "../ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

function ConfigHelp({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label}说明`}
          onClick={() => setOpen(true)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        variant="surface"
        sideOffset={6}
        className="max-w-[min(20rem,calc(100vw-3rem))]"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

const namePattern = /^[a-z][a-z0-9-]{0,23}$/;
const nameHelp = "以小写字母开头，仅含小写字母、数字或连字符，最多 24 字符。";

function commandError(text: string) {
  if (!text) return "";
  const args = text.split("\n");
  if (args.length > 32) return "启动命令最多 32 个参数。";
  if (args.some((arg) => arg.length > 1024 || arg.includes("\0")))
    return "每个参数最多 1024 字符，不能包含 NUL。";
  return "";
}

function readEnvironment(text: string) {
  const entries: [string, string][] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const split = line.indexOf("=");
    const key = line.slice(0, split);
    const value = line.slice(split + 1);
    if (split < 1 || !/^[A-Z_][A-Z0-9_]{0,63}$/.test(key))
      return {
        error:
          "每行使用 NAME=value；名称仅含大写字母、数字或下划线，不能以数字开头，最多 64 字符。",
      };
    if (entries.some(([name]) => name === key))
      return { error: `环境变量 ${key} 重复。` };
    if (value.length > 2048 || value.includes("\0"))
      return { error: `${key} 的值最多 2048 字符，不能包含 NUL。` };
    entries.push([key, value]);
  }
  if (entries.length > 32) return { error: "环境变量最多 32 个。" };
  return { error: "", environment: Object.fromEntries(entries) };
}

function RuntimeText({
  label,
  value,
  hint,
  placeholder,
  validate,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  placeholder: string;
  validate: (text: string) => string;
  onChange: (text: string) => string;
}) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const id = useId();
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);
  const error = validate(text);
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <ConfigHelp label={label}>{hint}</ConfigHelp>
      </div>
      <Textarea
        id={id}
        value={text}
        rows={3}
        placeholder={placeholder}
        className="max-h-64 min-h-24 resize-y font-mono text-sm"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        ref={(node) => node?.setCustomValidity(error)}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!validate(next)) committed.current = onChange(next);
        }}
      />
      {error && (
        <p id={`${id}-error`} className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function RuntimeEditor({
  value,
  onChange,
  helper = false,
}: {
  value: ResourceRuntime;
  onChange: (value: ResourceRuntime) => void;
  helper?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <RuntimeText
        label="启动命令"
        value={value.command?.join("\n") ?? ""}
        hint="每行一个参数；留空使用镜像默认命令，不经过 shell。"
        placeholder="使用镜像默认命令"
        validate={commandError}
        onChange={(text) => {
          onChange({ ...value, command: text ? text.split("\n") : undefined });
          return text;
        }}
      />
      <RuntimeText
        label="环境变量"
        value={Object.entries(value.environment ?? {})
          .map(([key, entry]) => `${key}=${entry}`)
          .join("\n")}
        hint={`每行 NAME=value；${helper ? "Flag 可单独启用。" : "平台 Flag 优先。"}`}
        placeholder="NAME=value"
        validate={(text) => readEnvironment(text).error}
        onChange={(text) => {
          const environment = readEnvironment(text).environment;
          onChange({
            ...value,
            environment: Object.keys(environment ?? {}).length
              ? environment
              : undefined,
          });
          return Object.entries(environment ?? {})
            .map(([key, entry]) => `${key}=${entry}`)
            .join("\n");
        }}
      />
    </div>
  );
}

function NameEditor({
  label,
  value,
  used,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  used: string[];
  onChange: (name: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const error = !namePattern.test(draft)
    ? nameHelp
    : used.includes(draft)
      ? "名称已被使用或保留。"
      : "";
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <ConfigHelp label={label}>
          {disabled ? "默认网络不可改名或删除。" : nameHelp}
        </ConfigHelp>
      </div>
      <Input
        id={id}
        value={draft}
        required
        maxLength={24}
        disabled={disabled}
        aria-invalid={!!error && !disabled}
        aria-describedby={error && !disabled ? `${id}-error` : undefined}
        ref={(node) => node?.setCustomValidity(disabled ? "" : error)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (namePattern.test(next) && !used.includes(next)) onChange(next);
        }}
      />
      {error && !disabled && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function NetworkMembership({
  label,
  networks,
  value,
  onChange,
  requireDefault = false,
}: {
  label: string;
  networks: ResourceTopology["networks"];
  value: string[];
  onChange: (names: string[]) => void;
  requireDefault?: boolean;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
        {label}
        <ConfigHelp label={label}>
          {requireDefault
            ? "主服务必须保留 default；同网服务可通过服务名互访。"
            : "至少选择一个网络；同网服务可通过服务名互访。"}
        </ConfigHelp>
      </legend>
      <div className="flex flex-wrap gap-2">
        {networks.map((network) => (
          <label
            key={network.name}
            className="inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[[aria-checked=true]]:border-primary/30 has-[[aria-checked=true]]:bg-primary/5"
          >
            <Checkbox
              checked={value.includes(network.name)}
              disabled={
                (requireDefault && network.name === "default") ||
                (value.length === 1 && value.includes(network.name))
              }
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, network.name]
                    : value.filter((name) => name !== network.name),
                )
              }
            />
            <span className="break-all">
              {network.name}
              {network.internal ? "（内部）" : ""}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function dependsOn(
  services: ResourceService[],
  start: string,
  target: string,
  visited = new Set<string>(),
): boolean {
  if (start === target) return true;
  if (visited.has(start)) return false;
  visited.add(start);
  return (
    services
      .find((service) => service.name === start)
      ?.depends_on.some((name) => dependsOn(services, name, target, visited)) ??
    false
  );
}

function ServiceEditor({
  service,
  index,
  topology,
  autoFocus,
  onChange,
  onRename,
  onRemove,
}: {
  service: ResourceService;
  index: number;
  topology: ResourceTopology;
  autoFocus: boolean;
  onChange: (service: ResourceService) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const imageId = useId();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (autoFocus && details.current) {
      details.current.open = true;
      details.current.querySelector("input")?.focus();
    }
  }, [autoFocus]);
  return (
    <div
      className="relative min-w-0"
      role="group"
      aria-label={`辅助服务 ${service.name}`}
    >
      <Separator />
      <details ref={details} className="group/service">
        <summary className="flex cursor-pointer list-none items-center gap-3 py-4 pr-10 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/service:rotate-90"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-mono text-sm font-medium"
              title={service.name}
            >
              {service.name}
            </div>
            <div
              className="truncate text-xs text-muted-foreground"
              title={service.image}
            >
              {service.image || "未设置镜像"}
            </div>
          </div>
          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
            {service.cpu}m · {service.memory} MiB
          </span>
        </summary>
        <div className="space-y-4 pb-4">
          <Separator />
          <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2">
            <NameEditor
              label="服务名称"
              value={service.name}
              used={[
                "main",
                ...topology.services
                  .filter((_, i) => i !== index)
                  .map((item) => item.name),
              ]}
              onChange={onRename}
            />
            <ServiceImageTools image={service.image}>
              {(status, actions) => (
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={imageId}>镜像</Label>
                    {status}
                    <div className="ml-auto flex flex-wrap items-center gap-2 empty:hidden">
                      {actions}
                    </div>
                  </div>
                  <Input
                    id={imageId}
                    required
                    maxLength={200}
                    value={service.image}
                    placeholder="nebuctf/database:1.0"
                    onChange={(event) =>
                      onChange({ ...service, image: event.target.value })
                    }
                  />
                </div>
              )}
            </ServiceImageTools>
          </div>
          <ResourceLimits
            value={service}
            onChange={(limits) => onChange({ ...service, ...limits })}
          />
          <RuntimeEditor
            value={service}
            onChange={(runtime) => onChange({ ...service, ...runtime })}
            helper
          />
          <Separator />
          <div className="space-y-4">
            <NetworkMembership
              label="连接网络"
              networks={topology.networks}
              value={service.networks}
              onChange={(networks) => onChange({ ...service, networks })}
            />
            {topology.services.length > 1 && (
              <fieldset className="space-y-2">
                <legend className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
                  启动依赖
                  <ConfigHelp label="启动依赖">
                    依赖就绪后启动；主服务最后启动，不允许循环依赖。
                  </ConfigHelp>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {topology.services
                    .filter((item) => item.name !== service.name)
                    .map((item) => {
                      const cycle = dependsOn(
                        topology.services,
                        item.name,
                        service.name,
                      );
                      return (
                        <label
                          key={item.name}
                          title={cycle ? "会形成循环依赖" : undefined}
                          className="inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:disabled]:opacity-50"
                        >
                          <Checkbox
                            checked={service.depends_on.includes(item.name)}
                            disabled={cycle}
                            onCheckedChange={(checked) =>
                              onChange({
                                ...service,
                                depends_on: checked
                                  ? [...service.depends_on, item.name]
                                  : service.depends_on.filter(
                                      (name) => name !== item.name,
                                    ),
                              })
                            }
                          />
                          <span className="break-all font-mono">
                            {item.name}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </fieldset>
            )}
          </div>
        </div>
      </details>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-4 right-0 text-muted-foreground hover:text-destructive"
        aria-label={`删除辅助服务 ${service.name}`}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function nextName(prefix: string, names: string[]) {
  let index = 1;
  while (names.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

export function ContainerTopologyEditor({
  value,
  onChange,
}: {
  value: ResourceProfile;
  onChange: (value: ResourceProfile) => void;
}) {
  const [section, setSection] = useState("main");
  const [freshService, setFreshService] = useState<number>();
  const identities = useRef({ next: 0, keys: new Map<string, number>() });
  const itemKey = (kind: "service" | "network", name: string) => {
    const identity = `${kind}:${name}`;
    let key = identities.current.keys.get(identity);
    if (key === undefined) {
      key = identities.current.next++;
      identities.current.keys.set(identity, key);
    }
    return key;
  };
  const renameKey = (
    kind: "service" | "network",
    oldName: string,
    name: string,
  ) => {
    const key = itemKey(kind, oldName);
    identities.current.keys.delete(`${kind}:${oldName}`);
    identities.current.keys.set(`${kind}:${name}`, key);
  };
  const topology = value.topology ?? {
    networks: [{ name: "default", internal: value.access_mode === "domain" }],
    primary_networks: ["default"],
    services: [],
  };
  const setTopology = (next: ResourceTopology) => {
    const singleDefault =
      next.services.length === 0 &&
      next.networks.length === 1 &&
      next.networks[0]?.name === "default" &&
      next.networks[0].internal === (value.access_mode === "domain");
    onChange({ ...value, topology: singleDefault ? undefined : next });
  };
  return (
    <TooltipProvider>
      <details
        className="group/advanced min-w-0"
        onInvalidCapture={(event) => {
          const target = event.target as HTMLInputElement;
          for (const control of target.form?.elements ?? []) {
            const field = control as HTMLInputElement;
            if (field.willValidate && !field.validity.valid) {
              if (field !== target) return;
              break;
            }
          }
          const panel = target.closest<HTMLElement>("[data-topology-panel]")
            ?.dataset.topologyPanel;
          if (panel) flushSync(() => setSection(panel));
          target.focus();
        }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/advanced:rotate-90"
            aria-hidden="true"
          />
          <span className="flex-1 text-sm font-medium">高级容器配置</span>
        </summary>
        <Tabs value={section} onValueChange={setSection} className="gap-4 pt-4">
          <TabsList
            className="grid w-full grid-cols-3 sm:w-fit"
            aria-label="高级容器配置分区"
          >
            <TabsTrigger value="main">
              <Box className="hidden size-4 sm:block" />
              主服务
            </TabsTrigger>
            <TabsTrigger value="services">
              <Box className="hidden size-4 sm:block" />
              辅助服务
            </TabsTrigger>
            <TabsTrigger value="networks">
              <Network className="hidden size-4 sm:block" />
              网络
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="main"
            forceMount
            hidden={section !== "main"}
            data-topology-panel="main"
            className="min-w-0 space-y-4 data-[state=inactive]:hidden"
          >
            <RuntimeEditor
              value={value}
              onChange={(runtime) =>
                onChange({
                  ...value,
                  command: runtime.command,
                  environment: runtime.environment,
                })
              }
            />
            <NetworkMembership
              label="连接网络"
              networks={topology.networks}
              value={topology.primary_networks}
              requireDefault
              onChange={(primary_networks) =>
                setTopology({ ...topology, primary_networks })
              }
            />
          </TabsContent>
          <TabsContent
            value="services"
            forceMount
            hidden={section !== "services"}
            data-topology-panel="services"
            className="min-w-0 space-y-3 data-[state=inactive]:hidden"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 text-sm font-medium">
                辅助服务
                <ConfigHelp label="辅助服务">
                  辅助服务先于主服务启动；资源按所有容器合计，最多 7 个。
                </ConfigHelp>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={topology.services.length >= 7}
                onClick={() => {
                  const name = nextName(
                    "service",
                    topology.services.map((service) => service.name),
                  );
                  setFreshService(itemKey("service", name));
                  setTopology({
                    ...topology,
                    services: [
                      ...topology.services,
                      {
                        name,
                        image: "",
                        cpu: 500,
                        memory: 256,
                        networks: ["default"],
                        depends_on: [],
                        inject_flag: false,
                      },
                    ],
                  });
                }}
              >
                <Plus className="size-4" />
                添加服务
              </Button>
            </div>
            {topology.services.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                暂无辅助服务
              </div>
            )}
            {topology.services.map((service, index) => {
              const key = itemKey("service", service.name);
              return (
                <ServiceEditor
                  key={key}
                  service={service}
                  index={index}
                  topology={topology}
                  autoFocus={freshService === key}
                  onChange={(next) =>
                    setTopology({
                      ...topology,
                      services: topology.services.map((item, i) =>
                        i === index ? next : item,
                      ),
                    })
                  }
                  onRename={(name) => {
                    renameKey("service", service.name, name);
                    setTopology({
                      ...topology,
                      services: topology.services.map((item, i) => ({
                        ...item,
                        name: i === index ? name : item.name,
                        depends_on: item.depends_on.map((dependency) =>
                          dependency === service.name ? name : dependency,
                        ),
                      })),
                    });
                  }}
                  onRemove={() => {
                    identities.current.keys.delete(`service:${service.name}`);
                    setTopology({
                      ...topology,
                      services: topology.services
                        .filter((_, i) => i !== index)
                        .map((item) => ({
                          ...item,
                          depends_on: item.depends_on.filter(
                            (name) => name !== service.name,
                          ),
                        })),
                    });
                  }}
                />
              );
            })}
          </TabsContent>
          <TabsContent
            value="networks"
            forceMount
            hidden={section !== "networks"}
            data-topology-panel="networks"
            className="min-w-0 space-y-3 data-[state=inactive]:hidden"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 text-sm font-medium">
                实例网络
                <ConfigHelp label="实例网络">
                  网络仅供本实例使用，最多 4
                  个。内部隔离关闭默认路由；端口直连的 default
                  必须保留路由。出口仍受平台策略限制。
                </ConfigHelp>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={topology.networks.length >= 4}
                onClick={() =>
                  setTopology({
                    ...topology,
                    networks: [
                      ...topology.networks,
                      {
                        name: nextName(
                          "network",
                          topology.networks.map((network) => network.name),
                        ),
                        internal: true,
                      },
                    ],
                  })
                }
              >
                <Plus className="size-4" />
                添加网络
              </Button>
            </div>
            {topology.networks.map((network, index) => {
              const members = [
                ...(topology.primary_networks.includes(network.name)
                  ? ["main"]
                  : []),
                ...topology.services
                  .filter((service) => service.networks.includes(network.name))
                  .map((service) => service.name),
              ];
              return (
                <div
                  key={itemKey("network", network.name)}
                  role="group"
                  aria-label={`网络 ${network.name}`}
                  className="min-w-0 space-y-3"
                >
                  <Separator className="mb-4" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="col-span-2 sm:col-span-1">
                      <NameEditor
                        label="网络名称"
                        value={network.name}
                        disabled={network.name === "default"}
                        used={topology.networks
                          .filter((_, i) => i !== index)
                          .map((item) => item.name)}
                        onChange={(name) => {
                          renameKey("network", network.name, name);
                          setTopology({
                            ...topology,
                            networks: topology.networks.map((item, i) =>
                              i === index ? { ...item, name } : item,
                            ),
                            primary_networks: topology.primary_networks.map(
                              (item) => (item === network.name ? name : item),
                            ),
                            services: topology.services.map((service) => ({
                              ...service,
                              networks: service.networks.map((item) =>
                                item === network.name ? name : item,
                              ),
                            })),
                          });
                        }}
                      />
                    </div>
                    <label className="inline-flex h-9 w-fit items-center gap-3 text-sm">
                      内部隔离
                      <Switch
                        aria-label={`${network.name} 内部隔离`}
                        checked={network.internal}
                        disabled={
                          network.name === "default" &&
                          value.access_mode !== "domain"
                        }
                        onCheckedChange={(internal) =>
                          setTopology({
                            ...topology,
                            networks: topology.networks.map((item, i) =>
                              i === index ? { ...item, internal } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mb-0.5 text-muted-foreground hover:text-destructive"
                      disabled={network.name === "default"}
                      aria-label={`删除网络 ${network.name}`}
                      onClick={() => {
                        identities.current.keys.delete(
                          `network:${network.name}`,
                        );
                        const remove = (names: string[]) => {
                          const remaining = names.filter(
                            (name) => name !== network.name,
                          );
                          return remaining.length ? remaining : ["default"];
                        };
                        setTopology({
                          ...topology,
                          networks: topology.networks.filter(
                            (_, i) => i !== index,
                          ),
                          primary_networks: remove(topology.primary_networks),
                          services: topology.services.map((service) => ({
                            ...service,
                            networks: remove(service.networks),
                          })),
                        });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">连接服务</span>
                    {members.length ? (
                      members.map((name) => (
                        <span
                          key={name}
                          className="max-w-full break-all rounded bg-muted px-2 py-1 font-mono"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">未连接</span>
                    )}
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </details>
    </TooltipProvider>
  );
}
