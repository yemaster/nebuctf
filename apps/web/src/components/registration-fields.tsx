import type {
  RegistrationField,
  RegistrationValues,
} from "@/lib/registration-form";
import { useId } from "react";
import { Input, Textarea } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Checkbox } from "./ui/checkbox";

export function RegistrationFields({
  fields,
  values,
  onChange,
  disabled = false,
}: {
  fields: RegistrationField[];
  values: RegistrationValues;
  onChange: (values: RegistrationValues) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  return (
    <div
      className={`grid items-start gap-x-6 gap-y-5 ${fields.length > 1 ? "md:grid-cols-2" : ""}`}
    >
      {fields.map((f) => {
        const value = values[f.id] ?? (f.type === "multi" ? [] : "");
        const set = (next: string | string[]) =>
          onChange({ ...values, [f.id]: next });
        return (
          <div
            key={f.id}
            className={
              ["textarea", "address"].includes(f.type)
                ? `grid gap-2 ${fields.length > 1 ? "md:col-span-2" : ""}`
                : "grid gap-2"
            }
          >
            <label
              htmlFor={`${prefix}-${f.id}`}
              className="text-sm font-medium"
            >
              {f.label}
              {f.required ? " *" : ""}
            </label>
            {f.type === "select" ? (
              <RadioGroup
                id={`${prefix}-${f.id}`}
                aria-label={f.label}
                value={typeof value === "string" ? value : ""}
                onValueChange={set}
                disabled={disabled}
                required={f.required}
                className="flex flex-wrap gap-4"
              >
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={o} />
                    {o}
                  </label>
                ))}
              </RadioGroup>
            ) : f.type === "multi" ? (
              <div
                id={`${prefix}-${f.id}`}
                role="group"
                aria-label={f.label}
                className="flex flex-wrap gap-4"
              >
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={disabled}
                      checked={Array.isArray(value) && value.includes(o)}
                      onCheckedChange={(checked) =>
                        set(
                          checked
                            ? [...(Array.isArray(value) ? value : []), o]
                            : Array.isArray(value)
                              ? value.filter((v) => v !== o)
                              : [],
                        )
                      }
                    />
                    {o}
                  </label>
                ))}
              </div>
            ) : ["textarea", "address"].includes(f.type) ? (
              <Textarea
                id={`${prefix}-${f.id}`}
                rows={f.type === "address" ? 2 : 3}
                value={String(value)}
                onChange={(e) => set(e.target.value)}
                required={f.required}
                maxLength={1000}
                disabled={disabled}
              />
            ) : (
              <Input
                id={`${prefix}-${f.id}`}
                type={
                  f.type === "email"
                    ? "email"
                    : f.type === "phone"
                      ? "tel"
                      : "text"
                }
                value={String(value)}
                onChange={(e) => set(e.target.value)}
                required={f.required}
                maxLength={f.type === "phone" ? 30 : 1000}
                disabled={disabled}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
export function RegistrationAnswersView({
  fields,
  values,
}: {
  fields: RegistrationField[];
  values: RegistrationValues;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {fields.map((f) => (
        <div
          key={f.id}
          className={
            ["textarea", "address"].includes(f.type) ? "md:col-span-2" : ""
          }
        >
          <dt className="mb-1 text-xs text-muted-foreground">{f.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm">
            {Array.isArray(values[f.id])
              ? (values[f.id] as string[]).join("、") || "—"
              : values[f.id] || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
