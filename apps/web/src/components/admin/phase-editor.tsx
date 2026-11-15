import type { PhaseRule } from "@/lib/competition";
import { Field } from "../shared";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Input } from "../ui/input";
import { inputDate } from "./shared";
import { ContestSettingsSection } from "./contest-settings-section";
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
    <fieldset disabled={locked} className="@container/phase min-w-0">
      <ContestSettingsSection
        title={label}
        help={unified ? "轮次计分使用全场统一的实操时间。" : undefined}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          value={v.mode}
          disabled={locked}
          aria-label={`${label}作答方式`}
          className="w-full"
          onValueChange={(mode) => {
            if (!mode) return;
            onChange({
              ...v,
              mode: mode as PhaseRule["mode"],
              duration_seconds:
                mode === "flexible" ? (v.duration_seconds ?? 3600) : null,
            });
          }}
        >
          <ToggleGroupItem
            value="inherit"
            className="flex-1"
            aria-label={`${label}跟随比赛`}
          >
            跟随比赛
          </ToggleGroupItem>
          <ToggleGroupItem
            value="fixed"
            className="flex-1"
            aria-label={`${label}固定时段`}
          >
            固定时段
          </ToggleGroupItem>
          <ToggleGroupItem
            value="flexible"
            className="flex-1"
            aria-label={`${label}自由开始`}
            disabled={unified || locked}
          >
            自由开始
          </ToggleGroupItem>
        </ToggleGroup>
        {v.mode !== "inherit" && (
          <div className="grid gap-4 @lg/phase:grid-cols-2">
            {(["opens_at", "closes_at"] as const).map((key, i) => (
              <Field
                key={key}
                label={
                  v.mode === "fixed"
                    ? i
                      ? "结束时间"
                      : "开始时间"
                    : i
                      ? "有效期结束"
                      : "有效期开始"
                }
              >
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
            {v.mode === "flexible" && (
              <Field
                label="全队作答时长（分钟）"
                className="@lg/phase:col-span-2"
              >
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
          </div>
        )}
      </ContestSettingsSection>
    </fieldset>
  );
}
