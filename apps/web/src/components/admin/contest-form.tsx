import { useUser } from "@/App";
import { readDraft, writeDraft, clearDraft } from "@/lib/use-draft";
import { RegistrationFormEditor } from "./registration-form-editor";
import {
  validSubmissionLimit,
  type SubmissionLimits,
  type SubmissionOverride,
} from "@/lib/submission-limits";
import {
  validHintPolicy,
  type HintPolicy,
  type HintOverride,
} from "@/lib/hints";
import { ContestResourceSettings } from "./contest-resource-settings";
import { ContestAccessSettings } from "./contest-access-settings";
import { ContestPosterEditor } from "./contest-poster-editor";
import { WriteupSettings } from "./writeup-settings";
import { defaultWriteup } from "@/lib/writeups";
import { ContestQuestions, type QuestionIssue } from "./contest-questions";
import { ContestRuleHelp } from "./contest-question-logic";
import { PhaseEditor } from "./phase-editor";
import {
  retainContestQuestions,
  validateContestQuestions,
} from "@/lib/contest-editor";
import { defaultQuestionLogic, type ContestQuestion } from "@/lib/competition";
import { useLayoutEffect, useRef, useState } from "react";
import type { Contest } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MarkdownEditor } from "../markdown-editor";
import { Field } from "../shared";
import {
  GroupsEditor,
  readGroups,
  type GroupsEditorHandle,
} from "../groups-editor";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
  ConfigPanel,
  focusInvalidField,
  useConfigSection,
} from "./config-tabs";
import { inputDate } from "./shared";
import { Separator } from "../ui/separator";
import {
  ContestSettingsSection,
  ContestSettingSwitch,
} from "./contest-settings-section";
import { Alert, AlertTitle } from "../ui/alert";
const sections = [
  "content",
  "writeup",
  "challenges",
  "timing",
  "resources",
  "access",
  "registration",
  "form",
] as const;
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
  const [requireReview, setRequireReview] = useState(
    c?.require_review ?? false,
  );
  const [description, setDescription] = useState(c?.description ?? "");
  const [registrationFields, setRegistrationFields] = useState(
    c?.registration_form ?? [],
  );
  const [section, setSection] = useConfigSection(sections, "content");
  const [allowedTeams, setAllowedTeams] = useState(
    c?.registration_team_ids ?? [],
  );
  const [selected, setSelected] = useState(c?.challenge_ids ?? []);
  const [settings, setSettings] = useState<ContestQuestion[]>(
    (c?.challenge_settings ?? []).map((s) => ({
      ...s,
      logic: s.logic ?? defaultQuestionLogic(),
    })),
  );
  const [submissionLimits, setSubmissionLimits] = useState<SubmissionLimits>(
    c?.submission_limits ?? { flag: null, defense: null },
  );
  const [submissionOverrides, setSubmissionOverrides] = useState<
    SubmissionOverride[]
  >(c?.submission_overrides ?? []);
  const [defaultIssue, setDefaultIssue] = useState("");
  const [hintPolicy, setHintPolicy] = useState<HintPolicy>(
    c?.hint_policy ?? { mode: "free" },
  );
  const [hintOverrides, setHintOverrides] = useState<HintOverride[]>(
    c?.hint_overrides ?? [],
  );
  const [writeup, setWriteup] = useState({ ...defaultWriteup, ...c?.writeup });
  const [timing, setTiming] = useState(c?.timing ?? {});
  const [questionIssue, setQuestionIssue] = useState<QuestionIssue | null>(
    null,
  );
  const [scheduleIssue, setScheduleIssue] = useState("");
  const groupsEditor = useRef<GroupsEditorHandle>(null);
  const started = !!c && Date.parse(c.starts_at) <= Date.now();
  const changeSelected = (ids: string[]) => {
    setSelected(ids);
    setSettings((current) => retainContestQuestions(current, ids));
    setSubmissionOverrides((current) =>
      current.filter((s) => ids.includes(s.challenge_id)),
    );
    setHintOverrides((current) =>
      current.filter((s) => ids.includes(s.challenge_id)),
    );
  };
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
          "container_starts_per_team",
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

  const registrationSection = ["access", "registration", "form"].includes(
    section,
  );
  const mainSection = registrationSection ? "signup" : section;
  useLayoutEffect(() => {
    if (section === "registration" || section === "form") {
      formRef.current
        ?.querySelector(`#contest-section-${section}`)
        ?.scrollIntoView?.({ block: "start" });
    }
  }, [section]);

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
          const message = "次数须为 1–100000 的整数。";
          if (invalidSubmission)
            setQuestionIssue({ id: invalidSubmission.challenge_id, message });
          else setDefaultIssue(message);
          setSection("challenges");
          return;
        }
        setDefaultIssue("");
        const invalidHint = hintOverrides.find(
          (h) =>
            selected.includes(h.challenge_id) && !validHintPolicy(h.policy),
        );
        if (!validHintPolicy(hintPolicy) || invalidHint) {
          const message =
            "扣分须为 1–10000 的整数，系数须为 0.01–0.99，最多两位小数。";
          if (!validHintPolicy(hintPolicy)) setDefaultIssue(message);
          else if (invalidHint)
            setQuestionIssue({ id: invalidHint.challenge_id, message });
          setSection("challenges");
          return;
        }
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
        if (f.get("registration_mode") === "teams" && !allowedTeams.length) {
          setScheduleIssue("请选择至少一支可报名战队");
          setSection("access");
          return;
        }
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
          setSection("access");
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
                "container_starts_per_team",
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
            challenge_settings: retainContestQuestions(settings, selected).map(
              (s) => ({
                ...s,
                logic: {
                  ...s.logic,
                  exclusive_group: s.logic.exclusive_group?.trim() || null,
                },
              }),
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
      <Tabs
        value={mainSection}
        onValueChange={(value) =>
          setSection(value === "signup" ? "access" : value)
        }
        className="min-w-0 gap-6"
      >
        <div className="min-w-0 overflow-x-auto border-b pb-1">
          <TabsList variant="line" aria-label="比赛配置">
            <TabsTrigger value="content">基本信息</TabsTrigger>
            <TabsTrigger value="challenges">赛题设置</TabsTrigger>
            <TabsTrigger value="timing">时间规则</TabsTrigger>
            <TabsTrigger value="signup">报名设置</TabsTrigger>
            <TabsTrigger value="resources">资源限制</TabsTrigger>
            <TabsTrigger value="writeup">WriteUp 提交</TabsTrigger>
          </TabsList>
        </div>
        <ConfigPanel value="content" active={section}>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
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
            </fieldset>
            <div className="space-y-6">
              <ContestPosterEditor contest={c} disabled={pending || readOnly} />
              <Separator />
              <fieldset disabled={pending || readOnly} className="space-y-6">
                <ContestSettingsSection title="展示与开放">
                  <ContestSettingSwitch
                    label="启用比赛"
                    name="published"
                    defaultChecked={c?.published}
                  />
                  <ContestSettingSwitch
                    label="观战排行榜"
                    name="spectator_scoreboard"
                    defaultChecked={c?.spectator_scoreboard !== false}
                  />
                  <ContestSettingSwitch
                    label="3D 动态大屏"
                    name="spectator_enabled"
                    defaultChecked={c?.spectator_enabled !== false}
                  />
                  <ContestSettingSwitch
                    label="赛后开放练习"
                    name="practice_mode"
                    defaultChecked={c?.practice_mode}
                  />
                </ContestSettingsSection>
              </fieldset>
            </div>
          </div>
        </ConfigPanel>
        <ConfigPanel value="challenges" active={section}>
          <fieldset disabled={pending || readOnly} className="min-w-0">
            <legend className="sr-only">赛题设置</legend>
            <ContestQuestions
              ids={selected}
              onIdsChange={changeSelected}
              value={settings}
              onChange={setSettings}
              locked={started}
              issue={questionIssue}
              submissionLimits={submissionLimits}
              onSubmissionLimitsChange={setSubmissionLimits}
              submissionOverrides={submissionOverrides}
              onSubmissionOverridesChange={setSubmissionOverrides}
              hintPolicy={hintPolicy}
              onHintPolicyChange={setHintPolicy}
              hintOverrides={hintOverrides}
              onHintOverridesChange={setHintOverrides}
              defaultIssue={defaultIssue}
              disabled={pending || readOnly}
            />
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="timing" active={section}>
          <div className="space-y-6">
            <fieldset disabled={pending || readOnly}>
              <ContestSettingsSection title="比赛时间">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                  <div className="space-y-2">
                    <div className="flex items-center gap-1 text-sm font-medium">
                      <label htmlFor="contest-round-duration">
                        每轮时长（秒）
                      </label>
                      <ContestRuleHelp>
                        轮次计分题共用，从实操阶段开始计时。
                      </ContestRuleHelp>
                    </div>
                    <Input
                      id="contest-round-duration"
                      name="round_duration"
                      type="number"
                      min={60}
                      max={3600}
                      required
                      readOnly={started}
                      defaultValue={c?.round_duration ?? 300}
                    />
                  </div>
                </div>
              </ContestSettingsSection>
            </fieldset>
            <Separator />
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <PhaseEditor
                label="客观题"
                value={timing.objective}
                onChange={(objective) => setTiming({ ...timing, objective })}
                locked={pending || readOnly || started}
              />
              <Separator
                orientation="vertical"
                className="hidden h-auto self-stretch xl:block"
              />
              <Separator className="xl:hidden" />
              <PhaseEditor
                label="实操题"
                unified={settings.some(
                  (s) =>
                    selected.includes(s.challenge_id) &&
                    s.scoring.mode === "round",
                )}
                value={timing.practical}
                onChange={(practical) => setTiming({ ...timing, practical })}
                locked={pending || readOnly || started}
              />
            </div>
          </div>
          {started && (
            <p className="mt-5 text-sm text-muted-foreground">
              开赛后，比赛起止时间、计分与赛题集合已锁定。
            </p>
          )}
        </ConfigPanel>
        <ConfigPanel value="signup" active={mainSection}>
          <div className="space-y-6">
            <section
              id="contest-section-access"
              data-config-tab="access"
              className="scroll-mt-6"
            >
              <fieldset disabled={pending || readOnly} className="min-w-0">
                <legend className="sr-only">访问与报名</legend>
                {scheduleIssue && (
                  <Alert variant="destructive" className="mb-5">
                    <AlertTitle>{scheduleIssue}</AlertTitle>
                  </Alert>
                )}
                <ContestAccessSettings
                  contest={c}
                  started={started}
                  disabled={pending || readOnly}
                  teams={allowedTeams}
                  onTeamsChange={setAllowedTeams}
                  onRequireReviewChange={setRequireReview}
                />
              </fieldset>
            </section>
            <Separator />
            <section
              id="contest-section-registration"
              data-config-tab="registration"
              className="scroll-mt-6"
            >
              <fieldset disabled={pending || readOnly} className="space-y-6">
                <legend className="sr-only">报名分组</legend>
                <GroupsEditor
                  ref={groupsEditor}
                  initial={c?.groups}
                  requireReview={requireReview}
                  challengeIds={selected}
                  started={started}
                  disabled={pending || readOnly}
                />
              </fieldset>
            </section>
            <Separator />
            <section
              id="contest-section-form"
              data-config-tab="form"
              className="scroll-mt-6"
            >
              {registrationIssue && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>{registrationIssue}</AlertTitle>
                </Alert>
              )}
              <fieldset disabled={pending || readOnly}>
                <legend className="sr-only">报名表单</legend>
                <RegistrationFormEditor
                  value={registrationFields}
                  onChange={setRegistrationFields}
                  disabled={pending || readOnly}
                />
              </fieldset>
            </section>
          </div>
        </ConfigPanel>
        <ConfigPanel value="resources" active={section}>
          <fieldset disabled={pending || readOnly}>
            <legend className="sr-only">资源限制</legend>
            <ContestResourceSettings contest={c} />
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
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
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
        <Button type="submit" disabled={pending || readOnly}>
          {pending ? "保存中" : "保存比赛"}
        </Button>
      </div>
    </form>
  );
}
