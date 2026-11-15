import { useUser } from "@/App";
import { readDraft, writeDraft, clearDraft } from "@/lib/use-draft";
import { RegistrationFormEditor } from "./registration-form-editor";
import { ContestSubmissionLimits } from "./contest-submission-limits";
import {
  validSubmissionLimit,
  type SubmissionLimits,
  type SubmissionOverride,
} from "@/lib/submission-limits";
import { ContestHints } from "./contest-hints";
import {
  validHintPolicy,
  type HintPolicy,
  type HintOverride,
} from "@/lib/hints";
import { ContestResourceSettings } from "./contest-resource-settings";
import { ContestAccessSettings } from "./contest-access-settings";
import { useSearchParams } from "react-router-dom";
import { ContestPosterEditor } from "./contest-poster-editor";
import { WriteupSettings } from "./writeup-settings";
import { defaultWriteup } from "@/lib/writeups";
import { ContestQuestions, type QuestionIssue } from "./contest-questions";
import { PhaseEditor } from "./phase-editor";
import { validateContestQuestions } from "@/lib/contest-editor";
import type { ContestQuestion } from "@/lib/competition";
import { useLayoutEffect, useRef, useState } from "react";
import type { Contest } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MarkdownEditor } from "../markdown-editor";
import { Switch } from "../ui/switch";
import { Field } from "../shared";
import {
  GroupsEditor,
  readGroups,
  type GroupsEditorHandle,
} from "../groups-editor";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ConfigPanel, focusInvalidField } from "./config-tabs";
import { inputDate } from "./shared";
import { Alert, AlertTitle } from "../ui/alert";
export function ContestForm({
  contest: saved,
  pending,
  readOnly = false,
  save,
}: {
  contest: Contest | null;
  pending: boolean;
  readOnly?: boolean;
  save: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const user = useUser();
  const draftKey = `contest-editor:${user?.id ?? "admin"}:${saved?.id ?? "new"}`;
  const [restored, setRestored] = useState<Contest | null>(() =>
    user ? readDraft(draftKey, null) : null,
  );
  const c = restored ?? saved;
  const formRef = useRef<HTMLFormElement>(null),
    dirty = useRef(false);
  const [formVersion, setFormVersion] = useState(0),
    [draftSaved, setDraftSaved] = useState<boolean | null>(null);
  const [registrationIssue, setRegistrationIssue] = useState("");
  const [description, setDescription] = useState(c?.description ?? "");
  const [registrationFields, setRegistrationFields] = useState(
    c?.registration_form ?? [],
  );
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
  const [submissionLimits, setSubmissionLimits] = useState<SubmissionLimits>(
    c?.submission_limits ?? { flag: null, defense: null },
  );
  const [submissionOverrides, setSubmissionOverrides] = useState<
    SubmissionOverride[]
  >(c?.submission_overrides ?? []);
  const [submissionIssue, setSubmissionIssue] = useState<{
    challenge_id?: string;
    message: string;
  } | null>(null);
  const [hintPolicy, setHintPolicy] = useState<HintPolicy>(
    c?.hint_policy ?? { mode: "free" },
  );
  const [hintOverrides, setHintOverrides] = useState<HintOverride[]>(
    c?.hint_overrides ?? [],
  );
  const [writeup, setWriteup] = useState({ ...defaultWriteup, ...c?.writeup });
  const [timing, setTiming] = useState(c?.timing ?? {});
  const [hintIssue, setHintIssue] = useState<{
    challenge_id?: string;
    message: string;
  } | null>(null);
  const [questionIssue, setQuestionIssue] = useState<QuestionIssue | null>(
    null,
  );
  const [scheduleIssue, setScheduleIssue] = useState("");
  const groupsEditor = useRef<GroupsEditorHandle>(null);
  const started = !!c && Date.parse(c.starts_at) <= Date.now();
  useLayoutEffect(() => {
    if (!user?.id || !dirty.current || pending || !formRef.current) return;
    const f = new FormData(formRef.current);
    const time = (key: string) => {
      const v = String(f.get(key) ?? "");
      return v && Number.isFinite(Date.parse(v))
        ? new Date(v).toISOString()
        : null;
    };
    const snapshot = {
      ...c,
      title: String(f.get("title") ?? ""),
      description: String(f.get("description") ?? ""),
      starts_at: time("starts_at"),
      ends_at: time("ends_at"),
      freeze_at: time("freeze_at"),
      registration_opens_at: time("registration_opens_at"),
      registration_closes_at: time("registration_closes_at"),
      team_limit: Number(f.get("team_limit")),
      round_duration: Number(f.get("round_duration") ?? 300),
      published: f.has("published"),
      require_review: !f.has("auto_approve"),
      practice_mode: f.has("practice_mode"),
      spectator_enabled: f.has("spectator_enabled"),
      spectator_scoreboard: f.has("spectator_scoreboard"),
      registration_mode: String(f.get("registration_mode")),
      registration_code: String(f.get("registration_code") ?? ""),
      visibility: String(f.get("visibility")),
      registration_team_ids: allowedTeams,
      challenge_ids: selected,
      challenge_settings: settings,
      submission_limits: submissionLimits,
      submission_overrides: submissionOverrides,
      hint_policy: hintPolicy,
      hint_overrides: hintOverrides,
      writeup,
      timing,
      groups: readGroups(f, selected),
      registration_form: registrationFields,
      resource_limits: Object.fromEntries(
        [
          "containers_per_team",
          "attachments_per_team",
          "containers_total",
          "attachments_total",
        ].map((k) => [k, f.get(k) === "" ? null : Number(f.get(k))]),
      ),
    };
    setDraftSaved(writeDraft(draftKey, snapshot));
  }, [
    formVersion,
    description,
    pending,
    allowedTeams,
    selected,
    settings,
    submissionLimits,
    submissionOverrides,
    hintPolicy,
    hintOverrides,
    writeup,
    timing,
    registrationFields,
  ]);

  return (
    <form
      ref={formRef}
      onChangeCapture={() => {
        dirty.current = true;
        setFormVersion((v) => v + 1);
      }}
      onClickCapture={() => {
        dirty.current = true;
        setFormVersion((v) => v + 1);
      }}
      id="contest-form"
      className="space-y-6"
      noValidate
      onSubmit={async (e) => {
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
        const invalidSubmission = submissionOverrides.find(
          (v) =>
            selected.includes(v.challenge_id) &&
            (!validSubmissionLimit(v.flag) || !validSubmissionLimit(v.defense)),
        );
        if (
          !validSubmissionLimit(submissionLimits.flag) ||
          !validSubmissionLimit(submissionLimits.defense) ||
          invalidSubmission
        ) {
          setSubmissionIssue({
            challenge_id: invalidSubmission?.challenge_id,
            message: "次数须为 1–100000 的整数。",
          });
          setSection("submissions");
          return;
        }
        setSubmissionIssue(null);
        const invalidHint = hintOverrides.find(
          (h) =>
            selected.includes(h.challenge_id) && !validHintPolicy(h.policy),
        );
        if (!validHintPolicy(hintPolicy) || invalidHint) {
          setHintIssue({
            challenge_id: !validHintPolicy(hintPolicy)
              ? undefined
              : invalidHint?.challenge_id,
            message:
              "扣分须为 1–10000 的整数，系数须为 0.01–0.99，最多两位小数。",
          });
          setSection("hints");
          return;
        }
        setHintIssue(null);
        if (groupsEditor.current && !groupsEditor.current.validate()) {
          setSection("registration");
          return;
        }
        const invalidField = registrationFields.find(
          (f) =>
            !f.label.trim() ||
            (["select", "multi"].includes(f.type) &&
              (f.options.length < 2 ||
                f.options.some((o) => !o.trim()) ||
                new Set(f.options.map((o) => o.trim())).size !==
                  f.options.length)),
        );
        if (invalidField) {
          setRegistrationIssue(
            invalidField.label
              ? `${invalidField.label}：请填写至少两个不重复的选项`
              : "请填写字段名称",
          );
          setSection("form");
          return;
        }
        setRegistrationIssue("");
        if (focusInvalidField(e.currentTarget, setSection)) return;
        const registrationOpen = f.get("registration_opens_at")
          ? new Date(String(f.get("registration_opens_at"))).toISOString()
          : null;
        const registrationClose = f.get("registration_closes_at")
          ? new Date(String(f.get("registration_closes_at"))).toISOString()
          : null;
        const end = new Date(String(f.get("ends_at"))).toISOString();
        const windowIssue =
          registrationOpen && registrationOpen >= (registrationClose ?? end)
            ? "报名开放时间必须早于报名截止时间"
            : registrationClose && registrationClose > end
              ? "报名截止时间不能晚于比赛结束时间"
              : "";
        setScheduleIssue(windowIssue);
        if (windowIssue) {
          setSection("timing");
          return;
        }
        try {
          await save({
            title: f.get("title"),
            description: f.get("description"),
            starts_at: new Date(String(f.get("starts_at"))).toISOString(),
            ends_at: new Date(String(f.get("ends_at"))).toISOString(),
            freeze_at: f.get("freeze_at")
              ? new Date(String(f.get("freeze_at"))).toISOString()
              : null,
            team_limit: Number(f.get("team_limit")),
            published: f.has("published"),
            require_review: !f.has("auto_approve"),
            registration_form: registrationFields,
            practice_mode: f.has("practice_mode"),
            spectator_enabled: f.has("spectator_enabled"),
            spectator_scoreboard: f.has("spectator_scoreboard"),
            visibility: f.get("visibility"),
            resource_limits: Object.fromEntries(
              [
                "containers_per_team",
                "attachments_per_team",
                "containers_total",
                "attachments_total",
              ].map((key) => [
                key,
                f.get(key) === "" ? null : Number(f.get(key)),
              ]),
            ),
            registration_mode: f.get("registration_mode"),
            registration_opens_at: registrationOpen,
            registration_closes_at: registrationClose,
            registration_code: f.get("registration_code") ?? "",
            registration_team_ids: allowedTeams,
            challenge_ids: selected,
            challenge_settings: settings.filter((s) =>
              selected.includes(s.challenge_id),
            ),
            timing,
            submission_limits: submissionLimits,
            submission_overrides: submissionOverrides.filter((v) =>
              selected.includes(v.challenge_id),
            ),
            hint_policy: hintPolicy,
            hint_overrides: hintOverrides.filter((h) =>
              selected.includes(h.challenge_id),
            ),
            round_duration: Number(
              f.get("round_duration") ?? c?.round_duration ?? 300,
            ),
            writeup,
            groups: readGroups(f, selected),
          });
          dirty.current = false;
          clearDraft(draftKey);
          setDraftSaved(null);
          setRestored(null);
        } catch {
          /* Keep the draft and let the existing save action present the error. */
        }
      }}
    >
      {(restored || draftSaved !== null) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {draftSaved === false
              ? "浏览器无法保存草稿，请及时保存比赛"
              : restored
                ? "已恢复未保存的草稿"
                : "草稿已保存"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft(draftKey);
              window.location.reload();
            }}
          >
            丢弃草稿
          </Button>
        </div>
      )}
      <Tabs
        value={section}
        onValueChange={setSection}
        className="min-w-0 gap-6"
      >
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList variant="line" aria-label="比赛配置">
            <TabsTrigger value="content">基本信息</TabsTrigger>
            <TabsTrigger value="writeup">WriteUp 提交</TabsTrigger>
            <TabsTrigger value="challenges">赛题设置</TabsTrigger>
            <TabsTrigger value="submissions">提交限制</TabsTrigger>
            <TabsTrigger value="hints">提示规则</TabsTrigger>
            <TabsTrigger value="timing">时间规则</TabsTrigger>
            <TabsTrigger value="resources">资源限制</TabsTrigger>
            <TabsTrigger value="access">访问与报名</TabsTrigger>
            <TabsTrigger value="registration">报名分组</TabsTrigger>
            <TabsTrigger value="form">报名表单</TabsTrigger>
          </TabsList>
        </div>
        <ConfigPanel value="content" active={section}>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            <fieldset disabled={pending || readOnly} className="space-y-5">
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
                <MarkdownEditor
                  id="contest-description"
                  name="description"
                  label="比赛说明"
                  value={description}
                  onChange={(value) => {
                    dirty.current = true;
                    setDescription(value);
                  }}
                  maxLength={10000}
                  disabled={pending || readOnly}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch name="published" defaultChecked={c?.published} />
                启用比赛
              </label>
            </fieldset>
            <ContestPosterEditor contest={c} disabled={pending || readOnly} />
          </div>
        </ConfigPanel>
        <ConfigPanel value="challenges" active={section}>
          <fieldset disabled={pending || readOnly} className="min-w-0">
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
        <ConfigPanel value="submissions" active={section}>
          <fieldset disabled={pending || readOnly}>
            <legend className="sr-only">提交限制</legend>
            <ContestSubmissionLimits
              ids={selected}
              value={submissionLimits}
              onChange={setSubmissionLimits}
              overrides={submissionOverrides}
              onOverridesChange={setSubmissionOverrides}
              issue={submissionIssue}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="hints" active={section}>
          <fieldset disabled={pending || readOnly}>
            <legend className="sr-only">提示规则</legend>
            <ContestHints
              issue={hintIssue}
              ids={selected}
              policy={hintPolicy}
              onPolicyChange={setHintPolicy}
              overrides={hintOverrides}
              onOverridesChange={setHintOverrides}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="timing" active={section}>
          {scheduleIssue && (
            <Alert variant="destructive" className="mb-5">
              <AlertTitle>{scheduleIssue}</AlertTitle>
            </Alert>
          )}
          <fieldset disabled={pending || readOnly} className="mb-6 space-y-4">
            <h3 className="font-medium">报名阶段</h3>
            <div className="grid gap-5 md:grid-cols-2">
              {(
                [
                  ["registration_opens_at", "报名开放时间（可选）"],
                  ["registration_closes_at", "报名截止时间（可选）"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    type="datetime-local"
                    name={key}
                    defaultValue={inputDate(c?.[key])}
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              留空时，发布后开放报名，比赛结束时截止。
            </p>
          </fieldset>
          <fieldset disabled={pending || readOnly} className="space-y-4">
            <h3 className="font-medium">比赛阶段</h3>
            <div className="grid gap-5 md:grid-cols-2">
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
            </div>
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
            <fieldset
              disabled={pending || readOnly}
              className="space-y-3 border-t pt-5"
            >
              <legend className="sr-only">比赛轮次</legend>
              <h3 className="font-medium">比赛轮次</h3>
              <div className="grid items-center gap-4 sm:grid-cols-2">
                <Field label="每轮时长（秒）">
                  <Input
                    name="round_duration"
                    type="number"
                    min={60}
                    max={3600}
                    required
                    readOnly={started}
                    defaultValue={c?.round_duration ?? 300}
                  />
                </Field>
                <p className="text-sm text-muted-foreground">
                  所有轮次计分题共用，从实操阶段开始计时。
                </p>
              </div>
            </fieldset>
          </div>
          {started && (
            <p className="mt-5 text-sm text-muted-foreground">
              开赛后，比赛起止时间、计分与赛题集合已锁定。
            </p>
          )}
        </ConfigPanel>
        <ConfigPanel value="registration" active={section}>
          <fieldset disabled={pending || readOnly} className="space-y-6">
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
              ref={groupsEditor}
              initial={c?.groups}
              challengeIds={selected}
              started={started}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="form" active={section}>
          {registrationIssue && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{registrationIssue}</AlertTitle>
            </Alert>
          )}
          <RegistrationFormEditor
            value={registrationFields}
            onChange={setRegistrationFields}
          />
        </ConfigPanel>
        <ConfigPanel value="resources" active={section}>
          <fieldset disabled={pending || readOnly}>
            <legend className="sr-only">资源限制</legend>
            <ContestResourceSettings contest={c} />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="access" active={section}>
          <fieldset
            disabled={pending || readOnly}
            className="min-w-0 max-w-4xl"
          >
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
            disabled={pending || readOnly}
          />
        </ConfigPanel>
      </Tabs>
      <div className="flex justify-start">
        <Button type="submit" disabled={pending || readOnly}>
          {pending ? "保存中" : "保存比赛"}
        </Button>
      </div>
    </form>
  );
}
