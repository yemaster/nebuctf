import { UserAvatar } from "../user-avatar";
import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { Empty, QueryState } from "../shared";
import { Badge } from "../ui/badge";
import { Item, ItemGroup } from "../ui/item";
import type { Registration } from "./contest-management-shared";
import { Skeleton } from "../ui/skeleton";

const memberRow =
  "grid min-w-0 grid-cols-1 items-center gap-4 rounded-none border-0 px-0 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6";
const memberColumns =
  "grid min-w-0 gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]";

function MemberField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm">{value || "—"}</dd>
    </div>
  );
}

function ParticipationBadge({
  member,
  registration,
}: {
  member: Registration["members"][number];
  registration: Pick<Registration, "status" | "practice_only">;
}) {
  const status = registration.status;
  const label =
    status === "pending"
      ? "待审核"
      : status === "rejected"
        ? "未通过"
        : status === "suspended"
          ? "已暂停"
          : registration.practice_only && member.current_member
            ? "赛后练习"
            : member.registered
              ? "已参赛"
              : "未参赛";
  return (
    <Badge
      variant="secondary"
      className={
        label === "已参赛" || label === "赛后练习"
          ? "bg-success/10 text-success"
          : status === "suspended" || status === "rejected"
            ? "bg-destructive/10 text-destructive"
            : "text-muted-foreground"
      }
    >
      {label}
    </Badge>
  );
}

export function RegistrationMembers({
  members,
  registration,
}: {
  members: Registration["members"];
  registration: Pick<Registration, "status" | "practice_only">;
}) {
  if (!members.length) return <Empty>战队暂无成员</Empty>;
  return (
    <ItemGroup aria-label="战队成员" className="divide-y whitespace-normal">
      {members.map((member) => (
        <Item role="listitem" key={member.id} className={memberRow}>
          <div className={memberColumns}>
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar
                  name={member.username}
                  avatarId={member.avatar_id}
                  className="size-6"
                />
                <span
                  className="min-w-0 break-all font-medium"
                  title={`用户 ID：${member.id}`}
                >
                  {member.username}
                </span>
                {member.captain && <Badge variant="secondary">队长</Badge>}
              </div>
              <dl>
                <MemberField label="姓名" value={member.real_name} />
              </dl>
            </div>
            <dl className="min-w-0 space-y-2">
              <MemberField label="学号" value={member.student_number} />
              <MemberField label="电话" value={member.phone} />
            </dl>
            <dl className="min-w-0 space-y-2">
              <MemberField label="邮箱" value={member.email} />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <dt>注册于</dt>
                <dd>
                  <time dateTime={member.created_at} className="tabular-nums">
                    {date(member.created_at)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
          <div
            className="flex min-w-28 flex-col items-end gap-2"
            aria-label={`${member.username} 的状态`}
          >
            <div className="flex flex-wrap items-center justify-end gap-2">
              {member.role === "admin" && (
                <Badge variant="secondary">管理员</Badge>
              )}
              {member.current_member === false && (
                <Badge variant="secondary">已离队</Badge>
              )}
              {member.disabled && (
                <Badge
                  variant="secondary"
                  className="bg-destructive/10 text-destructive"
                >
                  已禁用
                </Badge>
              )}
              <ParticipationBadge member={member} registration={registration} />
            </div>
            <span className="text-xs text-muted-foreground">
              {member.email_verified_at ? "邮箱已验证" : "邮箱未验证"}
            </span>
          </div>
        </Item>
      ))}
    </ItemGroup>
  );
}

export function RegistrationMembersPanel({
  apiBase,
  team,
  open,
  count = 1,
}: {
  apiBase: string;
  team: string;
  open: boolean;
  count?: number;
}) {
  const data = useAPI<Registration>(`${apiBase}/registrations/${team}`, open);
  if (!data.data && !data.error)
    return (
      <div aria-label="正在加载战队成员" className="divide-y">
        {Array.from({ length: Math.min(20, Math.max(1, count)) }, (_, i) => (
          <div key={i} className={memberRow}>
            <div className={memberColumns}>
              {[0, 1, 2].map((column) => (
                <div key={column} className="space-y-2">
                  <Skeleton className="h-5 w-28 max-w-full" />
                  <Skeleton className="h-5 w-36 max-w-full" />
                </div>
              ))}
            </div>
            <div className="flex min-w-28 flex-col items-end gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  if (data.error)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
    );
  return data.data ? (
    <RegistrationMembers members={data.data.members} registration={data.data} />
  ) : null;
}
