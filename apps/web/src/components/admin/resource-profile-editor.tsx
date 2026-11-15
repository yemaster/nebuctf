import { useId, type RefObject } from "react";
import type { ResourceProfile } from "@/lib/competition";
import { Field } from "../shared";
import { Input } from "../ui/input";
import { ImageTools } from "./image-tools";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Switch } from "../ui/switch";
import { ContainerTopologyEditor } from "./container-topology-editor";
import { Box, Cpu, HardDrive, Network } from "lucide-react";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { Label } from "../ui/label";
import { ResourceLimits } from "./resource-limits";
export function ResourceProfileEditor({
  value: v,
  onChange: set,
  type,
  challengeId,
  formRef,
  privateOnly = false,
}: {
  value: ResourceProfile;
  onChange: (v: ResourceProfile) => void;
  type: "container" | "attachment";
  challengeId?: string;
  formRef: RefObject<HTMLFormElement | null>;
  privateOnly?: boolean;
}) {
  const id = useId();
  const generator = type === "attachment";
  const platformTtl =
    !generator && v.mode !== "public" && (v.use_platform_ttl ?? v.ttl === 1800);
  const internalDefault = !!v.topology?.networks.find(
    (network) => network.name === "default",
  )?.internal;
  return (
    <div
      className="min-w-0 space-y-6"
      data-resource-profile={type}
      onInvalidCapture={(event) => {
        const target = event.target as HTMLElement;
        let details = target.closest("details");
        while (details) {
          details.open = true;
          details = details.parentElement?.closest("details") ?? null;
        }
        target.focus();
      }}
    >
      <section className="min-w-0 space-y-4">
        <ImageTools
          image={v.image}
          challengeId={challengeId}
          kind={
            generator
              ? "dynamic_attachment"
              : v.mode === "public"
                ? "static_container"
                : "dynamic_container"
          }
          formRef={formRef}
          resourceType={type}
          profile={v}
        >
          {(status, actions) => (
            <div
              className={
                generator
                  ? "min-w-0"
                  : "grid min-w-0 items-end gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]"
              }
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`${id}-image`}>
                    {generator ? "生成器镜像" : "主服务镜像（main）"}
                  </Label>
                  {status}
                  <div className="ml-auto flex flex-wrap items-center gap-2 empty:hidden">
                    {actions}
                  </div>
                </div>
                <InputGroup>
                  <InputGroupAddon>
                    <Box aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id={`${id}-image`}
                    name={`${type}-image`}
                    required
                    maxLength={200}
                    value={v.image}
                    onChange={(event) =>
                      set({ ...v, image: event.target.value })
                    }
                    placeholder="nebuctf/challenge:1.0"
                    className="font-mono text-sm"
                  />
                </InputGroup>
              </div>
              {!generator && (
                <div className="space-y-2">
                  <Label id={`${id}-allocation`}>环境分配</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={v.mode ?? "private"}
                    disabled={privateOnly}
                    aria-labelledby={`${id}-allocation`}
                    className="isolate w-full"
                    onValueChange={(mode) => {
                      if (mode === "private" || mode === "public")
                        set({ ...v, mode });
                    }}
                  >
                    <ToggleGroupItem value="private" className="flex-1">
                      独立靶机
                    </ToggleGroupItem>
                    <ToggleGroupItem value="public" className="flex-1">
                      公共靶机
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
            </div>
          )}
        </ImageTools>
      </section>
      <Separator />
      <div
        className={
          generator
            ? "min-w-0"
            : "grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
        }
      >
        <section
          className="min-w-0 space-y-4"
          aria-labelledby={`${id}-resources`}
        >
          <h3
            id={`${id}-resources`}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
            资源
          </h3>
          <div className="space-y-5">
            <ResourceLimits
              value={v}
              namePrefix={type}
              onChange={(limits) => set({ ...v, ...limits })}
            />
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                title="固定 /tmp 临时空间；根文件系统只读；销毁后清除"
              >
                <HardDrive aria-hidden="true" />
                临时存储 32 MiB
              </Badge>
              {generator && <Badge variant="outline">附件输出 24 MiB</Badge>}
            </div>
            <Separator />
            <div className="space-y-3">
              {!generator && v.mode !== "public" && (
                <label className="inline-flex w-fit items-center gap-3 text-sm">
                  使用平台默认时长
                  <Switch
                    checked={platformTtl}
                    onCheckedChange={(checked) =>
                      set({ ...v, use_platform_ttl: checked })
                    }
                  />
                </label>
              )}
              <fieldset disabled={platformTtl} hidden={platformTtl}>
                <Field label="有效时间（秒）">
                  <Input
                    name={`${type}-ttl`}
                    type="number"
                    required
                    min={60}
                    max={7200}
                    value={v.ttl}
                    onChange={(event) =>
                      set({ ...v, ttl: Number(event.target.value) })
                    }
                  />
                </Field>
              </fieldset>
            </div>
          </div>
        </section>
        {!generator && (
          <>
            <Separator className="xl:hidden" />
            <Separator
              orientation="vertical"
              className="hidden h-auto self-stretch xl:block"
            />
            <section
              className="min-w-0 space-y-4"
              aria-labelledby={`${id}-entry`}
            >
              <h3
                id={`${id}-entry`}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <Network
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                访问入口
              </h3>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label id={`${id}-protocol`}>连接方式</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={v.protocol ?? "http"}
                    aria-labelledby={`${id}-protocol`}
                    className="isolate w-full"
                    onValueChange={(protocol) => {
                      if (protocol === "http" || protocol === "nc")
                        set({
                          ...v,
                          protocol,
                          ...(protocol === "nc" ? { access_mode: "port" } : {}),
                        });
                    }}
                  >
                    <ToggleGroupItem value="http" className="flex-1">
                      HTTP
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="nc"
                      className="flex-1"
                      disabled={internalDefault}
                    >
                      nc
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <Field label="服务端口">
                  <Input
                    name={`${type}-port`}
                    type="number"
                    required
                    min={1024}
                    max={65535}
                    value={v.port ?? 8080}
                    onChange={(event) =>
                      set({ ...v, port: Number(event.target.value) })
                    }
                  />
                </Field>
                <div className="space-y-2 sm:col-span-2">
                  <Label id={`${id}-access`}>访问方式</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={v.access_mode ?? "port"}
                    aria-labelledby={`${id}-access`}
                    className="isolate w-full"
                    onValueChange={(access_mode) => {
                      if (access_mode === "port" || access_mode === "domain")
                        set({ ...v, access_mode });
                    }}
                  >
                    <ToggleGroupItem
                      value="port"
                      className="flex-1"
                      disabled={internalDefault}
                      title={
                        internalDefault ? "需关闭 default 内部隔离" : undefined
                      }
                    >
                      端口直连
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="domain"
                      className="flex-1"
                      disabled={v.protocol === "nc"}
                    >
                      泛域名代理
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      {!generator && (
        <>
          <Separator />
          <ContainerTopologyEditor value={v} onChange={set} />
        </>
      )}
    </div>
  );
}
