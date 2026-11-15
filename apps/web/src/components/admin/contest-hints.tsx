import type { HintPolicy, HintOverride } from "@/lib/hints";
import type { Challenge } from "@/lib/types";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "../ui/input-group";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";

function PolicyEditor({
  value,
  onChange,
  label,
  inherit = true,
}: {
  value: HintPolicy | undefined;
  onChange: (value: HintPolicy | undefined) => void;
  label: string;
  inherit?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        wrapperClassName="min-w-0 flex-1"
        aria-label={label}
        value={value?.mode ?? "inherit"}
        onChange={(e) => {
          const mode = e.target.value;
          onChange(
            mode === "inherit"
              ? undefined
              : mode === "fixed"
                ? { mode, points: 50 }
                : mode === "factor"
                  ? { mode, factor: 0.8 }
                  : { mode: "free" },
          );
        }}
      >
        <NativeSelectOption value="free">免费</NativeSelectOption>
        {inherit && (
          <NativeSelectOption value="inherit">继承默认</NativeSelectOption>
        )}
        <NativeSelectOption value="fixed">直接扣分</NativeSelectOption>
        <NativeSelectOption value="factor">得分系数</NativeSelectOption>
      </NativeSelect>
      {value && value.mode !== "free" && (
        <InputGroup className="w-32">
          <InputGroupInput
            type="number"
            required
            aria-label={`${label}${value.mode === "fixed" ? "扣分" : "系数"}`}
            min={value.mode === "fixed" ? 1 : 0.01}
            max={value.mode === "fixed" ? 10000 : 0.99}
            step={value.mode === "fixed" ? 1 : 0.01}
            value={value.mode === "fixed" ? value.points : value.factor}
            onChange={(e) =>
              onChange(
                value.mode === "fixed"
                  ? { mode: "fixed", points: Number(e.target.value) }
                  : { mode: "factor", factor: Number(e.target.value) },
              )
            }
          />
          <InputGroupAddon align="inline-end">
            {value.mode === "fixed" ? "分" : "倍"}
          </InputGroupAddon>
        </InputGroup>
      )}
    </div>
  );
}

export function ContestHints({
  policy,
  onPolicyChange,
}: {
  policy: HintPolicy;
  onPolicyChange: (value: HintPolicy) => void;
}) {
  return (
    <PolicyEditor
      value={policy}
      onChange={(value) => onPolicyChange(value ?? { mode: "free" })}
      label="默认提示规则"
      inherit={false}
    />
  );
}

export function QuestionHints({
  challenge,
  overrides,
  onOverridesChange,
}: {
  challenge: Challenge;
  overrides: HintOverride[];
  onOverridesChange: (value: HintOverride[]) => void;
}) {
  if (!challenge.hints?.length) return null;
  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-label={`${challenge.title}提示规则`}
    >
      <h4 className="text-sm font-medium">提示规则</h4>
      <div className="divide-y">
        {challenge.hints.map((hint, index) => {
          if (typeof hint === "string") return null;
          const current = overrides.find(
            (v) => v.challenge_id === challenge.id && v.hint_id === hint.id,
          );
          return (
            <div
              key={hint.id}
              className="grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <p className="min-w-0 break-words text-sm">
                <span className="mr-2 text-muted-foreground">{index + 1}.</span>
                {hint.content}
              </p>
              <PolicyEditor
                label={`${challenge.title} 提示 ${index + 1}`}
                value={current?.policy}
                onChange={(policy) =>
                  onOverridesChange([
                    ...overrides.filter(
                      (v) =>
                        v.challenge_id !== challenge.id ||
                        v.hint_id !== hint.id,
                    ),
                    ...(policy
                      ? [
                          {
                            challenge_id: challenge.id,
                            hint_id: hint.id,
                            policy,
                          },
                        ]
                      : []),
                  ])
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
