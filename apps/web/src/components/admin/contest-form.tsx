import { ContestAccessSettings } from "./contest-access-settings";
import { useSearchParams } from "react-router-dom";
import { ContestPosterEditor } from "./contest-poster-editor";
import { WriteupSettings } from "./writeup-settings";
import { defaultWriteup } from "@/lib/writeups";
import { ContestQuestions, type QuestionIssue } from "./contest-questions";
import { PhaseEditor } from "./phase-editor";
import { validateContestQuestions } from "@/lib/contest-editor";
import type { ContestQuestion } from "@/lib/competition";
import { useState } from "react";
import type { Contest } from "@/lib/types";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";
import { Switch } from "../ui/switch";
import { Field } from "../shared";
import { GroupsEditor, readGroups } from "../groups-editor";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ConfigPanel, focusInvalidField } from "./config-tabs";
import { inputDate } from "./shared";
export function ContestForm({
  contest: c,
  pending,
  save,
}: {
  contest: Contest | null;
  pending: boolean;
  save: (body: Record<string, unknown>) => void;
}) {
  const [params] = useSearchParams();
  const [section, setSection] = useState(
    params.get("section") === "writeup" ? "writeup" : "content",
  );
  const [allowedTeams, setAllowedTeams] = useState(
    c?.registration_team_ids ?? [],
  );
  const [selected, setSelected] = useState(c?.challenge_ids ?? []);
  const [settings, setSettings] = useState<ContestQuestion[]>(
    c?.challenge_settings ?? [],
  );
  const [writeup, setWriteup] = useState({ ...defaultWriteup, ...c?.writeup });
  const [timing, setTiming] = useState(c?.timing ?? {});
  const [questionIssue, setQuestionIssue] = useState<QuestionIssue | null>(
    null,
  );
  const started = !!c && Date.parse(c.starts_at) <= Date.now();
  return (
    <form
      id="contest-form"
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const f = new FormData(e.currentTarget);
        const issue = validateContestQuestions(
          settings.filter((s) => selected.includes(s.challenge_id)),
          String(f.get("starts_at")),
          String(f.get("ends_at")),
        );
        setQuestionIssue(issue);
        if (issue) {
          setSection("challenges");
          return;
        }
        if (focusInvalidField(e.currentTarget, setSection)) return;
        save({
          title: f.get("title"),
          description: f.get("description"),
          starts_at: new Date(String(f.get("starts_at"))).toISOString(),
          ends_at: new Date(String(f.get("ends_at"))).toISOString(),
          freeze_at: f.get("freeze_at")
            ? new Date(String(f.get("freeze_at"))).toISOString()
            : null,
          team_limit: Number(f.get("team_limit")),
          published: f.has("published"),
          require_review: f.has("require_review"),
          practice_mode: f.has("practice_mode"),
          spectator_enabled: f.has("spectator_enabled"),
          spectator_scoreboard: f.has("spectator_scoreboard"),
          registration_mode: f.get("registration_mode"),
          registration_code: f.get("registration_code") ?? "",
          registration_team_ids: allowedTeams,
          challenge_ids: selected,
          challenge_settings: settings.filter((s) =>
            selected.includes(s.challenge_id),
          ),
          timing,
          writeup,
          groups: readGroups(f, selected),
        });
      }}
    >
      <Tabs
        value={section}
        onValueChange={setSection}
        className="min-w-0 gap-6"
      >
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList aria-label="比赛配置">
            <TabsTrigger value="content">基本信息</TabsTrigger>
            <TabsTrigger value="writeup">WriteUp 提交</TabsTrigger>
            <TabsTrigger value="challenges">赛题设置</TabsTrigger>
            <TabsTrigger value="timing">时间规则</TabsTrigger>
            <TabsTrigger value="access">访问与报名</TabsTrigger>
            <TabsTrigger value="registration">报名分组</TabsTrigger>
          </TabsList>
        </div>
        <ConfigPanel value="content" active={section}>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            <fieldset disabled={pending} className="space-y-5">
              <legend className="sr-only">基本信息</legend>
              <Field label="比赛名称">
                <Input
                  name="title"
                  defaultValue={c?.title}
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="比赛说明">
                <Textarea
                  name="description"
                  defaultValue={c?.description}
                  maxLength={10000}
                  rows={8}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch name="published" defaultChecked={c?.published} />
                启用比赛
              </label>
            </fieldset>
            <ContestPosterEditor contest={c} disabled={pending} />
          </div>
        </ConfigPanel>
        <ConfigPanel value="challenges" active={section}>
          <fieldset disabled={pending} className="min-w-0">
            <legend className="sr-only">赛题设置</legend>
            <ContestQuestions
              ids={selected}
              onIdsChange={setSelected}
              value={settings}
              onChange={setSettings}
              locked={started}
              issue={questionIssue}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="timing" active={section}>
          <fieldset disabled={pending} className="grid gap-5 md:grid-cols-2">
            <legend className="sr-only">时间规则</legend>
            {[
              { key: "starts_at", label: "开始时间" },
              { key: "ends_at", label: "结束时间" },
              { key: "freeze_at", label: "封榜时间（可选）" },
            ].map(({ key, label }) => (
              <Field key={key} label={label}>
                <Input
                  type="datetime-local"
                  name={key}
                  defaultValue={inputDate(c?.[key as "starts_at"])}
                  required={key !== "freeze_at"}
                  readOnly={started}
                />
              </Field>
            ))}
          </fieldset>
          <div className="mt-6 space-y-6">
            <PhaseEditor
              label="客观题"
              value={timing.objective}
              onChange={(objective) => setTiming({ ...timing, objective })}
              locked={pending || started}
            />
            <PhaseEditor
              label="实操题"
              unified={settings.some(
                (s) =>
                  selected.includes(s.challenge_id) &&
                  s.scoring.mode === "round",
              )}
              value={timing.practical}
              onChange={(practical) => setTiming({ ...timing, practical })}
              locked={pending || started}
            />
          </div>
          {started && (
            <p className="mt-5 text-sm text-muted-foreground">
              开赛后，计分、时间与赛题集合已锁定。
            </p>
          )}
        </ConfigPanel>
        <ConfigPanel value="registration" active={section}>
          <fieldset disabled={pending} className="space-y-6">
            <legend className="sr-only">报名分组</legend>
            <div className="max-w-sm">
              <Field label="每队人数上限">
                <Input
                  type="number"
                  name="team_limit"
                  min={1}
                  max={20}
                  defaultValue={c?.team_limit ?? 4}
                  readOnly={started}
                  required
                />
              </Field>
            </div>
            <GroupsEditor
              initial={c?.groups}
              challengeIds={selected}
              started={started}
              registered={(c?.teams ?? 0) > 0}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="access" active={section}>
          <fieldset disabled={pending} className="min-w-0 max-w-4xl">
            <legend className="sr-only">访问与报名</legend>
            <ContestAccessSettings
              contest={c}
              teams={allowedTeams}
              onTeamsChange={setAllowedTeams}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="writeup" active={section}>
          <WriteupSettings
            value={writeup}
            onChange={setWriteup}
            disabled={pending}
          />
        </ConfigPanel>
      </Tabs>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中" : "保存比赛"}
        </Button>
      </div>
    </form>
  );
}
