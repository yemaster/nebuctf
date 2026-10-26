import { useState } from "react";
import { toast } from "sonner";
import { api, useAction } from "@/lib/api";
import { Field } from "./shared";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

export type Profile = {
  real_name: string;
  student_number: string;
  phone: string;
};

export function AccountProfile({ profile }: { profile: Profile }) {
  const [value, setValue] = useState(profile);
  const save = useAction(
    () => api("/account/profile", "PUT", value),
    () => toast.success("资料已保存"),
  );
  return (
    <Card className="mb-7 border-0 shadow-none">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm">参赛资料</CardTitle>
        <p className="text-xs text-muted-foreground">选填，仅管理员可见。</p>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <fieldset
            disabled={save.isPending}
            className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <Field label="姓名">
              <Input
                value={value.real_name}
                maxLength={80}
                autoComplete="name"
                onChange={(e) =>
                  setValue({ ...value, real_name: e.target.value })
                }
              />
            </Field>
            <Field label="学号">
              <Input
                value={value.student_number}
                maxLength={48}
                autoComplete="off"
                onChange={(e) =>
                  setValue({ ...value, student_number: e.target.value })
                }
              />
            </Field>
            <Field label="联系电话">
              <Input
                type="tel"
                value={value.phone}
                maxLength={32}
                autoComplete="tel"
                onChange={(e) => setValue({ ...value, phone: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={save.isPending}>
              保存资料
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
