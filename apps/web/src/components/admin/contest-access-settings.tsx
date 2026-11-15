import type { Contest } from "@/lib/types";
import { Field } from "../shared";
import { useState } from "react";
import { Copy, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { randomUUID } from "@/lib/random-uuid";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group";
import { ContestTeamPicker } from "./contest-team-picker";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import {
  ContestSettingsSection,
  ContestSettingSwitch,
} from "./contest-settings-section";
import { inputDate } from "./shared";
import { Separator } from "../ui/separator";

export function ContestAccessSettings({
  contest,
  started,
  disabled = false,
  teams,
  onTeamsChange,
  onRequireReviewChange,
}: {
  contest: Contest | null;
  started: boolean;
  disabled?: boolean;
  teams: string[];
  onTeamsChange: (ids: string[]) => void;
  onRequireReviewChange?: (required: boolean) => void;
}) {
  const [visibility, setVisibility] = useState(contest?.visibility ?? "public");
  const [mode, setMode] = useState(contest?.registration_mode ?? "public");
  const [code, setCode] = useState(contest?.registration_code ?? "");
  const updateCode = (value: string) => {
    setCode(value);
    if (value.trim()) setMode("invite");
  };
  return (
    <div className="space-y-6">
      <ContestSettingsSection
        title="参赛设置"
        help="私密比赛仅指定战队、已报名成员和管理员可见。"
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field label="比赛可见性">
            <NativeSelect
              wrapperClassName="w-full"
              name="visibility"
              aria-label="比赛可见性"
              value={visibility}
              onChange={(e) => {
                const next = e.target.value as typeof visibility;
                setVisibility(next);
                if (next === "private") setMode("teams");
              }}
            >
              <NativeSelectOption value="public">公开</NativeSelectOption>
              <NativeSelectOption value="private">私密</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field label="每队人数上限">
            <Input
              type="number"
              name="team_limit"
              min={1}
              max={20}
              defaultValue={contest?.team_limit ?? 4}
              readOnly={started}
              required
            />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">报名审核</p>
            <ContestSettingSwitch
              label="报名免审核"
              name="auto_approve"
              defaultChecked={!contest?.require_review}
              onCheckedChange={(checked) => onRequireReviewChange?.(!checked)}
            />
          </div>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="报名方式">
            <NativeSelect
              wrapperClassName="w-full"
              name="registration_mode"
              aria-label="报名方式"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <NativeSelectOption
                value="public"
                disabled={visibility === "private"}
              >
                公开报名
              </NativeSelectOption>
              <NativeSelectOption
                value="invite"
                disabled={visibility === "private"}
              >
                邀请码报名
              </NativeSelectOption>
              <NativeSelectOption value="teams">指定战队</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field label="比赛邀请码">
            <InputGroup>
              <InputGroupInput
                autoComplete="off"
                name="registration_code"
                value={code}
                onChange={(e) => updateCode(e.target.value)}
                minLength={6}
                maxLength={128}
                disabled={mode === "teams"}
                required={mode === "invite" && !contest?.registration_code_set}
                placeholder={
                  mode === "teams"
                    ? "指定战队无需比赛邀请码"
                    : contest?.registration_code_set
                      ? "已设置，留空保留"
                      : "填写后启用邀请码报名"
                }
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="随机生成比赛邀请码"
                  title="随机生成"
                  disabled={mode === "teams"}
                  onClick={() =>
                    updateCode(randomUUID().replaceAll("-", "").slice(0, 12))
                  }
                >
                  <Shuffle />
                </InputGroupButton>
                <InputGroupButton
                  size="icon-xs"
                  aria-label="复制比赛邀请码"
                  title="复制"
                  disabled={mode === "teams" || !code.trim()}
                  onClick={() =>
                    copyText(code.trim())
                      .then(() => toast.success("已复制"))
                      .catch(() => toast.error("复制失败，请手动复制"))
                  }
                >
                  <Copy />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
        {mode === "teams" && (
          <ContestTeamPicker
            value={teams}
            onChange={onTeamsChange}
            disabled={disabled}
          />
        )}
      </ContestSettingsSection>
      <Separator />
      <ContestSettingsSection
        title="报名时间"
        help="留空时，发布后开放报名，比赛结束时截止。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["registration_opens_at", "开放时间（可选）"],
              ["registration_closes_at", "截止时间（可选）"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                type="datetime-local"
                name={key}
                defaultValue={inputDate(contest?.[key])}
              />
            </Field>
          ))}
        </div>
      </ContestSettingsSection>
    </div>
  );
}
