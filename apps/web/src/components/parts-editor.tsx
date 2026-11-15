import { lazy, Suspense } from "react";
import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import type { ChallengePart } from "@/lib/types";
import { randomUUID } from "@/lib/random-uuid";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { Separator } from "./ui/separator";
import { Field } from "./shared";
import { FlagTemplate } from "./admin/flag-template";
const ScoreCurve = lazy(() => import("./admin/score-curve"));

export type PartDraft = Partial<ChallengePart> & { key: string };
export const newPart = (flagEnv?: string): PartDraft => ({
  flag_env: flagEnv,
  key: randomUUID(),
  title: "",
  initial_points: 100,
  minimum_points: 50,
});
export function PartsEditor({
  parts,
  setParts,
  dynamic,
  flagTemplate = "",
  dynamicScore = true,
  locked = false,
  decay = 20,
  showCurves = false,
}: {
  parts: PartDraft[];
  setParts: (v: PartDraft[]) => void;
  dynamic: boolean;
  flagTemplate?: string;
  dynamicScore?: boolean;
  locked?: boolean;
  decay?: number;
  showCurves?: boolean;
}) {
  const move = (index: number, step: number) => {
    const next = [...parts];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    setParts(next);
  };
  return (
    <div className="space-y-6">
      {parts.map((p, i) => (
        <fieldset key={p.key} className="min-w-0 space-y-4">
          <legend className="sr-only">小题 {i + 1}</legend>
          {i > 0 && <Separator className="mb-6" />}
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 text-sm font-medium">
              {p.role === "attack"
                ? "攻击"
                : p.role === "defense"
                  ? "防守"
                  : `小题 ${i + 1}`}
            </h3>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="上移小题"
                disabled={!i}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="下移小题"
                disabled={i === parts.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="删除小题"
                disabled={locked || parts.length <= 2}
                onClick={() => setParts(parts.filter((x) => x.key !== p.key))}
              >
                <X />
              </Button>
            </div>
          </div>
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <Field label="小题名称">
                <Input
                  name={`part-${p.key}-title`}
                  defaultValue={p.title}
                  onChange={(e) =>
                    setParts(
                      parts.map((part) =>
                        part.key === p.key
                          ? { ...part, title: e.target.value }
                          : part,
                      ),
                    )
                  }
                  required
                  maxLength={80}
                />
              </Field>
              <div hidden={dynamic}>
                <Field label={p.id ? "Flag（留空保留）" : "Flag"}>
                  <Input
                    type="password"
                    autoComplete="off"
                    name={`part-${p.key}-flag`}
                    disabled={dynamic}
                    required={!dynamic && !p.id}
                    maxLength={256}
                  />
                </Field>
              </div>
              {dynamic && p.role !== "defense" && (
                <FlagTemplate
                  value={p.flag_template ?? ""}
                  inherited={flagTemplate}
                  onChange={(value) =>
                    setParts(
                      parts.map((part) =>
                        part.key === p.key
                          ? { ...part, flag_template: value || null }
                          : part,
                      ),
                    )
                  }
                />
              )}
              <Field label="小题说明（可选）">
                <Textarea
                  name={`part-${p.key}-description`}
                  defaultValue={p.description}
                  maxLength={1000}
                  rows={2}
                />
              </Field>
            </div>
            <Separator className="lg:hidden" />
            <Separator
              orientation="vertical"
              className="hidden h-auto self-stretch lg:block"
            />
            <div className="min-w-0 space-y-4">
              <div
                className={`grid gap-4 ${dynamicScore ? "sm:grid-cols-2" : ""}`}
              >
                <Field label={dynamicScore ? "初始分" : "分值"}>
                  <Input
                    type="number"
                    name={`part-${p.key}-initial_points`}
                    defaultValue={p.initial_points}
                    onChange={(e) =>
                      setParts(
                        parts.map((part) =>
                          part.key === p.key
                            ? {
                                ...part,
                                initial_points: Number(e.target.value),
                              }
                            : part,
                        ),
                      )
                    }
                    required
                    min={1}
                    max={10000}
                  />
                </Field>
                <div hidden={!dynamicScore}>
                  <Field label="最低分">
                    <Input
                      type="number"
                      name={`part-${p.key}-minimum_points`}
                      defaultValue={p.minimum_points}
                      onChange={(e) =>
                        setParts(
                          parts.map((part) =>
                            part.key === p.key
                              ? {
                                  ...part,
                                  minimum_points: Number(e.target.value),
                                }
                              : part,
                          ),
                        )
                      }
                      disabled={!dynamicScore}
                      required={dynamicScore}
                      min={1}
                      max={10000}
                    />
                  </Field>
                </div>
              </div>
              {dynamicScore && showCurves && (
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
                    initial={Number(p.initial_points)}
                    minimum={Number(p.minimum_points)}
                    decay={decay}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={locked || parts.length >= 20}
        onClick={() => {
          const used = new Set(
            parts.map((p, index) => p.flag_env ?? `FLAG_${index + 1}`),
          );
          let index = 1;
          while (used.has(`FLAG_${index}`)) index++;
          setParts([...parts, newPart(`FLAG_${index}`)]);
        }}
      >
        <Plus />
        添加小题
      </Button>
    </div>
  );
}
export function readParts(f: FormData, parts: PartDraft[]) {
  return parts.map((p) => ({
    id: p.id,
    role: p.role ?? "flag",
    flag_env: p.role === "defense" ? null : p.flag_env,
    flag_targets: p.role === "defense" ? null : (p.flag_targets ?? null),
    flag_template: p.role === "defense" ? null : (p.flag_template ?? null),
    title: f.get(`part-${p.key}-title`),
    description: f.get(`part-${p.key}-description`),
    initial_points: Number(f.get(`part-${p.key}-initial_points`)),
    minimum_points: Number(
      f.get(`part-${p.key}-minimum_points`) ?? p.minimum_points ?? 50,
    ),
    ...(f.get(`part-${p.key}-flag`)
      ? { flag: f.get(`part-${p.key}-flag`) }
      : {}),
  }));
}
