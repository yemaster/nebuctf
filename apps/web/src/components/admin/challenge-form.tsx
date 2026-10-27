import { randomUUID as hintUUID } from "@/lib/random-uuid";
import { FlagInjection } from "./flag-injection";
import { FlagTemplate } from "./flag-template";
import { CheckerImageTools } from "./image-tools";
import { lazy, Suspense, useRef, useState } from "react";
import type { Challenge } from "@/lib/types";
import {
  questionTypes,
  profiles,
  defaultResource,
  type QuestionType,
  type Resources,
  type PatchConfig,
} from "@/lib/competition";
import { ObjectiveEditor, newObjective } from "./objective-editor";
import { ResourceProfileEditor } from "./resource-profile-editor";
import { MarkdownEditor } from "../markdown-editor";
import {
  PartsEditor,
  newPart,
  readParts,
  type PartDraft,
} from "../parts-editor";
import { Field } from "../shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field as Control,
  FieldLabel,
} from "../ui/field";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ChallengeAttachments } from "./challenge-attachments";
import { categories } from "@/pages/Challenges";
import { HintsEditor } from "./hints-editor";
import { ConfigPanel, focusInvalidField } from "./config-tabs";
const ScoreCurve = lazy(() => import("./score-curve"));

export function ChallengeForm({
  challenge: c,
  pending,
  onSave,
}: {
  challenge: Challenge | null;
  pending: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [section, setSection] = useState("content");
  const [publication, setPublication] = useState(
    c?.published ? "enabled" : "disabled",
  );
  const [type, setType] = useState<QuestionType>(c?.challenge_type ?? "ctf");
  const [resources, setResources] = useState<Resources>(() => profiles(c));
  const [flagMode, setFlagMode] = useState(
    c?.flag_mode ?? (c?.kind.startsWith("dynamic") ? "dynamic" : "static"),
  );
  const [objective, setObjective] = useState(c?.objective ?? newObjective());
  const [patch, setPatch] = useState<PatchConfig>(
    c?.patch_config ?? {
      checker_image: "",
      patch_root: "/app",
      timeout: 60,
      cpu: 500,
      memory: 256,
    },
  );
  const [awd, setAwd] = useState(
    c?.awd_config ?? { checker_image: "", timeout: 20 },
  );
  const [description, setDescription] = useState(c?.description ?? "");
  const [hints, setHints] = useState(() =>
    (c?.hints ?? []).map((hint) =>
      typeof hint === "string"
        ? { id: hintUUID(), content: hint }
        : { id: hint.id, content: hint.content ?? "" },
    ),
  );
  const [scoreValues, setScoreValues] = useState({
    initial: String(c?.initial_points ?? 500),
    minimum: String(c?.minimum_points ?? 100),
    decay: String(c?.decay ?? 20),
  });
  const [flagEnv, setFlagEnv] = useState(c?.flag_env ?? "FLAG");
  const [flagTemplate, setFlagTemplate] = useState(
    c?.flag_template ?? (c ? "" : "flag{[GUID]}"),
  );
  const [dynamicScore, setDynamicScore] = useState(c?.dynamic_score ?? true);
  const [multi, setMulti] = useState(!!c?.parts?.length);
  const [parts, setParts] = useState<PartDraft[]>(
    c?.parts?.length
      ? c.parts.map((p, index) => ({
          ...p,
          key: p.id,
          flag_env:
            p.role === "defense" ? null : (p.flag_env ?? `FLAG_${index + 1}`),
        }))
      : [newPart("FLAG_1"), newPart("FLAG_2")],
  );
  const dynamic = flagMode === "dynamic",
    practical = type !== "objective",
    attackDefense = type === "awdp" || type === "awd";
  const retainsFlag =
    !!c &&
    (c.flag_mode ?? (c.kind.startsWith("static") ? "static" : "dynamic")) ===
      "static" &&
    !c.parts?.length;
  const changeType = (next: QuestionType) => {
    setType(next);
    if (next === "objective") {
      setMulti(false);
      setDynamicScore(false);
    } else if (next === "awdp" || next === "awd") {
      setFlagMode("dynamic");
      setResources((r) => ({
        ...r,
        container: { ...(r.container ?? defaultResource()), mode: "private" },
      }));
      setMulti(next === "awdp");
      if (next === "awdp")
        setParts([
          { ...newPart("FLAG_1"), title: "攻击", role: "attack" },
          { ...newPart(), title: "防守", role: "defense" },
        ]);
    } else if (attackDefense) {
      setMulti(false);
      setParts([newPart("FLAG_1"), newPart("FLAG_2")]);
    }
  };
  return (
    <form
      id="challenge-form"
      ref={formRef}
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (focusInvalidField(e.currentTarget, setSection)) return;
        const f = new FormData(e.currentTarget);
        const defaults: Record<string, number> = {
          initial_points: c?.initial_points ?? 500,
          minimum_points: c?.minimum_points ?? 100,
          decay: c?.decay ?? 20,
          port: c?.port ?? 8080,
          cpu: c?.cpu ?? 500,
          memory: c?.memory ?? 256,
          ttl: c?.ttl ?? 1800,
        };
        const body: Record<string, unknown> = {
          title: f.get("title"),
          description: f.get("description"),
          category: f.get("category"),
          difficulty: f.get("difficulty"),
          challenge_type: type,
          flag_mode: practical ? flagMode : "static",
          flag_env: flagEnv,
          flag_template: practical && dynamic ? flagTemplate : "",
          resources: practical
            ? resources
            : { container: null, attachment: null },
          objective: type === "objective" ? objective : null,
          patch_config: attackDefense ? patch : null,
          awd_config: type === "awd" ? awd : null,
          parts:
            practical && multi
              ? readParts(f, parts).map((p) => ({
                  ...p,
                  flag_template: dynamic ? p.flag_template : null,
                }))
              : [],
          hints: hints.filter((hint) => hint.content.trim().length > 0),
          published: publication === "enabled",
          publish_at: null,
          practice: type !== "awd" && f.has("practice"),
          dynamic_score: practical && dynamicScore,
        };
        for (const [key, fallback] of Object.entries(defaults))
          body[key] = f.has(key) ? Number(f.get(key)) : fallback;
        if (!dynamicScore) {
          body.minimum_points = Math.min(
            Number(body.initial_points),
            Number(body.minimum_points),
          );
          body.parts = (body.parts as ReturnType<typeof readParts>).map(
            (p) => ({
              ...p,
              minimum_points: Math.min(p.initial_points, p.minimum_points),
            }),
          );
        }
        if (type === "ctf" && !multi && !dynamic && f.get("flag"))
          body.flag = f.get("flag");
        onSave(body);
      }}
    >
      <Tabs
        value={section}
        onValueChange={setSection}
        className="min-w-0 gap-6"
      >
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList variant="line" aria-label="题目配置">
            <TabsTrigger value="content">题目内容</TabsTrigger>
            <TabsTrigger value="scoring">
              {type === "objective" ? "答案与计分" : "Flag 与计分"}
            </TabsTrigger>
            {practical && (
              <TabsTrigger value="environment">靶机配置</TabsTrigger>
            )}
            {attackDefense && (
              <TabsTrigger value="judging">防守校验</TabsTrigger>
            )}
            <TabsTrigger value="attachments">附件管理</TabsTrigger>
            <TabsTrigger value="publication">发布设置</TabsTrigger>
          </TabsList>
        </div>
        <ConfigPanel value="content" active={section}>
          <div className="space-y-6">
            <FieldSet disabled={pending}>
              <FieldLegend>基本信息</FieldLegend>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-12">
                <Field label="题目名称" className="xl:col-span-5">
                  <Input
                    name="title"
                    defaultValue={c?.title}
                    maxLength={120}
                    required
                  />
                </Field>
                <Field label="题目类型" className="xl:col-span-3">
                  <NativeSelect
                    aria-label="题目类型"
                    value={type}
                    onChange={(e) => changeType(e.target.value as QuestionType)}
                  >
                    {Object.entries(questionTypes).map(([key, label]) => (
                      <NativeSelectOption key={key} value={key}>
                        {label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="分类" className="xl:col-span-2">
                  <NativeSelect
                    name="category"
                    defaultValue={c?.category ?? "Web"}
                  >
                    {categories.map((v) => (
                      <NativeSelectOption key={v}>{v}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="难度" className="xl:col-span-2">
                  <NativeSelect
                    name="difficulty"
                    defaultValue={c?.difficulty ?? "入门"}
                  >
                    {["入门", "简单", "中等", "困难"].map((v) => (
                      <NativeSelectOption key={v}>{v}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </FieldSet>{" "}
            <FieldSet disabled={pending}>
              <FieldLegend>题面与提示</FieldLegend>
              <FieldGroup className="gap-5">
                <Control>
                  <FieldLabel htmlFor="challenge-description">题面</FieldLabel>
                  <MarkdownEditor
                    id="challenge-description"
                    name="description"
                    value={description}
                    onChange={setDescription}
                    disabled={pending}
                    maxLength={20000}
                  />
                </Control>
                <HintsEditor
                  value={hints}
                  onChange={setHints}
                  disabled={pending}
                />
              </FieldGroup>
            </FieldSet>
          </div>
        </ConfigPanel>
        <ConfigPanel value="scoring" active={section}>
          <fieldset disabled={pending} className="space-y-5">
            {type === "objective" && (
              <ObjectiveEditor value={objective} onChange={setObjective} />
            )}
            {type === "awd" && (
              <FlagTemplate
                value={flagTemplate}
                onChange={setFlagTemplate}
                disabled={pending}
              />
            )}
            {type === "awd" ? (
              <p className="text-sm text-muted-foreground">
                攻击分、守住 Flag 得分和服务可用分在比赛选题中设置。
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {practical && (
                    <>
                      <Field label="Flag 方式">
                        <NativeSelect
                          aria-label="Flag 方式"
                          value={flagMode}
                          disabled={attackDefense}
                          onChange={(e) =>
                            setFlagMode(e.target.value as "static" | "dynamic")
                          }
                        >
                          <NativeSelectOption value="static">
                            静态 Flag
                          </NativeSelectOption>
                          <NativeSelectOption value="dynamic">
                            动态 Flag
                          </NativeSelectOption>
                        </NativeSelect>
                      </Field>
                      <Field label="判题方式">
                        <NativeSelect
                          aria-label="判题方式"
                          disabled={attackDefense}
                          value={multi ? "multiple" : "single"}
                          onChange={(e) =>
                            setMulti(e.target.value === "multiple")
                          }
                        >
                          <NativeSelectOption value="single">
                            单 Flag
                          </NativeSelectOption>
                          <NativeSelectOption value="multiple">
                            多个小题
                          </NativeSelectOption>
                        </NativeSelect>
                      </Field>
                    </>
                  )}
                  <Field label="计分方式">
                    <NativeSelect
                      aria-label="计分方式"
                      disabled={!practical}
                      value={dynamicScore ? "dynamic" : "fixed"}
                      onChange={(e) =>
                        setDynamicScore(e.target.value === "dynamic")
                      }
                    >
                      <NativeSelectOption value="dynamic">
                        动态积分
                      </NativeSelectOption>
                      <NativeSelectOption value="fixed">
                        固定积分
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  {dynamicScore && (
                    <Field label="衰减人数">
                      <Input
                        name="decay"
                        type="number"
                        value={scoreValues.decay}
                        onChange={(e) =>
                          setScoreValues({
                            ...scoreValues,
                            decay: e.target.value,
                          })
                        }
                        min={1}
                        max={10000}
                        required
                      />
                    </Field>
                  )}
                </div>
                {practical && dynamic && (
                  <FlagTemplate
                    value={flagTemplate}
                    onChange={setFlagTemplate}
                    disabled={pending}
                  />
                )}
                {practical && !multi && !dynamic && (
                  <Field label={retainsFlag ? "Flag（留空保留原值）" : "Flag"}>
                    <Input
                      name="flag"
                      type="password"
                      autoComplete="off"
                      maxLength={256}
                      required={!retainsFlag}
                    />
                  </Field>
                )}
                {!multi && (
                  <div
                    className={
                      dynamicScore
                        ? "grid items-start gap-5 lg:grid-cols-2"
                        : "max-w-sm"
                    }
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={dynamicScore ? "初始分值" : "分值"}>
                        <Input
                          name="initial_points"
                          type="number"
                          value={scoreValues.initial}
                          onChange={(e) =>
                            setScoreValues({
                              ...scoreValues,
                              initial: e.target.value,
                            })
                          }
                          min={1}
                          max={10000}
                          required
                        />
                      </Field>
                      {dynamicScore && (
                        <Field label="最低分值">
                          <Input
                            name="minimum_points"
                            type="number"
                            value={scoreValues.minimum}
                            onChange={(e) =>
                              setScoreValues({
                                ...scoreValues,
                                minimum: e.target.value,
                              })
                            }
                            min={1}
                            max={10000}
                            required
                          />
                        </Field>
                      )}
                    </div>
                    {dynamicScore && section === "scoring" && (
                      <Suspense
                        fallback={
                          <div
                            className="h-52 rounded-md bg-muted/40"
                            aria-label="加载计分曲线"
                            aria-busy="true"
                          />
                        }
                      >
                        <ScoreCurve
                          initial={Number(scoreValues.initial)}
                          minimum={Number(scoreValues.minimum)}
                          decay={Number(scoreValues.decay)}
                        />
                      </Suspense>
                    )}
                  </div>
                )}
                <fieldset
                  hidden={!multi || !practical}
                  disabled={!multi || pending || !practical}
                  className="min-w-0"
                >
                  <PartsEditor
                    parts={parts}
                    setParts={setParts}
                    dynamic={dynamic}
                    flagTemplate={flagTemplate}
                    dynamicScore={dynamicScore}
                    locked={attackDefense}
                    decay={Number(scoreValues.decay)}
                    showCurves={multi && practical && section === "scoring"}
                  />
                </fieldset>
              </>
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="environment" active={section}>
          <fieldset disabled={pending || !practical} className="space-y-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={!!resources.container}
                disabled={attackDefense}
                onCheckedChange={(yes) =>
                  setResources({
                    ...resources,
                    container: yes ? defaultResource() : null,
                  })
                }
              />
              启用靶机
            </label>
            {resources.container && (
              <ResourceProfileEditor
                type="container"
                value={resources.container}
                onChange={(container) => {
                  setResources({ ...resources, container });
                  if (container.mode === "public") setFlagMode("static");
                }}
                challengeId={c?.id}
                formRef={formRef}
                privateOnly={attackDefense}
              />
            )}
            {resources.container && (
              <FlagInjection
                parts={multi ? parts : []}
                setParts={setParts}
                singleName={flagEnv}
                onSingleName={setFlagEnv}
                dynamic={dynamic}
                awd={type === "awd"}
              />
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="judging" active={section}>
          <fieldset
            disabled={pending || !attackDefense}
            className="grid gap-5 md:grid-cols-2"
          >
            <Field label="补丁校验镜像">
              <Input
                required={attackDefense}
                maxLength={200}
                value={patch.checker_image}
                onChange={(e) =>
                  setPatch({ ...patch, checker_image: e.target.value })
                }
              />
              {attackDefense && (
                <CheckerImageTools image={patch.checker_image} />
              )}
            </Field>
            <Field label="补丁覆盖目录">
              <Input
                required
                value={patch.patch_root}
                pattern="/(app|srv|opt)(/[a-zA-Z0-9_-]+)*"
                onChange={(e) =>
                  setPatch({ ...patch, patch_root: e.target.value })
                }
              />
            </Field>
            {(
              [
                {
                  key: "timeout",
                  label: "单项校验超时（秒）",
                  min: 10,
                  max: 120,
                },
                { key: "cpu", label: "校验 CPU（毫核）", min: 100, max: 2000 },
                { key: "memory", label: "校验内存（MiB）", min: 64, max: 1024 },
              ] as const
            ).map((field) => (
              <Field key={field.key} label={field.label}>
                <Input
                  required
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={patch[field.key]}
                  onChange={(e) =>
                    setPatch({ ...patch, [field.key]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
            {type === "awd" && (
              <>
                <Field label="服务巡检镜像">
                  <Input
                    required
                    maxLength={200}
                    value={awd.checker_image}
                    onChange={(e) =>
                      setAwd({ ...awd, checker_image: e.target.value })
                    }
                  />
                  <CheckerImageTools image={awd.checker_image} />
                </Field>
                <Field label="巡检超时（秒）">
                  <Input
                    required
                    type="number"
                    min={5}
                    max={60}
                    value={awd.timeout}
                    onChange={(e) =>
                      setAwd({ ...awd, timeout: Number(e.target.value) })
                    }
                  />
                </Field>
              </>
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="attachments" active={section}>
          {practical && (
            <fieldset disabled={pending} className="mb-8 space-y-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!!resources.attachment}
                  onCheckedChange={(yes) =>
                    setResources({
                      ...resources,
                      attachment: yes ? defaultResource() : null,
                    })
                  }
                />
                生成专属附件
              </label>
              {resources.attachment && (
                <ResourceProfileEditor
                  type="attachment"
                  value={resources.attachment}
                  onChange={(attachment) =>
                    setResources({ ...resources, attachment })
                  }
                  challengeId={c?.id}
                  formRef={formRef}
                />
              )}
            </fieldset>
          )}
          {resources.attachment && practical && !resources.container && (
            <fieldset disabled={pending} className="mb-6">
              <FlagInjection
                parts={multi ? parts : []}
                setParts={setParts}
                singleName={flagEnv}
                onSingleName={setFlagEnv}
                dynamic={dynamic}
              />
            </fieldset>
          )}
          <ChallengeAttachments
            challengeId={c?.id}
            attachments={c?.attachments ?? []}
            disabled={pending}
          />
        </ConfigPanel>
        <ConfigPanel value="publication" active={section}>
          <FieldSet disabled={pending}>
            <FieldLegend className="sr-only">发布设置</FieldLegend>
            <FieldGroup className="grid items-start gap-5 md:grid-cols-2">
              <Field label="上线方式">
                <NativeSelect
                  aria-label="上线方式"
                  value={publication}
                  onChange={(e) => setPublication(e.target.value)}
                >
                  <NativeSelectOption value="disabled">
                    暂不启用
                  </NativeSelectOption>
                  <NativeSelectOption value="enabled">
                    立即启用
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Control orientation="horizontal" className="md:col-span-2">
                <Switch
                  id="challenge-practice"
                  name="practice"
                  disabled={type === "awd"}
                  defaultChecked={c?.practice ?? false}
                />
                <FieldLabel htmlFor="challenge-practice">开放练习</FieldLabel>
              </Control>
            </FieldGroup>
          </FieldSet>
        </ConfigPanel>
      </Tabs>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存题目"}
        </Button>
      </div>
    </form>
  );
}
