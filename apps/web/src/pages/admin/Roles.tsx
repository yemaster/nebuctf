import { useQuery } from "@tanstack/react-query";
import { ConfirmAction } from "@/components/confirm-action";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/App";
import { api, useAPI, useAction } from "@/lib/api";
import { useDraft } from "@/lib/use-draft";
import type { AccessProfile } from "@/lib/access-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Field,
  PageTitle,
  Table,
  Pagination,
  QueryState,
  Empty,
} from "@/components/shared";
import { EditorHeading, useAdminList } from "@/components/admin/shared";
import { ConfigCard } from "@/components/admin/config-card";
import { StatusPage } from "@/components/status-page";

type Role = { id: string; name: string; permissions: string[]; users: number };
type Catalog = {
  items: Role[];
  total: number;
  groups: [string, string][];
  keys: string[];
};
export function Roles() {
  const user = useUser(),
    { page, setPage } = useAdminList();
  const [removing, setRemoving] = useState<Role | null>(null);
  const remove = useAction(
    () => api(`/admin/roles/${removing!.id}`, "DELETE"),
    () => {
      setRemoving(null);
      toast.success("角色已删除");
    },
  );
  const query = useAPI<Catalog>(
    `/admin/roles?page=${page}`,
    user?.role === "admin",
  );
  if (user?.role !== "admin") return <StatusPage status={403} />;
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return (
    <>
      <PageTitle
        action={
          <Button asChild>
            <Link to="/admin/roles/new">
              <Plus />
              新建角色
            </Link>
          </Button>
        }
      >
        角色与权限
      </PageTitle>
      <Table headers={["角色", "权限", "用户", "操作"]}>
        <TableRow>
          <TableCell>
            超级管理员 <Badge variant="secondary">内置</Badge>
          </TableCell>
          <TableCell>全部权限</TableCell>
          <TableCell>—</TableCell>
          <TableCell />
        </TableRow>
        <TableRow>
          <TableCell>
            普通用户 <Badge variant="secondary">内置</Badge>
          </TableCell>
          <TableCell>参赛与学习</TableCell>
          <TableCell>—</TableCell>
          <TableCell />
        </TableRow>
        {query.data.items.map((role) => (
          <TableRow key={role.id}>
            <TableCell className="font-medium">{role.name}</TableCell>
            <TableCell>{role.permissions.length} 项</TableCell>
            <TableCell>{role.users}</TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="icon">
                <Link
                  to={`/admin/roles/${role.id}/edit`}
                  aria-label={`编辑 ${role.name}`}
                >
                  <Pencil />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`删除 ${role.name}`}
                onClick={() => setRemoving(role)}
              >
                <Trash2 />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      <Pagination
        page={page}
        setPage={setPage}
        pageSize={10}
        total={query.data.total}
        hasMore={page * 10 < query.data.total}
      />
      <ConfirmAction
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`删除角色 ${removing?.name ?? ""}？`}
        description={`将撤销 ${removing?.users ?? 0} 名用户通过该角色获得的权限。`}
        confirm="删除"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
export function RoleEditor() {
  const { id } = useParams(),
    user = useUser(),
    query = useAPI<Catalog & Role>(
      id ? `/admin/roles/${id}` : "/admin/roles",
      user?.role === "admin",
    );
  if (user?.role !== "admin") return <StatusPage status={403} />;
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return <RoleForm key={id ?? "new"} id={id} data={query.data} />;
}
function RoleForm({ id, data }: { id?: string; data: Catalog & Role }) {
  const user = useUser(),
    navigate = useNavigate();
  const [value, setValue, clear] = useDraft(`role:${user?.id}:${id ?? "new"}`, {
    name: data.name ?? "",
    permissions: data.permissions ?? [],
  });
  const save = useAction(
    () => api(`/admin/roles${id ? `/${id}` : ""}`, id ? "PUT" : "POST", value),
    () => {
      clear();
      toast.success("角色已保存");
      navigate("/admin/roles");
    },
  );
  return (
    <>
      <EditorHeading
        title={id ? `编辑角色 ${data.name}` : "新建角色"}
        back="/admin/roles"
        form="role-form"
        pending={save.isPending}
      />
      <form
        id="role-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5"
      >
        <ConfigCard>
          <Field label="角色名称">
            <Input
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
              required
              maxLength={48}
              className="max-w-md"
            />
          </Field>
        </ConfigCard>
        <Table headers={["功能", "查看", "管理"]}>
          {data.groups.map(([key, label]) => (
            <TableRow key={key}>
              <TableCell className="font-medium">{label}</TableCell>
              {["read", "write"].map((action) => (
                <TableCell key={action}>
                  {data.keys.includes(`${key}.${action}`) ? (
                    <Switch
                      aria-label={`${label}${action === "read" ? "查看" : "管理"}`}
                      checked={
                        value.permissions.includes(`${key}.${action}`) ||
                        (action === "read" &&
                          value.permissions.includes(`${key}.write`))
                      }
                      disabled={
                        action === "read" &&
                        value.permissions.includes(`${key}.write`)
                      }
                      onCheckedChange={(checked) =>
                        setValue({
                          ...value,
                          permissions: checked
                            ? [...value.permissions, `${key}.${action}`]
                            : value.permissions.filter(
                                (p) => p !== `${key}.${action}`,
                              ),
                        })
                      }
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </Table>
      </form>
    </>
  );
}
type Grant = AccessProfile["grants"][number] & { title: string };
type AccessUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  access: AccessProfile;
  grants: Grant[];
};
export function UserAccessEditor() {
  const [roleSearch, setRoleSearch] = useState("");
  const { id } = useParams(),
    user = useUser(),
    query = useAPI<AccessUser>(
      `/admin/users/${id}/access`,
      user?.role === "admin",
    ),
    roles = useQuery({
      queryKey: ["/admin/roles", roleSearch],
      queryFn: ({ signal }) =>
        api<Catalog>(
          `/admin/roles?page_size=100&q=${encodeURIComponent(roleSearch)}`,
          "GET",
          undefined,
          signal,
        ),
      enabled: user?.role === "admin",
      placeholderData: (previous) => previous,
    });
  if (user?.role !== "admin") return <StatusPage status={403} />;
  if (!query.data || !roles.data || query.error || roles.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading || roles.isLoading}
        error={query.error ?? roles.error}
        retry={() => {
          void query.refetch();
          void roles.refetch();
        }}
      />
    );
  return (
    <AccessForm
      key={id}
      user={query.data}
      catalog={roles.data.items}
      roleSearch={roleSearch}
      onRoleSearch={setRoleSearch}
    />
  );
}
function AccessForm({
  user,
  catalog,
  roleSearch,
  onRoleSearch,
}: {
  user: AccessUser;
  catalog: Role[];
  roleSearch: string;
  onRoleSearch: (value: string) => void;
}) {
  const actor = useUser(),
    navigate = useNavigate();
  const [value, setValue, clear] = useDraft(
    `user-access:${actor?.id}:${user.id}`,
    {
      role: user.role,
      roles: user.access.roles.map((role) => role.id),
      grants: user.grants,
    },
  );
  const [kind, setKind] = useState<"challenge" | "contest">("challenge"),
    [search, setSearch] = useState("");
  const targets = useAPI<{ items: { id: string; title: string }[] }>(
    `/admin/${kind === "challenge" ? "challenges" : "contests"}?page_size=10&q=${encodeURIComponent(search)}`,
  );
  const save = useAction(
    () => api(`/admin/users/${user.id}/access`, "PUT", value),
    () => {
      clear();
      toast.success("权限已保存");
      navigate("/admin/users");
    },
  );
  const updateGrant = (index: number, permissions: string[]) =>
    setValue({
      ...value,
      grants: value.grants.map((g, i) =>
        i === index ? { ...g, permissions } : g,
      ),
    });
  return (
    <>
      <EditorHeading
        title={`用户权限 ${user.username}`}
        back="/admin/users"
        form="access-form"
        pending={save.isPending}
      />
      <form
        id="access-form"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ConfigCard>
          <Field label="基础角色">
            <NativeSelect
              value={value.role}
              onChange={(e) =>
                setValue({ ...value, role: e.target.value as "admin" | "user" })
              }
            >
              <NativeSelectOption value="user">普通用户</NativeSelectOption>
              <NativeSelectOption value="admin">超级管理员</NativeSelectOption>
            </NativeSelect>
          </Field>
        </ConfigCard>
        {value.role === "user" && (
          <>
            <ConfigCard>
              <div className="mb-4 flex items-center gap-4">
                <h2 className="font-medium">附加角色</h2>
                <Badge variant="secondary">已选 {value.roles.length}</Badge>
                <Input
                  aria-label="搜索角色"
                  placeholder="搜索角色"
                  className="ml-auto max-w-xs"
                  value={roleSearch}
                  onChange={(e) => onRoleSearch(e.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-center gap-3 text-sm"
                  >
                    <Switch
                      checked={value.roles.includes(role.id)}
                      onCheckedChange={(checked) =>
                        setValue({
                          ...value,
                          roles: checked
                            ? [...value.roles, role.id]
                            : value.roles.filter((id) => id !== role.id),
                        })
                      }
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
              {!catalog.length && (
                <Link className="text-sm text-primary" to="/admin/roles/new">
                  创建角色
                </Link>
              )}
            </ConfigCard>
            <ConfigCard>
              <h2 className="mb-4 font-medium">指定题目与比赛</h2>
              <div className="mb-4 flex items-center gap-2">
                <NativeSelect
                  aria-label="授权对象类型"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    setSearch("");
                  }}
                >
                  <NativeSelectOption value="challenge">
                    题目
                  </NativeSelectOption>
                  <NativeSelectOption value="contest">比赛</NativeSelectOption>
                </NativeSelect>
                <Input
                  aria-label="搜索授权对象"
                  placeholder="搜索名称"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              <QueryState
                loading={targets.isLoading}
                error={targets.error}
                retry={() => void targets.refetch()}
              />
              <div className="mb-5 flex flex-wrap gap-2">
                {targets.data?.items.map((target) => (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    key={target.id}
                    disabled={value.grants.some(
                      (g) => g.id === target.id && g.kind === kind,
                    )}
                    onClick={() =>
                      setValue({
                        ...value,
                        grants: [
                          ...value.grants,
                          {
                            ...target,
                            kind,
                            permissions: [
                              kind === "challenge"
                                ? "challenges.read"
                                : "contests.read",
                            ],
                          },
                        ],
                      })
                    }
                  >
                    <Plus />
                    {target.title}
                  </Button>
                ))}
              </div>
              <Table headers={["对象", "权限", "流量", "操作"]}>
                {value.grants.map((grant, index) => {
                  const area =
                    grant.kind === "challenge" ? "challenges" : "contests";
                  return (
                    <TableRow key={`${grant.kind}:${grant.id}`}>
                      <TableCell>
                        <Badge variant="secondary" className="mr-2">
                          {grant.kind === "challenge" ? "题目" : "比赛"}
                        </Badge>
                        {grant.title}
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          aria-label={`${grant.title}权限`}
                          value={
                            grant.permissions.includes(`${area}.write`)
                              ? "write"
                              : "read"
                          }
                          onChange={(e) =>
                            updateGrant(index, [
                              ...grant.permissions.filter(
                                (p) => !p.startsWith(area),
                              ),
                              `${area}.${e.target.value}`,
                            ])
                          }
                        >
                          <NativeSelectOption value="read">
                            查看
                          </NativeSelectOption>
                          <NativeSelectOption value="write">
                            管理
                          </NativeSelectOption>
                        </NativeSelect>
                      </TableCell>
                      <TableCell>
                        {grant.kind === "contest" ? (
                          <NativeSelect
                            aria-label={`${grant.title}流量权限`}
                            value={
                              grant.permissions.includes("traffic.write")
                                ? "write"
                                : grant.permissions.includes("traffic.read")
                                  ? "read"
                                  : "none"
                            }
                            onChange={(e) =>
                              updateGrant(index, [
                                ...grant.permissions.filter(
                                  (p) => !p.startsWith("traffic."),
                                ),
                                ...(e.target.value === "none"
                                  ? []
                                  : [`traffic.${e.target.value}`]),
                              ])
                            }
                          >
                            <NativeSelectOption value="none">
                              不授权
                            </NativeSelectOption>
                            <NativeSelectOption value="read">
                              查看与下载
                            </NativeSelectOption>
                            <NativeSelectOption value="write">
                              管理采集
                            </NativeSelectOption>
                          </NativeSelect>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`移除 ${grant.title}授权`}
                          onClick={() =>
                            setValue({
                              ...value,
                              grants: value.grants.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Table>
              {!value.grants.length && <Empty>未添加单独授权</Empty>}
            </ConfigCard>
          </>
        )}
      </form>
    </>
  );
}
