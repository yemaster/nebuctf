import { Link, useParams, useNavigate } from "react-router-dom";
import {
  AdminToolbar,
  EditorHeading,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";
import { useState } from "react";
import { Square, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useAPI } from "@/lib/api";
import type {
  Contest,
  Instance,
  User,
  Audit,
  Submission,
  Announcement,
} from "@/lib/types";
import { date, statusNames } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Field,
  QueryState,
  PageTitle,
  Empty,
  Table,
  Pagination,
} from "@/components/shared";
type AdminNotice = Announcement & {
  contest_id: string | null;
  contest_title?: string | null;
};
export function AnnouncementAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const data = useAPI<{ items: AdminNotice[]; total: number }>(
    `/admin/announcements?${params}`,
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <AdminToolbar
        title="公告"
        createHref={editor("/admin/announcements/new")}
        createLabel="新建公告"
        search={params.get("q") ?? ""}
        onSearch={(v) => filter("q", v)}
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table headers={["公告", "范围", "发布时间", "操作"]}>
        {data.data?.items.map((a) => (
          <TableRow key={a.id} className="relative">
            <TableCell className="font-medium">
              <Link
                className="after:absolute after:inset-0"
                to={editor(`/admin/announcements/${a.id}/edit`)}
              >
                {a.title}
              </Link>
            </TableCell>
            <TableCell>{a.contest_title ?? "全站"}</TableCell>
            <TableCell>{date(a.created_at)}</TableCell>
            <TableCell>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="relative z-10"
              >
                <Link
                  to={editor(`/admin/announcements/${a.id}/edit`)}
                  aria-label={`编辑 ${a.title}`}
                >
                  <Pencil />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>暂无公告</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        hasMore={page * 24 < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
    </>
  );
}
export function AnnouncementEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    back = useEditorReturn("/admin/announcements");
  const data = useAPI<AdminNotice>(`/admin/announcements/${id}`, !!id);
  const save = useAction(
    (body: unknown) =>
      api(
        `/admin/announcements${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        body,
      ),
    () => {
      toast.success("公告已保存");
      navigate(back);
    },
  );
  const contests = useAPI<{ items: Contest[] }>(
    "/admin/contests?page_size=100",
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <EditorHeading
        title={id ? "编辑公告" : "新建公告"}
        back={back}
        form="announcement-form"
        pending={save.isPending}
      />
      {id && (
        <QueryState
          loading={data.isLoading}
          error={data.error}
          retry={() => void data.refetch()}
          fullPage
        />
      )}
      {(!id || data.data) && (
        <form
          id="announcement-form"
          key={id ?? "new"}
          className="grid gap-5 rounded-xl bg-card p-6 lg:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate({
              title: f.get("title"),
              body: f.get("body"),
              contest_id: f.get("contest_id") || null,
            });
          }}
        >
          <Field label="发布范围">
            <NativeSelect
              name="contest_id"
              defaultValue={data.data?.contest_id ?? ""}
            >
              <NativeSelectOption value="">全站公告</NativeSelectOption>
              {contests.data?.items.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.title}
                </NativeSelectOption>
              ))}
              {data.data?.contest_id &&
                !contests.data?.items.some(
                  (c) => c.id === data.data?.contest_id,
                ) && (
                  <NativeSelectOption value={data.data.contest_id}>
                    当前比赛
                  </NativeSelectOption>
                )}
            </NativeSelect>
          </Field>
          <Field label="标题">
            <Input
              name="title"
              defaultValue={data.data?.title}
              required
              maxLength={120}
            />
          </Field>
          <Field label="内容">
            <Textarea
              name="body"
              defaultValue={data.data?.body}
              rows={12}
              required
              maxLength={10000}
            />
          </Field>
          <Button
            type="submit"
            className="justify-self-end"
            disabled={save.isPending}
          >
            保存公告
          </Button>
        </form>
      )}
    </>
  );
}
export function ResourceAdmin() {
  const { page, setPage } = useAdminList();
  const data = useAPI<{
    total: number;
    usage: { instances: number; cpu: number; memory: number };
    limits: { instances: number; cpu: number; memory: number };
    items: Instance[];
  }>(`/admin/resources?page=${page}`, true, 5000);
  const stop = useAction((id: string) => api(`/instances/${id}/stop`, "POST"));
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        {[
          { key: "instances", label: "活跃资源", unit: "" },
          { key: "cpu", label: "CPU 预约", unit: "m" },
          { key: "memory", label: "内存预约", unit: "MiB" },
        ].map((f) => (
          <div className="stat" key={f.key}>
            <p className="text-sm text-muted-foreground">{f.label}</p>
            <p className="mt-3 text-2xl font-semibold">
              {data.data?.usage[f.key as "cpu"] ?? "—"}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {data.data?.limits[f.key as "cpu"] ?? "—"} {f.unit}
              </span>
            </p>
          </div>
        ))}
      </div>
      <Table headers={["题目", "主体", "状态", "到期", "操作"]}>
        {data.data?.items.map((i) => (
          <TableRow key={i.id}>
            <TableCell>
              {i.title}
              {i.scope === "test" && (
                <Badge variant="secondary" className="ml-2">
                  测试
                </Badge>
              )}
            </TableCell>
            <TableCell
              className="text-xs text-muted-foreground"
              title={i.owner_key}
            >
              {i.owner_key.slice(0, 12)}
            </TableCell>
            <TableCell>
              <Badge>{statusNames[i.status]}</Badge>
              {i.error && (
                <p className="mt-2 max-w-48 text-xs text-destructive">
                  {i.error}
                </p>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {date(i.expires_at)}
            </TableCell>
            <TableCell>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  stop.isPending ||
                  ["failed", "stopped", "stopping"].includes(i.status)
                }
                onClick={() => stop.mutate(i.id)}
              >
                <Square />
                回收
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>暂无资源</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        hasMore={page * 24 < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
    </>
  );
}
export function UserAdmin() {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<(User & { disabled: boolean }) | null>(
      null,
    );
  const data = useAPI<{ items: (User & { disabled: boolean })[] }>(
    `/admin/users?page=${page}`,
  );
  const change = useAction(
    () =>
      api(`/admin/users/${selected!.id}/status`, "POST", {
        disabled: !selected!.disabled,
      }),
    () => setSelected(null),
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table headers={["用户", "邮箱", "角色", "状态", "操作"]}>
        {data.data?.items.map((u) => (
          <TableRow key={u.id}>
            <TableCell>{u.username}</TableCell>
            <TableCell>{u.email}</TableCell>
            <TableCell>{u.role === "admin" ? "管理员" : "用户"}</TableCell>
            <TableCell>{u.disabled ? "已禁用" : "正常"}</TableCell>
            <TableCell>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelected(u)}
              >
                {u.disabled ? "启用" : "禁用"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      <Pagination
        page={page}
        setPage={setPage}
        hasMore={(data.data?.items.length ?? 0) === 50}
      />
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="font-semibold">
            {selected?.disabled ? "启用" : "禁用"}用户 {selected?.username}？
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            禁用账号会撤销该用户的所有登录会话。
          </p>
          <Button disabled={change.isPending} onClick={() => change.mutate()}>
            确认
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function LogAdmin({ audit = false }: { audit?: boolean }) {
  const [page, setPage] = useState(1);
  const data = useAPI<{ items: (Audit & Submission)[]; total: number }>(
    `/admin/${audit ? "audit" : "submissions"}?page=${page}`,
  );
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      <PageTitle>{audit ? "审计" : "提交"}</PageTitle>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table
        headers={
          audit
            ? ["操作人", "操作", "目标", "时间"]
            : ["用户", "题目", "结果", "时间"]
        }
      >
        {data.data?.items.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.username}</TableCell>
            <TableCell>
              {audit ? r.action : r.title}
              {!audit && r.contest_practice && (
                <Badge variant="secondary" className="ml-2">
                  赛后练习
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {audit ? r.target : r.correct ? "正确" : "错误"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {date(r.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>暂无记录</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
      />
    </>
  );
}
