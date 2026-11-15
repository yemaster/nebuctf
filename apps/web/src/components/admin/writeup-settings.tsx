import { Field } from "../shared";
import { Input } from "../ui/input";
import { MarkdownEditor } from "../markdown-editor";
import { Checkbox } from "../ui/checkbox";
import { inputDate } from "./shared";
import type { WriteupConfig } from "@/lib/writeups";
import {
  ContestSettingsSection,
  ContestSettingSwitch,
} from "./contest-settings-section";
import { Separator } from "../ui/separator";
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
    <fieldset disabled={disabled} className="space-y-6">
      <ContestSettingSwitch
        label="开放 WriteUp 提交"
        checked={value.enabled}
        onCheckedChange={(enabled) => set({ enabled })}
      />
      <fieldset
        disabled={!value.enabled || disabled}
        hidden={!value.enabled}
        className="space-y-6"
      >
        <Separator />
        <ContestSettingsSection
          title="提交权限"
          help="每队共用一份 WriteUp，队长始终可以提交。"
        >
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            <ContestSettingSwitch
              label="允许队员提交"
              checked={value.submitter === "members"}
              onCheckedChange={(allowed) =>
                set({ submitter: allowed ? "members" : "captain" })
              }
            />
            <ContestSettingSwitch
              label="要求战队提交"
              checked={value.required}
              onCheckedChange={(required) => set({ required })}
            />
            <ContestSettingSwitch
              label="允许截止前替换"
              checked={value.allow_resubmit}
              onCheckedChange={(allow_resubmit) => set({ allow_resubmit })}
            />
          </div>
        </ContestSettingsSection>
        <Separator />
        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <ContestSettingsSection title="提交文件">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 text-sm font-medium">
                <span>允许的文件格式</span>
                <div className="flex h-9 items-center gap-5">
                  {(["pdf", "zip"] as const).map((format) => (
                    <label
                      key={format}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={value.formats.includes(format)}
                        disabled={
                          value.formats.length === 1 &&
                          value.formats[0] === format
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
              </div>
              <Field label="单个文件上限（MiB）">
                <Input
                  aria-label="WriteUp 文件大小上限"
                  type="number"
                  min={1}
                  max={20}
                  required
                  className="w-full"
                  value={value.max_size_mb}
                  onChange={(e) => set({ max_size_mb: Number(e.target.value) })}
                />
              </Field>
            </div>
          </ContestSettingsSection>
          <ContestSettingsSection
            title="提交时间"
            help="开始时间留空时，比赛结束后开放提交。"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="开始时间">
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
          </ContestSettingsSection>
        </div>
        <Separator />
        <ContestSettingsSection title="提交要求">
          <MarkdownEditor
            id="writeup-note"
            name="writeup_note"
            label="WriteUp 提交要求"
            value={value.note}
            maxLength={5000}
            height={280}
            onChange={(note) => set({ note })}
            placeholder="文档内容、命名要求等"
            disabled={!value.enabled || disabled}
          />
        </ContestSettingsSection>
      </fieldset>
    </fieldset>
  );
}
