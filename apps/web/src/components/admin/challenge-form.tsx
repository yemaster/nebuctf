import { randomUUID as hintUUID } from "@/lib/random-uuid";
import { useUser } from "@/App";
import { can } from "@/lib/access-control";
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
import { Separator } from "../ui/separator";
import { Box, CircleHelp, ExternalLink, FolderOpen } from "lucide-react";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
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
import {
  ConfigPanel,
  focusInvalidField,
  useConfigSection,
} from "./config-tabs";
import { ResourceLimits } from "./resource-limits";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
const ScoreCurve = lazy(() => import("./score-curve"));

const baseSections = ["content", "scoring", "attachments", "publication"];
const practicalSections = [...baseSections, "environment"];
const defenseSections = [...practicalSections, "judging"];

export function ChallengeForm({
  challenge: c,
  pending,
  readOnly = false,
  onSave,
}: {
  challenge: Challenge | null;
  pending: boolean;
  readOnly?: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const user = useUser();
  const imageManagementLink = can(user, "images.read") && (
    <Button asChild variant="ghost" size="sm">
      <a
        href="/admin/images"
        target="_blank"
        rel="noopener noreferrer"
        title="在新标签页打开 Docker 镜像"
      >
        Docker 镜像
        <ExternalLink />
      </a>
    </Button>
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [publication, setPublication] = useState(
    c?.published ? "enabled" : "disabled",
  );
  const [type, setType] = useState<QuestionType>(c?.challenge_type ?? "ctf");
  const [resources, setResources] = useState<Resources>(() => profiles(c));
  const [flagMode, setFlagMode] = useState(
    c?.flag_mode ?? (c?.kind.startsWith("dynamic") ? "dynamic" : "static"),
  );
  const [objective, setObjective] = useState(c?.objective ?? newObjective());
  const [patch, setPatch] = useState<PatchConfig>({
    checker_image: "",
    patch_root: "/app",
    timeout: 60,
    cpu: 500,
    memory: 256,
    ...c?.patch_config,
    update_timeout: c?.patch_config?.update_timeout ?? 30,
  });
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
  const [flagTargets, setFlagTargets] = useState<string[] | null>(
    c?.flag_targets ?? null,
  );
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
  const [section, setSection] = useConfigSection(
    attackDefense
      ? defenseSections
      : practical
        ? practicalSections
        : baseSections,
    "content",
  );
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
          flag_targets: practical && resources.container ? flagTargets : null,
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
                  flag_targets: resources.container ? p.flag_targets : null,
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
            <FieldSet disabled={pending || readOnly}>
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
            <FieldSet disabled={pending || readOnly}>
              <FieldLegend>题面与提示</FieldLegend>
              <FieldGroup className="gap-5">
                <Control>
                  <FieldLabel htmlFor="challenge-description">题面</FieldLabel>
                  <MarkdownEditor
                    id="challenge-description"
                    name="description"
                    label="题目内容"
                    placeholder="使用 Markdown 编写题面"
                    value={description}
                    onChange={setDescription}
                    disabled={pending || readOnly}
                    maxLength={20000}
                  />
                </Control>
                <HintsEditor
                  value={hints}
                  onChange={setHints}
                  disabled={pending || readOnly}
                />
              </FieldGroup>
            </FieldSet>
          </div>
        </ConfigPanel>
        <ConfigPanel value="scoring" active={section}>
          <fieldset disabled={pending || readOnly} className="space-y-6">
            {type === "objective" && (
              <ObjectiveEditor value={objective} onChange={setObjective} />
            )}
            <div
              className={`grid items-start gap-6 ${practical ? "xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" : ""}`}
            >
              {practical && (
                <section
                  className="min-w-0 space-y-4"
                  aria-labelledby="challenge-flag-heading"
                >
                  <h3
                    id="challenge-flag-heading"
                    className="text-sm font-medium"
                  >
                    Flag 设置
                  </h3>
                  <div className="space-y-4">
                    {type === "awdp" ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">动态 Flag</Badge>
                        <Badge variant="outline">攻击 / 防守</Badge>
                      </div>
                    ) : (
                      type !== "awd" && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label id="challenge-flag-mode-label">
                              Flag 方式
                            </Label>
                            <ToggleGroup
                              type="single"
                              variant="outline"
                              size="sm"
                              className="isolate w-full"
                              aria-labelledby="challenge-flag-mode-label"
                              value={flagMode}
                              disabled={attackDefense}
                              onValueChange={(value) => {
                                if (value)
                                  setFlagMode(value as "static" | "dynamic");
                              }}
                            >
                              <ToggleGroupItem
                                value="static"
                                className="flex-1"
                              >
                                静态 Flag
                              </ToggleGroupItem>
                              <ToggleGroupItem
                                value="dynamic"
                                className="flex-1"
                              >
                                动态 Flag
                              </ToggleGroupItem>
                            </ToggleGroup>
                          </div>
                          <div className="space-y-2">
                            <Label id="challenge-judging-mode-label">
                              判题方式
                            </Label>
                            <ToggleGroup
                              type="single"
                              variant="outline"
                              size="sm"
                              className="isolate w-full"
                              aria-labelledby="challenge-judging-mode-label"
                              value={multi ? "multiple" : "single"}
                              disabled={attackDefense}
                              onValueChange={(value) => {
                                if (value) setMulti(value === "multiple");
                              }}
                            >
                              <ToggleGroupItem
                                value="single"
                                className="flex-1"
                              >
                                单 Flag
                              </ToggleGroupItem>
                              <ToggleGroupItem
                                value="multiple"
                                className="flex-1"
                              >
                                多个小题
                              </ToggleGroupItem>
                            </ToggleGroup>
                          </div>
                        </div>
                      )
                    )}
                    {(type === "awd" || dynamic) && (
                      <FlagTemplate
                        value={flagTemplate}
                        onChange={setFlagTemplate}
                        disabled={pending || readOnly}
                      />
                    )}
                    {type !== "awd" && !multi && !dynamic && (
                      <Field
                        label={retainsFlag ? "Flag（留空保留原值）" : "Flag"}
                      >
                        <Input
                          name="flag"
                          type="password"
                          autoComplete="off"
                          maxLength={256}
                          required={!retainsFlag}
                        />
                      </Field>
                    )}
                  </div>
                </section>
              )}
              {practical && (
                <>
                  <Separator className="xl:hidden" />
                  <Separator
                    orientation="vertical"
                    className="hidden h-auto self-stretch xl:block"
                  />
                </>
              )}
              <section
                className="min-w-0 space-y-4"
                aria-labelledby="challenge-scoring-heading"
              >
                <h3
                  id="challenge-scoring-heading"
                  className="text-sm font-medium"
                >
                  计分规则
                </h3>
                <div className="space-y-4">
                  {type === "awd" ? (
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">计分来源</span>
                      <span>比赛规则</span>
                    </div>
                  ) : (
                    <>
                      {practical && (
                        <div className="space-y-2">
                          <Label id="challenge-scoring-mode-label">
                            计分方式
                          </Label>
                          <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            className="isolate w-full"
                            aria-labelledby="challenge-scoring-mode-label"
                            disabled={!practical}
                            value={dynamicScore ? "dynamic" : "fixed"}
                            onValueChange={(value) => {
                              if (value) setDynamicScore(value === "dynamic");
                            }}
                          >
                            <ToggleGroupItem value="dynamic" className="flex-1">
                              动态积分
                            </ToggleGroupItem>
                            <ToggleGroupItem value="fixed" className="flex-1">
                              固定积分
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                      )}
                      <div
                        className={
                          multi
                            ? "grid gap-4"
                            : "grid grid-cols-2 gap-4 sm:grid-cols-3"
                        }
                      >
                        {!multi && (
                          <>
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
                          </>
                        )}
                        {dynamicScore && (
                          <div
                            className={`space-y-2 ${multi ? "" : "col-span-2 sm:col-span-1"}`}
                          >
                            <div className="flex items-center gap-1">
                              <Label htmlFor="challenge-score-decay">
                                衰减人数
                              </Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 rounded-full text-muted-foreground"
                                    aria-label="衰减人数说明"
                                  >
                                    <CircleHelp className="size-4" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-64 p-3 text-sm"
                                  align="start"
                                >
                                  人数越大，分值下降越慢。
                                </PopoverContent>
                              </Popover>
                            </div>
                            <Input
                              id="challenge-score-decay"
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
                          </div>
                        )}
                      </div>
                      {!multi && dynamicScore && section === "scoring" && (
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
                    </>
                  )}
                </div>
              </section>
            </div>
            {type !== "awd" && (
              <fieldset
                hidden={!multi || !practical}
                disabled={!multi || pending || !practical}
                className="min-w-0"
              >
                <Separator className="mb-6" />
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
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="environment" active={section}>
          <fieldset
            disabled={pending || readOnly || !practical}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
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
              {imageManagementLink}
            </div>
            {resources.container && (
              <ResourceProfileEditor
                type="container"
                value={resources.container}
                onChange={(container) => {
                  const before =
                    resources.container?.topology?.services.map(
                      (service) => service.name,
                    ) ?? [];
                  const after =
                    container.topology?.services.map(
                      (service) => service.name,
                    ) ?? [];
                  const removed = before.filter(
                    (name) => !after.includes(name),
                  );
                  const added = after.filter((name) => !before.includes(name));
                  const remap = (targets: string[] | null | undefined) => {
                    if (targets == null) return null;
                    const next = targets
                      .map((name) =>
                        removed.length === 1 &&
                        added.length === 1 &&
                        name === removed[0]
                          ? added[0]!
                          : name,
                      )
                      .filter(
                        (name) => name === "main" || after.includes(name),
                      );
                    return next.length ? next : ["main"];
                  };
                  setFlagTargets(remap(flagTargets));
                  setParts(
                    parts.map((part) => ({
                      ...part,
                      flag_targets: remap(part.flag_targets),
                    })),
                  );
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
                services={resources.container.topology?.services ?? []}
                singleTargets={flagTargets}
                onSingleTargets={setFlagTargets}
              />
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="judging" active={section}>
          <fieldset
            disabled={pending || readOnly || !attackDefense}
            className="min-w-0 space-y-6"
          >
            <section
              className="min-w-0 space-y-4"
              aria-labelledby="patch-checker-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="patch-checker-heading" className="text-sm font-medium">
                  补丁校验
                </h3>
                {imageManagementLink}
              </div>
              <CheckerImageTools
                image={attackDefense ? patch.checker_image : ""}
              >
                {(status, actions) => (
                  <div className="min-w-0 space-y-2">
                    <div className="flex min-h-8 flex-wrap items-center gap-2">
                      <Label htmlFor="patch-checker-image">校验镜像</Label>
                      {status}
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {actions}
                      </div>
                    </div>
                    <InputGroup>
                      <InputGroupAddon>
                        <Box aria-hidden="true" />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="patch-checker-image"
                        name="patch-checker-image"
                        aria-label="补丁校验镜像"
                        required={attackDefense}
                        maxLength={200}
                        value={patch.checker_image}
                        className="font-mono text-sm"
                        placeholder="nebuctf/checker:1.0"
                        onChange={(event) =>
                          setPatch({
                            ...patch,
                            checker_image: event.target.value,
                          })
                        }
                      />
                    </InputGroup>
                  </div>
                )}
              </CheckerImageTools>
            </section>
            <Separator />
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <section
                className="min-w-0 space-y-4"
                aria-labelledby="patch-execution-heading"
              >
                <div className="flex items-center gap-1">
                  <h3
                    id="patch-execution-heading"
                    className="text-sm font-medium"
                  >
                    执行设置
                  </h3>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="更新脚本说明"
                        className="size-6 text-muted-foreground"
                      >
                        <CircleHelp className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[min(22rem,calc(100vw-2rem))] space-y-3 text-sm"
                    >
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                        <dt className="text-muted-foreground">入口</dt>
                        <dd>
                          执行目录中的 <code>update.sh</code>
                        </dd>
                        <dt className="text-muted-foreground">补丁文件</dt>
                        <dd className="break-all">
                          <code>$PATCH_DIR=/.nebuctf-update</code>
                        </dd>
                        <dt className="text-muted-foreground">依赖</dt>
                        <dd>镜像须自带 /bin/sh 和离线工具</dd>
                        <dt className="text-muted-foreground">更新阶段</dt>
                        <dd>隔离 root、禁用网络，使用下方资源限额</dd>
                        <dt className="text-muted-foreground">脚本职责</dt>
                        <dd>只修改文件，不启动服务或后台任务</dd>
                        <dt className="text-muted-foreground">更新完成</dt>
                        <dd>平台按原入口启动，非 root、只读根</dd>
                      </dl>
                    </PopoverContent>
                  </Popover>
                </div>
                <Field label="执行目录">
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderOpen aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput
                      name="patch-root"
                      aria-label="更新脚本执行目录"
                      required
                      value={patch.patch_root}
                      pattern="/(app|srv|opt)(/[a-zA-Z0-9_-]+)*"
                      className="font-mono text-sm"
                      onChange={(event) =>
                        setPatch({ ...patch, patch_root: event.target.value })
                      }
                    />
                  </InputGroup>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      {
                        key: "update_timeout",
                        label: "更新超时",
                        min: 1,
                        max: 120,
                      },
                      {
                        key: "timeout",
                        label: "单项校验超时",
                        min: 10,
                        max: 120,
                      },
                    ] as const
                  ).map((field) => (
                    <Field key={field.key} label={field.label}>
                      <InputGroup>
                        <InputGroupInput
                          name={`patch-${field.key}`}
                          aria-label={`${field.label}（秒）`}
                          type="number"
                          required
                          min={field.min}
                          max={field.max}
                          value={patch[field.key]}
                          className="tabular-nums"
                          onChange={(event) =>
                            setPatch({
                              ...patch,
                              [field.key]: Number(event.target.value),
                            })
                          }
                        />
                        <InputGroupAddon align="inline-end">秒</InputGroupAddon>
                      </InputGroup>
                    </Field>
                  ))}
                </div>
              </section>
              <Separator className="xl:hidden" />
              <Separator
                orientation="vertical"
                className="hidden h-auto self-stretch xl:block"
              />
              <section
                className="min-w-0 space-y-4"
                aria-labelledby="patch-resources-heading"
              >
                <h3
                  id="patch-resources-heading"
                  className="text-sm font-medium"
                >
                  资源限制
                </h3>
                <ResourceLimits
                  value={patch}
                  preset="checker"
                  namePrefix="patch"
                  disabled={pending || readOnly || !attackDefense}
                  onChange={(limits) => setPatch({ ...patch, ...limits })}
                />
              </section>
            </div>
            {type === "awd" && (
              <>
                <Separator />
                <section
                  className="min-w-0 space-y-4"
                  aria-labelledby="awd-checker-heading"
                >
                  <h3 id="awd-checker-heading" className="text-sm font-medium">
                    服务巡检
                  </h3>
                  <div className="grid min-w-0 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <CheckerImageTools image={awd.checker_image}>
                      {(status, actions) => (
                        <div className="min-w-0 space-y-2">
                          <div className="flex min-h-8 flex-wrap items-center gap-2">
                            <Label htmlFor="awd-checker-image">巡检镜像</Label>
                            {status}
                            <div className="ml-auto flex flex-wrap items-center gap-2">
                              {actions}
                            </div>
                          </div>
                          <InputGroup>
                            <InputGroupAddon>
                              <Box aria-hidden="true" />
                            </InputGroupAddon>
                            <InputGroupInput
                              id="awd-checker-image"
                              name="awd-checker-image"
                              aria-label="服务巡检镜像"
                              required
                              maxLength={200}
                              value={awd.checker_image}
                              className="font-mono text-sm"
                              placeholder="nebuctf/checker:1.0"
                              onChange={(event) =>
                                setAwd({
                                  ...awd,
                                  checker_image: event.target.value,
                                })
                              }
                            />
                          </InputGroup>
                        </div>
                      )}
                    </CheckerImageTools>
                    <div className="space-y-2">
                      <div className="flex min-h-8 items-center">
                        <Label htmlFor="awd-timeout">巡检超时</Label>
                      </div>
                      <InputGroup>
                        <InputGroupInput
                          id="awd-timeout"
                          name="awd-timeout"
                          aria-label="巡检超时（秒）"
                          required
                          type="number"
                          min={5}
                          max={60}
                          value={awd.timeout}
                          className="tabular-nums"
                          onChange={(event) =>
                            setAwd({
                              ...awd,
                              timeout: Number(event.target.value),
                            })
                          }
                        />
                        <InputGroupAddon align="inline-end">秒</InputGroupAddon>
                      </InputGroup>
                    </div>
                  </div>
                </section>
              </>
            )}
          </fieldset>
        </ConfigPanel>
        <ConfigPanel value="attachments" active={section}>
          {practical && (
            <fieldset disabled={pending || readOnly} className="mb-8 space-y-6">
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
            <fieldset disabled={pending || readOnly} className="mb-6">
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
            disabled={pending || readOnly}
          />
        </ConfigPanel>
        <ConfigPanel value="publication" active={section}>
          <FieldSet disabled={pending || readOnly}>
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
        <Button type="submit" disabled={pending || readOnly}>
          {pending ? "保存中…" : "保存题目"}
        </Button>
      </div>
    </form>
  );
}
