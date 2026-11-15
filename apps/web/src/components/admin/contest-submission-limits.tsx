import type {
  SubmissionLimits,
  SubmissionOverride,
} from "@/lib/submission-limits";
import type { Challenge } from "@/lib/types";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "../ui/input-group";

function Limit({
  label,
  name = label,
  value,
  inherited,
  onChange,
}: {
  label: string;
  name?: string;
  value: number | null | undefined;
  inherited?: number | null;
  onChange: (value: number | null | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <NativeSelect
          wrapperClassName="min-w-0 flex-1"
          aria-label={`${name}方式`}
          value={
            value === undefined
              ? "inherit"
              : value === null
                ? "unlimited"
                : "limited"
          }
          onChange={(e) =>
            onChange(
              e.target.value === "inherit"
                ? undefined
                : e.target.value === "unlimited"
                  ? null
                  : (inherited ?? 10),
            )
          }
        >
          {inherited !== undefined && (
            <NativeSelectOption value="inherit">
              继承（{inherited === null ? "不限" : `${inherited} 次`}）
            </NativeSelectOption>
          )}
          <NativeSelectOption value="unlimited">不限</NativeSelectOption>
          <NativeSelectOption value="limited">限次</NativeSelectOption>
        </NativeSelect>
        {typeof value === "number" && (
          <InputGroup className="w-32">
            <InputGroupInput
              type="number"
              aria-label={name}
              min={1}
              max={100000}
              step={1}
              required
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <InputGroupAddon align="inline-end">次</InputGroupAddon>
          </InputGroup>
        )}
      </div>
    </div>
  );
}

export function ContestSubmissionLimits({
  value,
  onChange,
}: {
  value: SubmissionLimits;
  onChange: (value: SubmissionLimits) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Limit
        label="默认 Flag 提交次数"
        value={value.flag}
        onChange={(flag) => onChange({ ...value, flag: flag ?? null })}
      />
      <Limit
        label="默认防御申请次数"
        value={value.defense}
        onChange={(defense) => onChange({ ...value, defense: defense ?? null })}
      />
    </div>
  );
}

export function QuestionSubmissionLimits({
  challenge,
  defaults,
  value,
  onChange,
}: {
  challenge: Challenge;
  defaults: SubmissionLimits;
  value: SubmissionOverride | undefined;
  onChange: (value: SubmissionOverride | undefined) => void;
}) {
  if (challenge.challenge_type === "objective") return null;
  const update = (
    key: "flag" | "defense",
    limit: number | null | undefined,
  ) => {
    const next = { ...value, challenge_id: challenge.id };
    if (limit === undefined) delete next[key];
    else next[key] = limit;
    onChange(
      next.flag === undefined && next.defense === undefined ? undefined : next,
    );
  };
  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-label={`${challenge.title}提交次数`}
    >
      <h4 className="text-sm font-medium">提交次数</h4>
      <div className="grid gap-4 sm:grid-cols-2">
        <Limit
          label="Flag"
          name={`${challenge.title} Flag 提交次数`}
          value={value?.flag}
          inherited={defaults.flag}
          onChange={(limit) => update("flag", limit)}
        />
        {(challenge.challenge_type === "awdp" ||
          challenge.challenge_type === "awd") && (
          <Limit
            label="防御申请"
            name={`${challenge.title} 防御申请次数`}
            value={value?.defense}
            inherited={defaults.defense}
            onChange={(limit) => update("defense", limit)}
          />
        )}
      </div>
    </section>
  );
}
