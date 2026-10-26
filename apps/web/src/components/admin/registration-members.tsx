import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { Empty, QueryState } from "../shared";
import { Badge } from "../ui/badge";
import { Item, ItemGroup } from "../ui/item";
import type { Registration } from "./contest-management-shared";

export function RegistrationMembers({
  members,
}: {
  members: Registration["members"];
}) {
  if (!members.length) return <Empty>战队暂无成员</Empty>;
  return (
    <ItemGroup aria-label="战队成员" className="divide-y whitespace-normal">
      {members.map((member) => (
        <Item
          role="listitem"
          key={member.id}
          className="grid min-w-0 grid-cols-1 gap-2 rounded-none border-0 px-0 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:gap-4"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className="break-all font-medium"
              title={`用户 ID：${member.id}`}
            >
              {member.username}
            </span>
            {member.captain && <Badge variant="secondary">队长</Badge>}
            {member.disabled && (
              <Badge
                variant="secondary"
                className="bg-destructive/10 text-destructive"
              >
                已禁用
              </Badge>
            )}
          </div>
          <span className="min-w-0 break-all text-muted-foreground">
            {member.email}
          </span>
          <time
            dateTime={member.created_at}
            className="text-xs tabular-nums text-muted-foreground"
          >
            注册于 {date(member.created_at)}
          </time>
        </Item>
      ))}
    </ItemGroup>
  );
}

export function RegistrationMembersPanel({
  apiBase,
  team,
  open,
}: {
  apiBase: string;
  team: string;
  open: boolean;
}) {
  const data = useAPI<Registration>(`${apiBase}/registrations/${team}`, open);
  if (data.isLoading || data.error)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
    );
  return data.data ? <RegistrationMembers members={data.data.members} /> : null;
}
