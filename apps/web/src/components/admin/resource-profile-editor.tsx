import type { RefObject } from "react";
import type { ResourceProfile } from "@/lib/competition";
import { Field } from "../shared";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ImageTools } from "./image-tools";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Switch } from "../ui/switch";
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
  const generator = type === "attachment";
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label={generator ? "生成器镜像" : "容器镜像"}>
          <Input
            name={`${type}-image`}
            required
            maxLength={200}
            value={v.image}
            onChange={(e) => set({ ...v, image: e.target.value })}
            placeholder="nebuctf/challenge:1.0"
          />
        </Field>
        {!generator && (
          <Field label="环境分配">
            <NativeSelect
              value={v.mode ?? "private"}
              disabled={privateOnly}
              onChange={(e) =>
                set({ ...v, mode: e.target.value as "private" | "public" })
              }
            >
              <NativeSelectOption value="private">独立靶机</NativeSelectOption>
              <NativeSelectOption value="public">公共靶机</NativeSelectOption>
            </NativeSelect>
          </Field>
        )}
      </div>
      {!generator && v.mode !== "public" && (
        <label className="flex max-w-lg items-center justify-between gap-4 text-sm">
          使用平台默认时长
          <Switch
            checked={v.use_platform_ttl ?? v.ttl === 1800}
            onCheckedChange={(checked) =>
              set({ ...v, use_platform_ttl: checked })
            }
          />
        </label>
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {!generator && (
          <>
            <Field label="连接方式">
              <ToggleGroup
                type="single"
                variant="outline"
                value={v.protocol ?? "http"}
                className="w-full"
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
                <ToggleGroupItem value="nc" className="flex-1">
                  nc
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field label="服务端口">
              <Input
                name={`${type}-port`}
                type="number"
                required
                min={1024}
                max={65535}
                value={v.port ?? 8080}
                onChange={(e) => set({ ...v, port: Number(e.target.value) })}
              />
            </Field>
            <Field label="访问方式">
              <NativeSelect
                value={v.access_mode ?? "port"}
                onChange={(e) =>
                  set({
                    ...v,
                    access_mode: e.target.value as "port" | "domain",
                  })
                }
              >
                <NativeSelectOption value="port">端口直连</NativeSelectOption>
                <NativeSelectOption
                  value="domain"
                  disabled={v.protocol === "nc"}
                >
                  泛域名代理
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </>
        )}
        {(
          [
            { key: "ttl", label: "有效时间（秒）", min: 60, max: 7200 },
            { key: "cpu", label: "CPU（毫核）", min: 100, max: 4000 },
            { key: "memory", label: "内存（MiB）", min: 32, max: 4096 },
          ] as const
        ).map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              name={`${type}-${f.key}`}
              type="number"
              required
              min={f.min}
              max={f.max}
              value={v[f.key]}
              disabled={
                f.key === "ttl" &&
                !generator &&
                v.mode !== "public" &&
                (v.use_platform_ttl ?? v.ttl === 1800)
              }
              onChange={(e) => set({ ...v, [f.key]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
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
      />
    </div>
  );
}
