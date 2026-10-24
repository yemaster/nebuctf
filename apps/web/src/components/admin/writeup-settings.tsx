import { Field } from "../shared";
import { Input, Textarea } from "../ui/input";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { inputDate } from "./shared";
import type { WriteupConfig } from "@/lib/writeups";
export function WriteupSettings({
  value,
  onChange,
  disabled,
}: {
  value: WriteupConfig;
  onChange: (value: WriteupConfig) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<WriteupConfig>) =>
    onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} className="space-y-5">
      <label className="flex items-center gap-3 text-sm font-medium">
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
        />
        开放 WriteUp 提交
      </label>
      <fieldset
        disabled={!value.enabled || disabled}
        hidden={!value.enabled}
        className="space-y-5"
      >
        <Field label="提交权限">
          <RadioGroup
            value={value.submitter}
            onValueChange={(submitter) =>
              set({ submitter: submitter as WriteupConfig["submitter"] })
            }
            className="flex flex-wrap gap-x-6 gap-y-3"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="captain" />
              仅队长提交
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="members" />
              队长和队员均可提交
            </label>
          </RadioGroup>
          <p className="mt-2 text-xs text-muted-foreground">
            每队共用一份 WriteUp
          </p>
        </Field>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={value.required}
              onCheckedChange={(required) => set({ required })}
            />
            要求战队提交
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={value.allow_resubmit}
              onCheckedChange={(allow_resubmit) => set({ allow_resubmit })}
            />
            允许截止前替换
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="开始提交时间（留空为比赛结束时）">
            <Input
              aria-label="WriteUp 开始提交时间"
              type="datetime-local"
              value={inputDate(value.opens_at)}
              onChange={(e) =>
                set({
                  opens_at: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
            />
          </Field>
          <Field label="截止时间">
            <Input
              aria-label="WriteUp 截止时间"
              type="datetime-local"
              value={inputDate(value.deadline)}
              required
              onChange={(e) =>
                set({
                  deadline: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="允许的文件格式">
            <div className="flex h-9 items-center gap-5">
              {(["pdf", "zip"] as const).map((format) => (
                <label key={format} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.formats.includes(format)}
                    disabled={
                      value.formats.length === 1 && value.formats[0] === format
                    }
                    onCheckedChange={(checked) =>
                      set({
                        formats: checked
                          ? [...value.formats, format]
                          : value.formats.filter((f) => f !== format),
                      })
                    }
                  />
                  {format.toUpperCase()}
                </label>
              ))}
            </div>
          </Field>
          <Field label="单个文件上限（MiB）">
            <Input
              aria-label="WriteUp 文件大小上限"
              type="number"
              min={1}
              max={20}
              required
              value={value.max_size_mb}
              onChange={(e) => set({ max_size_mb: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="提交要求">
          <Textarea
            aria-label="WriteUp 提交要求"
            value={value.note}
            maxLength={5000}
            rows={5}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="填写文档内容、命名方式等要求，支持 Markdown"
          />
        </Field>
      </fieldset>
    </fieldset>
  );
}
