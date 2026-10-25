import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useParams,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { ChevronLeft, ChevronRight, FileArchive, FileText } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import { date } from "@/lib/utils";
import {
  type WriteupConfig,
  type WriteupSubmission,
  type WriteupStatus,
  writeupStatuses,
  fileSize,
} from "@/lib/writeups";
import { useBase } from "@/components/admin/contest-management-shared";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
  Table,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TableCell, TableRow } from "@/components/ui/table";
import { DownloadButton } from "@/components/download-button";
import { ResourceError } from "@/components/resource-error";
import { PdfPreview } from "@/components/pdf-preview";
type ListRow = Omit<WriteupSubmission, "name" | "version" | "status"> & {
  name: string | null;
  version: number | null;
  status: WriteupStatus | null;
  team_name: string;
};
function Status({ value }: { value: WriteupStatus | null }) {
  return (
    <Badge
      variant="secondary"
      className={
        value === "accepted"
          ? "text-success"
          : value === "changes_requested"
            ? "text-warning"
            : !value
              ? "text-muted-foreground"
              : ""
      }
    >
      {writeupStatuses[value ?? "missing"]}
    </Badge>
  );
}
export function WriteupsAdmin() {
  const { id, base, apiBase } = useBase(),
    location = useLocation();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const listParams = new URLSearchParams(params);
  listParams.delete("team");
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const data = useAPI<{
    items: ListRow[];
    total: number;
    counts: { status: keyof typeof writeupStatuses; count: number }[];
    groups: { id: string; name: string }[];
    contest: { writeup: WriteupConfig };
  }>(`${apiBase}/writeups?${listParams}`);
  useEffect(() => setSelected([]), [listParams.toString()]);
  function filter(name: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("team");
      next.set("page", "1");
      value ? next.set(name, value) : next.delete(name);
      return next;
    });
  }
  const pick = (team: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("team", team);
        return next;
      },
      { replace: true },
    );
  if (data.isLoading || data.error)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  const items = data.data?.items ?? [],
    submitted = items.filter((r) => !!r.name);
  const team = params.get("team") ?? submitted[0]?.team_id ?? items[0]?.team_id;
  const chosen = items.find((r) => r.team_id === team);
  const exportParams = new URLSearchParams(listParams);
  exportParams.delete("page");
  if (selected.length) exportParams.set("teams", selected.join(","));
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link
                to={`/contests/${id}/manage/settings?section=writeup&return=${encodeURIComponent(location.pathname + location.search)}`}
              >
                提交设置
              </Link>
            </Button>
            <DownloadButton
              href={`/api${apiBase}/writeups/archive?${exportParams}`}
              name="writeups.zip"
              label={
                selected.length
                  ? `导出所选（${selected.length}）`
                  : "导出筛选结果"
              }
              embedded
            />
          </div>
        }
      >
        WriteUp 管理
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {Object.entries(writeupStatuses).map(([status, name]) => (
          <span key={status} className="text-muted-foreground">
            {name}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {data.data?.counts.find((c) => c.status === status)?.count ?? 0}
            </span>
          </span>
        ))}
      </div>
      <div className="grid gap-5 xl:h-[calc(100dvh-16rem)] xl:min-h-[36rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-label="WriteUp 预览"
          className="order-2 flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/60 xl:order-1 xl:min-h-0"
        >
          {!team ? (
            <Empty>选择战队查看 WriteUp</Empty>
          ) : chosen?.name === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
              <FileText className="size-8" />
              <p className="text-sm">{chosen.team_name} 尚未提交 WriteUp</p>
            </div>
          ) : (
            <ReviewPane
              key={team}
              team={team}
              base={base}
              apiBase={apiBase}
              drafts={drafts}
              setDraft={(key, note) =>
                setDrafts((old) => ({ ...old, [key]: note }))
              }
            />
          )}
        </section>
        <aside
          aria-label="WriteUp 战队列表"
          className="order-1 flex min-h-0 flex-col gap-3 xl:order-2"
        >
          <Input
            aria-label="搜索 WriteUp 战队"
            placeholder="搜索战队"
            value={params.get("q") ?? ""}
            onChange={(e) => filter("q", e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="WriteUp 状态"
              value={params.get("status") ?? ""}
              onChange={(e) => filter("status", e.target.value)}
            >
              <NativeSelectOption value="">全部状态</NativeSelectOption>
              {Object.entries(writeupStatuses).map(([s, n]) => (
                <NativeSelectOption value={s} key={s}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {!!data.data?.groups.length && (
              <NativeSelect
                aria-label="WriteUp 组别"
                value={params.get("group") ?? ""}
                onChange={(e) => filter("group", e.target.value)}
              >
                <NativeSelectOption value="">全部组别</NativeSelectOption>
                {data.data.groups.map((g) => (
                  <NativeSelectOption value={g.id} key={g.id}>
                    {g.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              aria-label="选择本页已提交 WriteUp"
              disabled={!submitted.length}
              checked={
                submitted.length > 0 &&
                submitted.every((r) => selected.includes(r.team_id))
              }
              onCheckedChange={(checked) =>
                setSelected(checked ? submitted.map((r) => r.team_id) : [])
              }
            />
            选择本页已提交
          </label>
          <ul className="max-h-96 min-h-0 flex-1 space-y-2 overflow-y-auto p-1 xl:max-h-none">
            {items.map((r) => (
              <li
                key={r.team_id}
                className={`flex items-start gap-2 rounded-lg p-3 transition-colors ${r.team_id === team ? "bg-secondary ring-1 ring-border" : "bg-card hover:bg-accent"}`}
              >
                <Checkbox
                  className="mt-1"
                  aria-label={`选择 ${r.team_name} 的 WriteUp`}
                  disabled={!r.name}
                  checked={selected.includes(r.team_id)}
                  onCheckedChange={(checked) =>
                    setSelected((old) =>
                      checked
                        ? [...old, r.team_id]
                        : old.filter((t) => t !== r.team_id),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`查看 ${r.team_name} 的 WriteUp`}
                  aria-pressed={r.team_id === team}
                  className="min-w-0 flex-1 space-y-2 text-left"
                  onClick={() => pick(r.team_id)}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate font-medium">{r.team_name}</span>
                    <Status value={r.status} />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.group_name ?? "公开组"}
                    {r.registration_status === "suspended" ? " / 已暂停" : ""}
                  </span>
                  {r.name && (
                    <>
                      <span className="block truncate text-xs" title={r.name}>
                        {r.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {r.submitted_by} / {date(r.submitted_at)}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
            {!items.length && (
              <li>
                <Empty>没有符合条件的战队</Empty>
              </li>
            )}
          </ul>
          <nav
            aria-label="WriteUp 战队分页"
            className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
          >
            <span>共 {data.data?.total ?? 0} 支战队</span>
            <div className="flex items-center gap-2">
              <Button
                aria-label="战队上一页"
                size="icon-sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => filter("page", String(page - 1))}
              >
                <ChevronLeft />
              </Button>
              <span className="tabular-nums">
                {page} / {Math.max(1, Math.ceil((data.data?.total ?? 0) / 10))}
              </span>
              <Button
                aria-label="战队下一页"
                size="icon-sm"
                variant="ghost"
                disabled={page * 10 >= (data.data?.total ?? 0)}
                onClick={() => filter("page", String(page + 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </nav>
        </aside>
      </div>
    </>
  );
}
type Detail = WriteupSubmission & {
  history_total: number;
  history: {
    id: string;
    version: number;
    action: WriteupStatus;
    name: string;
    note: string;
    created_at: string;
    username: string;
  }[];
};
export function WriteupAdminDetail() {
  const { team } = useParams(),
    { base } = useBase(),
    [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set("team", team!);
  return <Navigate replace to={`${base}/writeups?${next}`} />;
}
function ReviewPane({
  team,
  base,
  apiBase,
  drafts,
  setDraft,
}: {
  team: string;
  base: string;
  apiBase: string;
  drafts: Record<string, string>;
  setDraft: (key: string, note: string) => void;
}) {
  const [page, setPage] = useState(1);
  const path = `${apiBase}/writeups/${team}?page=${page}`;
  const data = useQuery({
    queryKey: [path],
    queryFn: () => api<Detail>(path),
    placeholderData: keepPreviousData,
  });
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  if (!data.data) return null;
  const value = data.data,
    key = `${team}:${value.version}`;
  return (
    <ReviewWriteup
      key={key}
      data={value}
      base={base}
      apiBase={apiBase}
      page={page}
      setPage={setPage}
      note={drafts[key] ?? value.review_note}
      setNote={(note) => setDraft(key, note)}
      refresh={() => void data.refetch()}
      historyLoading={data.isPlaceholderData}
    />
  );
}
function ReviewWriteup({
  data,
  base,
  apiBase,
  page,
  setPage,
  note,
  setNote,
  refresh,
  historyLoading,
}: {
  data: Detail;
  base: string;
  apiBase: string;
  page: number;
  setPage: (n: number) => void;
  note: string;
  setNote: (value: string) => void;
  refresh: () => void;
  historyLoading: boolean;
}) {
  const review = useAction(
    (status: "accepted" | "changes_requested") =>
      api(`${apiBase}/writeups/${data.team_id}`, "PUT", {
        status,
        note,
        version: data.version,
      }),
    () => toast.success("处理结果已保存"),
    false,
  );
  const url = `/api${apiBase}/writeups/${data.team_id}/file?version=${data.version}`;
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="truncate font-semibold">
              <Link
                to={`${base}/teams/${data.team_id}`}
                className="hover:underline"
              >
                {data.team_name}
              </Link>
            </h2>
            <Status value={data.status} />
          </div>
          <p
            className="truncate text-xs text-muted-foreground"
            title={data.name}
          >
            {data.name} / {fileSize(data.size)} / 版本 {data.version}
          </p>
        </div>
        <DownloadButton
          href={url}
          name={data.name}
          label="下载 WriteUp"
          embedded
        />
      </header>
      <div
        className="h-[60dvh] min-h-80 flex-1 overflow-hidden xl:h-auto xl:min-h-0"
        aria-label="文件预览"
      >
        {data.format === "pdf" ? (
          <PdfPreview url={url} onRetry={refresh} />
        ) : (
          <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileArchive className="size-8" />
            <p className="text-sm">ZIP 文件请下载查看</p>
          </div>
        )}
      </div>
      <div className="max-h-[45dvh] shrink-0 overflow-y-auto border-t p-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const button = (e.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            review.mutate(
              button?.value === "changes_requested"
                ? "changes_requested"
                : "accepted",
            );
          }}
        >
          <Field label="处理意见">
            <Textarea
              aria-label="WriteUp 处理意见"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={review.isPending}
            />
          </Field>
          {review.error && <ResourceError error={review.error} />}
          <div className="flex gap-2">
            <Button disabled={review.isPending} type="submit" value="accepted">
              确认收到
            </Button>
            <Button
              disabled={review.isPending || !note.trim()}
              type="submit"
              value="changes_requested"
              variant="secondary"
            >
              退回修改
            </Button>
          </div>
        </form>
        <Accordion type="single" collapsible className="mt-2">
          <AccordionItem value="history" className="border-0">
            <AccordionTrigger className="py-3 text-sm">
              提交与处理记录（{data.history_total}）
            </AccordionTrigger>
            <AccordionContent>
              <Table headers={["操作人", "版本", "操作", "说明", "时间"]}>
                {data.history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.username}</TableCell>
                    <TableCell>{r.version}</TableCell>
                    <TableCell>
                      {r.action === "submitted"
                        ? "提交文件"
                        : writeupStatuses[r.action]}
                    </TableCell>
                    <TableCell className="max-w-xl whitespace-pre-wrap break-words">
                      {r.note || r.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {date(r.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
              <Pagination
                disabled={historyLoading}
                page={page}
                setPage={setPage}
                pageSize={10}
                total={data.history_total}
                hasMore={page * 10 < data.history_total}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );
}
