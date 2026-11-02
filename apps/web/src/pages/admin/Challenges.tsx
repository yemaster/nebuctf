import { can } from "@/lib/access-control";
import { useManagementWrite } from "@/lib/use-management-access";
import { useUser } from "@/App";
import { ArchiveExport } from "@/components/admin/archive-export";
import { useState } from "react";
import { ChallengeForm } from "@/components/admin/challenge-form";
import { ActionError } from "@/components/action-error";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Upload, Play, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import type { Challenge, Contest } from "@/lib/types";
import { questionTypes } from "@/lib/competition";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { QueryState, Empty, Pagination, Table } from "@/components/shared";
import {
  AdminToolbar,
  EditorHeading,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";
import { categories } from "../Challenges";
const pageSize = 10;

function PublicationSwitch({
  challenge,
  refresh,
}: {
  challenge: Challenge;
  refresh: () => Promise<unknown>;
}) {
  const user = useUser();
  const publication = useAction(async (published: boolean) => {
    await api(`/admin/challenges/${challenge.id}/publication`, "POST", {
      published,
      publish_at: null,
    });
    await refresh();
  });
  return (
    <div className="relative z-10 flex h-9 w-14 items-center gap-2">
      <Switch
        checked={
          publication.isPending
            ? (publication.variables ?? challenge.published)
            : challenge.published
        }
        disabled={
          publication.isPending || !can(user, "challenges.write", challenge.id)
        }
        aria-label={`启用 ${challenge.title}`}
        aria-busy={publication.isPending}
        onCheckedChange={(published) => publication.mutate(published)}
      />
      {publication.isPending && (
        <LoaderCircle
          className="size-3.5 text-muted-foreground motion-safe:animate-spin"
          aria-hidden="true"
        />
      )}
      <span className="sr-only" role="status">
        {publication.isPending
          ? "正在保存"
          : challenge.published
            ? "已启用"
            : "未启用"}
      </span>
    </div>
  );
}
export function ChallengeAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const [scope, setScope] = useState("practice");
  const query = new URLSearchParams(params);
  query.set("page_size", String(pageSize));
  const data = useAPI<{ items: Challenge[]; total: number }>(
    `/admin/challenges?${query}`,
    true,
    5000,
  );
  const contests = useAPI<{ items: Contest[] }>(
    "/admin/contests?page_size=100",
  );
  const upload = useAction(
    async (d: { id: string; file: File }) => {
      const body = new FormData();
      body.append("file", d.file);
      return api(`/admin/challenges/${d.id}/attachments`, "POST", body);
    },
    () => toast.success("附件已上传"),
  );
  const start = useAction(
    (id: string) => api(`/challenges/${id}/instances`, "POST", { scope }),
    () => toast.success("公共环境已排队"),
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
        title="题目"
        createHref={editor("/admin/challenges/new")}
        createLabel="新建题目"
        actions={
          <Button asChild variant="outline">
            <Link to={editor("/admin/challenges/import")}>
              <Upload />
              导入
            </Link>
          </Button>
        }
        search={params.get("q") ?? ""}
        onSearch={(value) => filter("q", value)}
      >
        <NativeSelect
          aria-label="题目分类"
          value={params.get("category") ?? ""}
          onChange={(e) => filter("category", e.target.value)}
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="发布状态"
          value={params.get("state") ?? ""}
          onChange={(e) => filter("state", e.target.value)}
        >
          <NativeSelectOption value="">全部状态</NativeSelectOption>
          <NativeSelectOption value="enabled">已启用</NativeSelectOption>
          <NativeSelectOption value="disabled">未启用</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          aria-label="题目范围"
          value={params.get("practice") ?? ""}
          onChange={(e) => filter("practice", e.target.value)}
        >
          <NativeSelectOption value="">全部题目</NativeSelectOption>
          <NativeSelectOption value="true">练习题</NativeSelectOption>
          <NativeSelectOption value="false">比赛题</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          aria-label="公共环境所属赛场"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <NativeSelectOption value="practice">
            练习场公共环境
          </NativeSelectOption>
          {contests.data?.items.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </AdminToolbar>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table
        headers={[
          "题目",
          "分类 / 难度",
          "类型",
          "分值",
          "范围",
          "状态",
          "操作",
        ]}
      >
        {data.data?.items.map((c) => (
          <TableRow key={c.id} className="relative focus-within:bg-muted/50">
            <TableCell className="min-w-40 font-medium">
              <Link
                to={editor(`/admin/challenges/${c.id}/edit`)}
                className="after:absolute after:inset-0"
              >
                {c.title}
              </Link>
              {!!c.parts?.length && (
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {c.parts.length} 个小题
                </span>
              )}
            </TableCell>
            <TableCell>
              {c.category}
              <span className="mt-1 block text-xs text-muted-foreground">
                {c.difficulty}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {questionTypes[c.challenge_type ?? "ctf"]}
            </TableCell>
            <TableCell className="tabular-nums">
              {c.parts?.length
                ? c.parts.reduce((sum, p) => sum + p.initial_points, 0)
                : c.initial_points}
            </TableCell>
            <TableCell className="w-48 max-w-48 whitespace-normal">
              <span
                className="line-clamp-2 break-words text-sm [overflow-wrap:anywhere]"
                title={
                  c.practice
                    ? "练习场"
                    : c.contests?.map((v) => v.title).join("、")
                }
              >
                {c.practice
                  ? "练习场"
                  : c.contests?.length
                    ? c.contests.map((v) => v.title).join("、")
                    : "未关联比赛"}
              </span>
            </TableCell>
            <TableCell>
              <PublicationSwitch challenge={c} refresh={() => data.refetch()} />
            </TableCell>
            <TableCell>
              <div className="relative z-10 flex items-center gap-1">
                <ArchiveExport
                  kind="challenge"
                  id={c.id}
                  title={c.title}
                  icon
                />
                <Button asChild variant="ghost" size="icon">
                  <Link
                    to={editor(`/admin/challenges/${c.id}/edit`)}
                    aria-label={`编辑 ${c.title}`}
                  >
                    <Pencil />
                  </Link>
                </Button>
                <label className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent">
                  <Upload className="size-4" />
                  <input
                    type="file"
                    aria-label={`上传 ${c.title} 的附件`}
                    className="sr-only"
                    disabled={upload.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate({ id: c.id, file });
                      e.target.value = "";
                    }}
                  />
                </label>
                {c.kind === "static_container" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`启动 ${c.title} 公共环境`}
                    disabled={start.isPending}
                    onClick={() => start.mutate(c.id)}
                  >
                    <Play />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的题目</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={pageSize}
        hasMore={page * pageSize < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
    </>
  );
}
export function ChallengeEditor() {
  const write = useManagementWrite();
  const { id } = useParams(),
    navigate = useNavigate(),
    back = useEditorReturn("/admin/challenges");
  const data = useAPI<Challenge>(`/admin/challenges/${id}`, !!id);
  const save = useAction(
    async (body: Record<string, unknown>) => {
      const saved = await api<{ id: string }>(
        `/admin/challenges${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        body,
      );
      if (!id)
        navigate(
          `/admin/challenges/${saved.id}/edit?return=${encodeURIComponent(back)}`,
          { replace: true },
        );
      return saved;
    },
    () => {
      toast.success("题目已保存");
      if (id) navigate(back);
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
        title={
          id
            ? data.data?.title
              ? `编辑题目：${data.data.title}`
              : "编辑题目"
            : "新建题目"
        }
        back={back}
        form="challenge-form"
        actions={
          id &&
          data.data && (
            <ArchiveExport kind="challenge" id={id} title={data.data.title} />
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
        <ChallengeForm
          readOnly={!write}
          key={id ?? "new"}
          challenge={data.data ?? null}
          pending={save.isPending}
          onSave={(body) => save.mutate(body)}
        />
      )}
      {save.error && (
        <div className="mt-4">
          <ActionError error={save.error} />
        </div>
      )}
    </>
  );
}
