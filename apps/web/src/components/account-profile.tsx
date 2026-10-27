import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel, FieldError, FieldGroup } from "./ui/field";

export type Profile = {
  real_name: string;
  student_number: string;
  phone: string;
};

export function AccountProfile({ profile }: { profile: Profile }) {
  const cache = useQueryClient();
  const [value, setValue] = useState(profile);
  const [saved, setSaved] = useState(profile);
  const changed = (Object.keys(value) as (keyof Profile)[]).some(
    (key) => value[key] !== saved[key],
  );
  const save = useMutation({
    mutationFn: (data: Profile) =>
      api<Profile>("/account/profile", "PUT", data),
    onSuccess: (data) => {
      setValue(data);
      setSaved(data);
      cache.setQueryData(["/account/profile"], data);
    },
  });
  return (
    <form
      aria-labelledby="participation-profile-title"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && !save.isPending) save.mutate(value);
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="participation-profile-title" className="font-medium">
          参赛资料
        </h3>
        <p className="text-xs text-muted-foreground">选填，仅管理员可见</p>
      </div>
      <fieldset disabled={save.isPending}>
        <FieldGroup className="grid gap-4 lg:grid-cols-3">
          {(
            [
              ["real_name", "姓名", "text", "name", 80],
              ["student_number", "学号", "text", "off", 48],
              ["phone", "联系电话", "tel", "tel", 32],
            ] as const
          ).map(([key, label, type, autoComplete, maxLength]) => (
            <Field key={key} className="gap-2">
              <FieldLabel htmlFor={`profile-${key}`}>{label}</FieldLabel>
              <Input
                id={`profile-${key}`}
                name={key}
                type={type}
                autoComplete={autoComplete}
                maxLength={maxLength}
                value={value[key]}
                onChange={(event) => {
                  setValue({ ...value, [key]: event.target.value });
                  if (save.error) save.reset();
                }}
              />
            </Field>
          ))}
        </FieldGroup>
      </fieldset>
      {save.error && <FieldError>{save.error.message}</FieldError>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending || !changed}>
          {save.isPending && <Loader2 className="motion-safe:animate-spin" />}
          {save.isPending ? "保存中" : "保存资料"}
        </Button>
        {save.isSuccess && !changed && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm text-success"
          >
            <Check className="size-4" />
            已保存
          </span>
        )}
      </div>
    </form>
  );
}
