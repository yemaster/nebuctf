import type { PhaseRule } from "@/lib/competition";
import { Field } from "../shared";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Input } from "../ui/input";
import { inputDate } from "./shared";
export function PhaseEditor({
  label,
  value,
  onChange,
  locked,
  unified = false,
}: {
  label: string;
  value?: PhaseRule;
  onChange: (v: PhaseRule) => void;
  locked: boolean;
  unified?: boolean;
}) {
  const v = value ?? {
    mode: "inherit",
    opens_at: null,
    closes_at: null,
    duration_seconds: null,
  };
  return (
    <fieldset disabled={locked} className="space-y-5">
      <h3 className="font-medium">{label}</h3>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="作答方式">
          <NativeSelect
            aria-label={`${label}作答方式`}
            value={v.mode}
            onChange={(e) =>
              onChange({
                ...v,
                mode: e.target.value as PhaseRule["mode"],
                duration_seconds:
                  e.target.value === "flexible"
                    ? (v.duration_seconds ?? 3600)
                    : null,
              })
            }
          >
            <NativeSelectOption value="inherit">
              沿用比赛起止时间
            </NativeSelectOption>
            <NativeSelectOption value="fixed">固定时段</NativeSelectOption>
            <NativeSelectOption value="flexible" disabled={unified}>
              有效期内自由开始
            </NativeSelectOption>
          </NativeSelect>
          {unified && (
            <p className="text-xs text-muted-foreground">
              轮次计分使用全场统一的实操时间。
            </p>
          )}
        </Field>
        {v.mode === "flexible" && (
          <Field label="全队作答时长（分钟）">
            <Input
              required
              type="number"
              min={1}
              max={10080}
              value={(v.duration_seconds ?? 3600) / 60}
              onChange={(e) =>
                onChange({
                  ...v,
                  duration_seconds: Number(e.target.value) * 60,
                })
              }
            />
          </Field>
        )}
        {v.mode !== "inherit" &&
          (["opens_at", "closes_at"] as const).map((key, i) => (
            <Field key={key} label={i ? "有效期结束" : "有效期开始"}>
              <Input
                required
                type="datetime-local"
                value={inputDate(v[key])}
                onChange={(e) =>
                  onChange({
                    ...v,
                    [key]: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </Field>
          ))}
      </div>
    </fieldset>
  );
}
