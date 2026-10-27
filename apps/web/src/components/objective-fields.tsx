import { useId } from "react";
import type { Objective } from "@/lib/competition";
import type { ObjectiveResponse, ObjectiveReview } from "@/lib/objective-paper";
import { Field } from "./shared";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

const resultColors = {
  correct: "bg-success/10 text-success",
  missed: "bg-warning/10 text-warning",
  incorrect: "bg-destructive/10 text-destructive",
};
const resultLabels = {
  correct: "已选，正确",
  missed: "正确，未选",
  incorrect: "已选，错误",
};
export function ObjectiveFields({
  definition: v,
  answer,
  review,
  onChange,
  disabled = false,
}: {
  definition: Objective;
  answer: ObjectiveResponse;
  review?: ObjectiveReview | null;
  onChange: (answer: ObjectiveResponse) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  const options = v.options.map((o) => {
    const selected = answer.choices?.includes(o.id) ?? false;
    const result = review?.choices
      ? review.choices.includes(o.id)
        ? selected
          ? "correct"
          : "missed"
        : selected
          ? "incorrect"
          : undefined
      : undefined;
    return (
      <label
        key={o.id}
        data-result={result}
        className={`flex items-start gap-3 rounded-md p-4 transition-colors ${disabled ? "cursor-default" : "cursor-pointer"} ${result ? resultColors[result] : "bg-muted/40 has-[[data-state=checked]]:bg-accent"}`}
      >
        {v.type === "single" ? (
          <RadioGroupItem
            className={`mt-0.5 ${result ? "border-current text-current disabled:opacity-100 [&_svg]:fill-current" : ""}`}
            value={o.id}
            aria-invalid={result === "incorrect" || undefined}
          />
        ) : (
          <Checkbox
            className={`mt-0.5 ${result ? "border-current text-current disabled:opacity-100 data-[state=checked]:border-current data-[state=checked]:bg-transparent data-[state=checked]:text-current dark:bg-transparent dark:data-[state=checked]:bg-transparent" : ""}`}
            disabled={disabled}
            checked={selected}
            aria-invalid={result === "incorrect" || undefined}
            onCheckedChange={(yes) =>
              onChange({
                choices: yes
                  ? [...(answer.choices ?? []), o.id]
                  : (answer.choices ?? []).filter((id) => id !== o.id),
              })
            }
          />
        )}
        <span className="text-sm font-medium">{o.id}</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-sm">
          {o.text}
        </span>
        {result && <span className="sr-only">{resultLabels[result]}</span>}
      </label>
    );
  });
  return (
    <fieldset disabled={disabled} className="space-y-3">
      {v.type === "blank" ? (
        v.blanks.map((b) => {
          const correct = review?.blanks?.[b.id];
          const result =
            correct === undefined
              ? undefined
              : correct
                ? "correct"
                : "incorrect";
          return (
            <Field key={b.id} label={b.label}>
              <Input
                maxLength={500}
                data-result={result}
                aria-invalid={correct === false || undefined}
                aria-describedby={
                  result ? `${prefix}-${b.id}-result` : undefined
                }
                className={
                  result
                    ? `disabled:opacity-100 ${correct ? "border-success/50 bg-success/10 text-success dark:bg-success/10" : "border-destructive/50 bg-destructive/10 text-destructive dark:bg-destructive/10"}`
                    : undefined
                }
                value={answer.blanks?.[b.id] ?? ""}
                onChange={(e) =>
                  onChange({
                    ...answer,
                    blanks: { ...answer.blanks, [b.id]: e.target.value },
                  })
                }
              />
              {result && (
                <span id={`${prefix}-${b.id}-result`} className="sr-only">
                  {correct ? "答案正确" : "答案错误"}
                </span>
              )}
            </Field>
          );
        })
      ) : v.type === "single" ? (
        <RadioGroup
          aria-label="单选答案"
          disabled={disabled}
          value={answer.choices?.[0] ?? ""}
          onValueChange={(choice) => onChange({ choices: [choice] })}
        >
          {options}
        </RadioGroup>
      ) : (
        options
      )}
    </fieldset>
  );
}
