import { ArchiveExport } from "@/components/admin/archive-export";
import { ContestForm } from "@/components/admin/contest-form";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { Pencil, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useAPI } from "@/lib/api";
import type { Contest } from "@/lib/types";
import { date } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import { Empty, QueryState, Pagination, Table } from "@/components/shared";
import { ContestStatusBadge } from "@/components/contest-status-badge";
import {
  AdminToolbar,
  EditorHeading,
  PublicationBadge,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";

export function ContestAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const data = useAPI<{ items: Contest[]; total: number }>(
    `/admin/contests?${params}`,
  );
  const poster = useAction(
    async ({ id, file }: { id: string; file: File }) => {
      const body = new FormData();
      body.set("file", file);
      return api(`/admin/contests/${id}/poster`, "POST", body);
    },
    () => toast.success("海报已更新"),
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
        title="比赛"
        createHref={editor("/admin/contests/new")}
        createLabel="新建比赛"
        actions={
          <Button asChild variant="outline">
            <Link to={editor("/admin/contests/import")}>
              <Upload />
              导入
            </Link>
          </Button>
        }
        search={params.get("q") ?? ""}
        onSearch={(v) => filter("q", v)}
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table
        headers={[
          "比赛",
          "开始 / 结束",
          "赛题",
          "战队 / 人数上限",
          "访问 / 参赛范围",
          "状态",
          "封榜时间",
          "操作",
        ]}
      >
        {data.data?.items.map((c) => (
          <TableRow key={c.id} className="relative focus-within:bg-muted/50">
            <TableCell className="min-w-44 font-medium">
              <Link
                to={editor(`/admin/contests/${c.id}/edit`)}
                className="after:absolute after:inset-0"
              >
                {c.title}
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              <time dateTime={c.starts_at}>{date(c.starts_at)}</time>
              <br />
              <time dateTime={c.ends_at} className="text-muted-foreground">
                {date(c.ends_at)}
              </time>
            </TableCell>
            <TableCell>{c.challenge_ids.length} 题</TableCell>
            <TableCell className="whitespace-nowrap">
              {c.teams} 支 / 每队 {c.team_limit} 人
            </TableCell>
            <TableCell className="text-xs">
              <p>{c.visibility === "private" ? "私密" : "公开"}</p>
              <p className="mt-1 text-muted-foreground">
                {c.registration_mode === "teams"
                  ? `指定 ${c.registration_team_ids?.length ?? 0} 支战队`
                  : c.registration_mode === "invite"
                    ? "邀请码"
                    : "不限"}
              </p>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <PublicationBadge published={c.published} />
                <ContestStatusBadge contest={c} />
              </div>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {date(c.freeze_at)}
            </TableCell>
            <TableCell>
              <div className="relative z-10 flex gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="relative z-10"
                >
                  <Link
                    to={`/admin/contests/${c.id}/manage/teams`}
                    aria-label={`管理 ${c.title} 报名战队`}
                  >
                    <Users />
                  </Link>
                </Button>
                <ArchiveExport kind="contest" id={c.id} title={c.title} icon />
                <Button asChild variant="ghost" size="icon">
                  <Link
                    to={editor(`/admin/contests/${c.id}/edit`)}
                    aria-label={`编辑 ${c.title}`}
                  >
                    <Pencil />
                  </Link>
                </Button>
                <label className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent">
                  <Upload className="size-4" />
                  <input
                    type="file"
                    className="sr-only"
                    aria-label={`上传 ${c.title} 海报`}
                    accept="image/png,image/jpeg,image/webp"
                    disabled={poster.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) poster.mutate({ id: c.id, file });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的比赛</Empty>}
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
export function ContestEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    back = useEditorReturn(
      location.pathname.startsWith("/contests/")
        ? `/contests/${id}/manage/teams`
        : "/admin/contests",
      id,
    );
  const data = useAPI<Contest>(`/admin/contests/${id}`, !!id);
  const save = useAction(
    async (body: Record<string, unknown>) => {
      const result = await api<{ id: string }>(
        `/admin/contests${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        body,
      );
      if (!id)
        navigate(
          `/admin/contests/${result.id}/edit?return=${encodeURIComponent(back)}`,
          { replace: true },
        );
      else await data.refetch();
    },
    () => {
      toast.success("比赛已保存");
    },
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
        title={id ? "编辑比赛" : "新建比赛"}
        back={back}
        backLabel={back.startsWith("/contests/") ? "返回比赛" : "返回列表"}
        form="contest-form"
        actions={
          id &&
          data.data && (
            <ArchiveExport kind="contest" id={id} title={data.data.title} />
          )
        }
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
        <ContestForm
          key={id ?? "new"}
          contest={data.data ?? null}
          pending={save.isPending}
          save={(body) => save.mutate(body)}
        />
      )}
    </>
  );
}
