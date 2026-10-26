import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import type { ContestGroup } from "@/lib/types";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Textarea } from "../ui/input";
import { Field } from "../shared";
import type { Registration, ReviewStatus } from "./contest-management-shared";

export type ReviewChange = {
  team_ids: string[];
  status?: ReviewStatus;
  group_id?: string | null;
  review_note?: string;
};
export type ReviewSubmit = (change: ReviewChange) => Promise<unknown>;

// These controls live inside an expandable row. Portalled content must not
// bubble into its row action when the user clicks labels or submits a form.
function ReviewPopover({
  title,
  trigger,
  busy,
  children,
}: {
  title: string;
  trigger: ReactNode;
  busy: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label={title}
        data-row-action="ignore"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-4"
      >
        <h3 className="break-all text-sm font-medium">{title}</h3>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function ReviewReasonAction({
  teamIds,
  title,
  status,
  busy,
  submit,
  label,
}: {
  teamIds: string[];
  title: string;
  status: "rejected" | "suspended";
  busy: boolean;
  submit: ReviewSubmit;
  label?: string;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const verb = status === "rejected" ? "拒绝" : "暂停";
  return (
    <ReviewPopover
      title={`${verb} ${title}`}
      busy={busy}
      trigger={
        <Button
          size="sm"
          variant="ghost"
          className="px-2 text-destructive last:pr-0 hover:text-destructive"
          disabled={busy}
          aria-label={`${verb} ${title}`}
          onClick={() => setError(null)}
        >
          {label ?? verb}
        </Button>
      }
    >
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !note.trim()) return;
            setError(null);
            try {
              await submit({
                team_ids: teamIds,
                status,
                review_note: note.trim(),
              });
              setNote("");
              close();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label={status === "rejected" ? "拒绝原因" : "暂停原因"}>
            <Textarea
              aria-label={`${verb}原因`}
              aria-invalid={!!error}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              required
              maxLength={500}
              rows={3}
              disabled={busy}
            />
          </Field>
          {status === "suspended" && (
            <p className="text-xs text-muted-foreground">
              暂停后将释放该队的比赛环境。
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={busy || !note.trim()}
            >
              {busy ? "保存中" : `确认${verb}`}
            </Button>
          </div>
        </form>
      )}
    </ReviewPopover>
  );
}

export function RegistrationReviewActions({
  registration: r,
  busy,
  submit,
}: {
  registration: Registration;
  busy: boolean;
  submit: ReviewSubmit;
}) {
  const accepted = r.status === "accepted";
  const verb = r.status === "suspended" ? "恢复" : "通过";
  const direct = (status: ReviewStatus) => {
    if (!busy)
      void submit({ team_ids: [r.team_id], status }).catch((e: Error) =>
        toast.error(e.message),
      );
  };
  return (
    <div
      role="group"
      aria-label={`审核 ${r.name}`}
      className="flex justify-end gap-1"
    >
      {!accepted && (
        <Button
          size="sm"
          variant={r.status === "suspended" ? "ghost" : "secondary"}
          className="px-2 last:pr-0"
          disabled={busy}
          aria-label={`${verb} ${r.name}`}
          onClick={() => direct("accepted")}
        >
          {verb}
        </Button>
      )}
      {(r.status === "pending" || accepted) && (
        <ReviewReasonAction
          teamIds={[r.team_id]}
          title={r.name}
          status={accepted ? "suspended" : "rejected"}
          busy={busy}
          submit={submit}
        />
      )}
      {r.status === "rejected" && !r.accepted_at && (
        <Button
          size="sm"
          variant="ghost"
          className="px-2 pr-0"
          disabled={busy}
          aria-label={`重新审核 ${r.name}`}
          onClick={() => direct("pending")}
        >
          复审
        </Button>
      )}
    </div>
  );
}

export function RegistrationGroupControl({
  registration: r,
  groups,
  locked,
  busy,
  submit,
}: {
  registration: Registration;
  groups: ContestGroup[];
  locked: boolean;
  busy: boolean;
  submit: ReviewSubmit;
}) {
  const [group, setGroup] = useState(r.group_id ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!groups.length || locked)
    return (
      <span title={locked && groups.length ? "开赛后不可调整组别" : undefined}>
        {r.group_name ?? "公开组"}
      </span>
    );
  return (
    <ReviewPopover
      title={`调整 ${r.name} 的组别`}
      busy={busy}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="h-auto w-full min-w-0 justify-start gap-1.5 px-0 py-1 text-left whitespace-normal has-[>svg]:px-0"
          aria-label={`调整 ${r.name} 的组别`}
          disabled={busy}
          onClick={() => {
            setGroup(r.group_id ?? "");
            setError(null);
          }}
        >
          <span className="min-w-0 break-all">{r.group_name ?? "未分组"}</span>
          <Pencil className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      }
    >
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !group || group === r.group_id) return;
            setError(null);
            try {
              await submit({ team_ids: [r.team_id], group_id: group });
              close();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label="参赛组别">
            <NativeSelect
              aria-label="参赛组别"
              aria-invalid={!!error}
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setError(null);
              }}
              disabled={busy}
              className="w-full"
            >
              {!r.group_id && (
                <NativeSelectOption value="" disabled>
                  选择组别
                </NativeSelectOption>
              )}
              {groups.map((g) => (
                <NativeSelectOption key={g.id} value={g.id}>
                  {g.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !group || group === r.group_id}
            >
              {busy ? "保存中" : "保存组别"}
            </Button>
          </div>
        </form>
      )}
    </ReviewPopover>
  );
}
