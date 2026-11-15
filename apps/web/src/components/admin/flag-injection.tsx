import type { PartDraft } from "../parts-editor";
import type { ResourceService } from "@/lib/competition";
import { Input } from "../ui/input";
import { Field } from "../shared";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";

export function FlagInjection({
  parts,
  setParts,
  singleName,
  onSingleName,
  dynamic,
  awd = false,
  services = [],
  singleTargets = null,
  onSingleTargets,
}: {
  parts: PartDraft[];
  setParts: (parts: PartDraft[]) => void;
  singleName: string;
  onSingleName: (name: string) => void;
  dynamic: boolean;
  awd?: boolean;
  services?: ResourceService[];
  singleTargets?: string[] | null;
  onSingleTargets?: (names: string[]) => void;
}) {
  const defaults = [
    "main",
    ...(awd
      ? []
      : services
          .filter((service) => service.inject_flag)
          .map((service) => service.name)),
  ];
  const options = [
    { name: "main", label: "主服务" },
    ...services.map((service) => ({ name: service.name, label: service.name })),
  ];
  const targets = (
    value: string[] | null | undefined,
    onChange: (names: string[]) => void,
    label: string,
  ) => {
    const selected = value ?? defaults;
    return (
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-medium">注入容器</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <label
              key={option.name}
              className="inline-flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-sm has-data-[state=checked]:bg-accent"
            >
              <Checkbox
                aria-label={`${label}注入 ${option.label}`}
                checked={selected.includes(option.name)}
                disabled={
                  selected.length === 1 && selected.includes(option.name)
                }
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, option.name]
                      : selected.filter((name) => name !== option.name),
                  )
                }
              />
              <span className="break-all">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };
  if (!dynamic && !awd) return <Badge variant="outline">Flag 来自镜像</Badge>;
  return (
    <section className="space-y-4" aria-label="Flag 环境变量注入">
      <h3 className="font-medium">Flag 注入</h3>
      {awd ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Flag 文件</span>
            <Badge variant="outline" className="font-mono">
              /run/nebuctf/flag
            </Badge>
          </div>
          {services.length > 0 &&
            onSingleTargets &&
            targets(singleTargets, onSingleTargets, "Flag")}
        </div>
      ) : parts.length ? (
        <div className="divide-y">
          {parts.map((part, index) => (
            <div key={part.key} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <h4 className="break-words text-sm font-medium">
                {part.title || `小题 ${index + 1}`}
              </h4>
              {part.role === "defense" ? (
                <p className="text-sm text-muted-foreground">
                  补丁校验，不注入 Flag
                </p>
              ) : (
                <div className="grid min-w-0 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Field label="环境变量">
                    <Input
                      aria-label={`${part.title || `小题 ${index + 1}`}环境变量`}
                      value={part.flag_env ?? `FLAG_${index + 1}`}
                      required
                      maxLength={64}
                      pattern="[A-Z_][A-Z0-9_]{0,63}"
                      onChange={(event) =>
                        setParts(
                          parts.map((p) =>
                            p.key === part.key
                              ? { ...p, flag_env: event.target.value }
                              : p,
                          ),
                        )
                      }
                    />
                  </Field>
                  {services.length > 0 &&
                    targets(
                      part.flag_targets,
                      (names) =>
                        setParts(
                          parts.map((p) =>
                            p.key === part.key
                              ? { ...p, flag_targets: names }
                              : p,
                          ),
                        ),
                      part.title || `小题 ${index + 1}`,
                    )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Flag 环境变量">
            <Input
              value={singleName}
              onChange={(event) => onSingleName(event.target.value)}
              required
              maxLength={64}
              pattern="[A-Z_][A-Z0-9_]{0,63}"
            />
          </Field>
          {services.length > 0 &&
            onSingleTargets &&
            targets(singleTargets, onSingleTargets, "Flag")}
        </div>
      )}
    </section>
  );
}
