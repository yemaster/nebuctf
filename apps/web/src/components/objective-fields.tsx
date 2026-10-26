import type { Objective } from "@/lib/competition";
import type { ObjectiveResponse } from "@/lib/objective-paper";
import { Field } from "./shared";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
export function ObjectiveFields({
  definition: v,
  answer,
  onChange,
  disabled = false,
}: {
  definition: Objective;
  answer: ObjectiveResponse;
  onChange: (answer: ObjectiveResponse) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      {v.type === "blank" ? (
        v.blanks.map((b) => (
          <Field key={b.id} label={b.label}>
            <Input
              maxLength={500}
              value={answer.blanks?.[b.id] ?? ""}
              onChange={(e) =>
                onChange({
                  ...answer,
                  blanks: { ...answer.blanks, [b.id]: e.target.value },
                })
              }
            />
          </Field>
        ))
      ) : v.type === "single" ? (
        <RadioGroup
          aria-label="单选答案"
          disabled={disabled}
          value={answer.choices?.[0] ?? ""}
          onValueChange={(choice) => onChange({ choices: [choice] })}
        >
          {v.options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-4 has-[[data-state=checked]]:bg-accent"
            >
              <RadioGroupItem className="mt-0.5" value={o.id} />
              <span className="text-sm font-medium">{o.id}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-sm">
                {o.text}
              </span>
            </label>
          ))}
        </RadioGroup>
      ) : (
        v.options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-4 has-[[data-state=checked]]:bg-accent"
          >
            <Checkbox
              className="mt-0.5"
              disabled={disabled}
              checked={answer.choices?.includes(o.id) ?? false}
              onCheckedChange={(yes) =>
                onChange({
                  choices: yes
                    ? [...(answer.choices ?? []), o.id]
                    : (answer.choices ?? []).filter((id) => id !== o.id),
                })
              }
            />
            <span className="text-sm font-medium">{o.id}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-sm">
              {o.text}
            </span>
          </label>
        ))
      )}
    </fieldset>
  );
}
