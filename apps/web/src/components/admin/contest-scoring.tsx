import { lazy, Suspense } from "react";
import type { Challenge } from "@/lib/types";
import { defaultRound, type Points, type Scoring } from "@/lib/competition";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Field } from "../shared";

const Curve = lazy(() => import("./score-curve"));
export const scoringNames = {
  inherit: "沿用题库",
  fixed: "固定分值",
  dynamic: "动态分值",
  round: "轮次计分",
};

function defaultPoints(c: Challenge): Points {
  return {
    initial_points: c.initial_points,
    minimum_points: c.minimum_points,
    decay: c.decay,
  };
}
function partPoints(c: Challenge, v: Scoring, id: string): Points {
  const p = c.parts.find((p) => p.id === id)!;
  return (
    (v.mode !== "inherit" && v.parts.find((p) => p.id === id)?.points) || {
      initial_points: p.initial_points,
      minimum_points: p.minimum_points,
      decay: c.decay,
    }
  );
}
export function scoreSummary(c: Challenge, v: Scoring) {
  const units = c.parts.length
    ? c.parts.map((p) => partPoints(c, v, p.id))
    : [
        v.mode === "inherit"
          ? defaultPoints(c)
          : (v.points ?? defaultPoints(c)),
      ];
  const initial = units.reduce((n, p) => n + p.initial_points, 0);
  const minimum = units.reduce((n, p) => n + p.minimum_points, 0);
  const dynamic =
    v.mode === "inherit"
      ? c.dynamic_score
      : v.mode === "dynamic" || (v.mode === "round" && v.round?.dynamic);
  return `${dynamic ? `${initial} → ${minimum}` : initial} 分${v.mode === "round" ? " / 轮" : ""}`;
}

function PointFields({
  value,
  onChange,
  dynamic,
  prefix,
}: {
  value: Points;
  onChange: (v: Points) => void;
  dynamic: boolean;
  prefix: string;
}) {
  return (
    <div className={dynamic ? "grid min-w-0 gap-4 sm:grid-cols-3" : "max-w-xs"}>
      {(
        [
          { key: "initial_points", label: dynamic ? "初始分" : "分值" },
          { key: "minimum_points", label: "最低分" },
          { key: "decay", label: "衰减人数" },
        ] as const
      )
        .filter((_, i) => dynamic || !i)
        .map((f) => (
          <Field key={f.key} label={f.label} className="min-w-0">
            <Input
              aria-label={`${prefix}${f.label}`}
              type="number"
              required
              min={1}
              max={f.key === "minimum_points" ? value.initial_points : 10000}
              value={value[f.key]}
              onChange={(e) => {
                const next = { ...value, [f.key]: Number(e.target.value) };
                if (!dynamic) next.minimum_points = next.initial_points;
                onChange(next);
              }}
            />
          </Field>
        ))}
    </div>
  );
}

export function ScoringEditor({
  challenge: c,
  value: v,
  onChange: set,
}: {
  challenge: Challenge;
  value: Scoring;
  onChange: (v: Scoring) => void;
}) {
  const points = v.points ?? defaultPoints(c);
  const dynamic =
    v.mode === "dynamic" || (v.mode === "round" && !!v.round?.dynamic);
  const units = c.parts.length
    ? c.parts.map((p) => ({
        id: p.id,
        title: p.title,
        points: partPoints(c, v, p.id),
      }))
    : [{ id: "", title: "", points }];
  return (
    <div className="min-w-0 space-y-4">
      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-3 text-sm font-medium">计分方式</legend>
        <RadioGroup
          aria-label={`${c.title}计分方式`}
          className="grid grid-cols-2 gap-x-6 gap-y-3"
          value={v.mode}
          onValueChange={(value) => {
            const mode = value as Scoring["mode"];
            if (mode === "inherit") {
              set({ mode, parts: [] });
              return;
            }
            set({
              ...v,
              mode,
              points,
              round: mode === "round" ? (v.round ?? defaultRound()) : undefined,
            });
          }}
        >
          {Object.entries(scoringNames)
            .filter(([mode]) =>
              c.challenge_type === "awd"
                ? mode === "round"
                : c.challenge_type === "objective"
                  ? ["inherit", "fixed"].includes(mode)
                  : true,
            )
            .map(([mode, label]) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={mode} />
                {label}
              </label>
            ))}
        </RadioGroup>
      </fieldset>
      {v.mode === "inherit" ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {c.dynamic_score ? "动态分值" : "固定分值"}，{scoreSummary(c, v)}
          </p>
          {c.parts.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-3">
              <span>{p.title}</span>
              <span className="tabular-nums">
                {c.dynamic_score
                  ? `${p.initial_points} → ${p.minimum_points}`
                  : p.initial_points}{" "}
                分
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {v.mode === "round" && v.round && (
            <div className="space-y-4">
              <div>
                {c.challenge_type !== "awd" && (
                  <fieldset className="min-w-0 space-y-3">
                    <legend className="mb-3 text-sm font-medium">
                      得分条件
                    </legend>
                    <RadioGroup
                      className="flex flex-wrap gap-4"
                      value={v.round.carry ? "carry" : "submit"}
                      onValueChange={(value) =>
                        set({
                          ...v,
                          round: { ...v.round!, carry: value === "carry" },
                        })
                      }
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="carry" />
                        解出后持续得分
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="submit" />
                        每轮重新提交
                      </label>
                    </RadioGroup>
                  </fieldset>
                )}
              </div>
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={v.round.dynamic}
                  onCheckedChange={(yes) =>
                    set({ ...v, round: { ...v.round!, dynamic: yes } })
                  }
                />
                每轮动态计分
              </label>
              {c.challenge_type === "awd" && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {(
                    [
                      {
                        key: "flag_lifetime",
                        label: "Flag 有效轮数",
                        min: 1,
                        max: 5,
                      },
                      {
                        key: "defense_points",
                        label: "守住 Flag 得分",
                        min: 0,
                        max: 10000,
                      },
                      {
                        key: "availability_points",
                        label: "服务可用得分",
                        min: 0,
                        max: 10000,
                      },
                    ] as const
                  ).map((f) => (
                    <Field key={f.key} label={f.label}>
                      <Input
                        required
                        type="number"
                        min={f.min}
                        max={f.max}
                        value={v.round![f.key]}
                        onChange={(e) =>
                          set({
                            ...v,
                            round: {
                              ...v.round!,
                              [f.key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="divide-y">
            {units.map((unit) => (
              <section
                key={unit.id}
                className="min-w-0 space-y-4 py-4 first:pt-0 last:pb-0"
                aria-label={unit.title || "题目分值"}
              >
                {unit.title && (
                  <h4 className="text-sm font-medium">{unit.title}</h4>
                )}
                <PointFields
                  prefix={unit.title || c.title}
                  value={unit.points}
                  dynamic={dynamic}
                  onChange={(next) =>
                    set(
                      unit.id
                        ? {
                            ...v,
                            parts: [
                              ...v.parts.filter((p) => p.id !== unit.id),
                              { id: unit.id, points: next },
                            ],
                          }
                        : { ...v, points: next },
                    )
                  }
                />
                {dynamic && (
                  <Suspense
                    fallback={
                      <div
                        className="h-52 rounded-md bg-muted/30"
                        aria-busy="true"
                      />
                    }
                  >
                    <Curve
                      initial={unit.points.initial_points}
                      minimum={unit.points.minimum_points}
                      decay={unit.points.decay}
                    />
                  </Suspense>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
