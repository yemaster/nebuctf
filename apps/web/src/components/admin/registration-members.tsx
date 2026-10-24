import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { Empty, QueryState, Table } from "../shared";
import { Badge } from "../ui/badge";
import { TableCell, TableRow } from "../ui/table";
import type { Registration } from "./contest-management-shared";

export function RegistrationMembers({
  members,
}: {
  members: Registration["members"];
}) {
  if (!members.length) return <Empty>战队暂无成员</Empty>;
  return (
    <Table headers={["用户", "邮箱", "身份", "账户状态", "注册时间"]}>
      {members.map((member) => (
        <TableRow key={member.id}>
          <TableCell>
            <p className="font-medium">{member.username}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {member.id}
            </p>
          </TableCell>
          <TableCell>{member.email}</TableCell>
          <TableCell>{member.captain ? "队长" : "队员"}</TableCell>
          <TableCell>
            <Badge
              variant="secondary"
              className={
                member.disabled ? "text-destructive" : "text-muted-foreground"
              }
            >
              {member.disabled ? "已禁用" : "正常"}
            </Badge>
          </TableCell>
          <TableCell className="text-muted-foreground">
            {date(member.created_at)}
          </TableCell>
        </TableRow>
      ))}
    </Table>
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
