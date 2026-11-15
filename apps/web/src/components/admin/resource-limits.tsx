import { useId } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { Label } from "../ui/label";
import { Slider } from "../ui/slider";

const limits = [
  {
    key: "cpu",
    label: "CPU",
    unit: "毫核",
    step: 50,
  },
  {
    key: "memory",
    label: "内存",
    unit: "MiB",
    step: 32,
  },
] as const;

const bounds = {
  container: { cpu: [100, 4000], memory: [32, 4096] },
  checker: { cpu: [100, 2000], memory: [64, 1024] },
} as const;

function formatLimit(key: "cpu" | "memory", amount: number) {
  if (key === "cpu") return `${amount / 1000} 核`;
  return amount >= 1024 ? `${amount / 1024} GiB` : `${amount} MiB`;
}

export function ResourceLimits({
  value,
  onChange,
  namePrefix,
  preset = "container",
  disabled = false,
}: {
  value: { cpu: number; memory: number };
  onChange: (value: { cpu: number; memory: number }) => void;
  namePrefix?: string;
  preset?: "container" | "checker";
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-6 sm:grid-cols-2">
      {limits.map((field) => {
        const [minimum, maximum] = bounds[preset][field.key];
        return (
          <div key={field.key} className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
              <InputGroup className="w-32">
                <InputGroupInput
                  id={`${id}-${field.key}`}
                  name={namePrefix ? `${namePrefix}-${field.key}` : undefined}
                  type="number"
                  required
                  min={minimum}
                  max={maximum}
                  disabled={disabled}
                  step={1}
                  aria-label={`${field.label}（${field.unit}）`}
                  value={value[field.key]}
                  className="text-right tabular-nums"
                  onChange={(event) =>
                    onChange({
                      cpu: value.cpu,
                      memory: value.memory,
                      [field.key]: Number(event.target.value),
                    })
                  }
                />
                <InputGroupAddon align="inline-end" className="pr-2 text-xs">
                  {field.unit}
                </InputGroupAddon>
              </InputGroup>
            </div>
            <Slider
              className="min-h-8 [&_[data-slot=slider-track]]:bg-border"
              min={minimum}
              max={maximum}
              disabled={disabled}
              step={field.step}
              value={[Math.min(maximum, Math.max(minimum, value[field.key]))]}
              thumbLabels={[`${field.label}配额`]}
              formatValue={(amount) =>
                field.key === "cpu" ? `${amount / 1000} 核` : `${amount} MiB`
              }
              onValueChange={([amount]) => {
                if (amount !== undefined)
                  onChange({
                    cpu: value.cpu,
                    memory: value.memory,
                    [field.key]: amount,
                  });
              }}
            />
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{formatLimit(field.key, minimum)}</span>
              <span>{formatLimit(field.key, maximum)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
