import type { ComponentProps, ReactNode } from "react";
import { Field, FieldGroup, FieldLegend, FieldSet } from "../ui/field";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { ContestRuleHelp } from "./contest-question-logic";

export function ContestSettingsSection({
  title,
  help,
  children,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FieldSet className="min-w-0">
      <FieldLegend className="flex items-center gap-1">
        {title}
        {help && <ContestRuleHelp>{help}</ContestRuleHelp>}
      </FieldLegend>
      <FieldGroup className="min-w-0 gap-4">{children}</FieldGroup>
    </FieldSet>
  );
}

export function ContestSettingSwitch({
  label,
  ...props
}: ComponentProps<typeof Switch> & { label: string }) {
  return (
    <Field orientation="horizontal" className="min-h-9">
      <Label className="justify-start gap-3 font-normal">
        <Switch {...props} />
        {label}
      </Label>
    </Field>
  );
}
