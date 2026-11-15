import type { Contest } from "@/lib/types";
import { Field } from "./shared";
import { Input } from "./ui/input";

export function ContestInviteCodeField({
  contest,
  groupId,
  value,
  onChange,
  formId,
}: {
  contest: Pick<Contest, "groups" | "registration_mode">;
  groupId: string;
  formId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const groupCode = contest.groups.find(
    (g) => g.id === groupId,
  )?.invite_code_set;
  if (!groupCode && contest.registration_mode !== "invite") return null;
  return (
    <Field label={groupCode ? "组别邀请码" : "比赛邀请码"}>
      <Input
        name="invite_code"
        form={formId}
        type="password"
        autoComplete="off"
        required
        minLength={6}
        maxLength={128}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
