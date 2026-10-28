import { DetailLink } from "@/components/detail-link";
import { useState } from "react";
import {
  Link,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, ArrowUp, ArrowDown, Pencil, X } from "lucide-react";
import { api, useAction, useAPI } from "@/lib/api";
import type { Challenge, ProblemSet } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { TableRow, TableCell } from "@/components/ui/table";
import { Table } from "@/components/shared";
import { ChallengePicker } from "@/components/challenge-picker";
import {
  AdminToolbar,
  EditorHeading,
  PublicationBadge,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
} from "@/components/shared";
import { ChallengeCatalog } from "@/components/challenge-catalog";
import { useUser } from "@/App";

export function ProblemSets() {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [q, setQ] = useState("");
  const data = useAPI<{ items: ProblemSet[]; total: number }>(
    `/problemsets?page=${page}&q=${encodeURIComponent(q)}`,
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
      <PageTitle
        action={
          <Button variant="ghost" asChild>
            <Link to="/challenges">题库</Link>
          </Button>
        }
      >
        题单
      </PageTitle>
      <form
        className="mb-8 flex max-w-md gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search);
          setPage(1);
        }}
      >
        <Input
          aria-label="搜索题单"
          placeholder="搜索题单"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="secondary">搜索</Button>
      </form>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <div className="grid gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
        {data.data?.items.map((s) => (
          <DetailLink
            key={s.id}
            destination={{ kind: "problemset", id: s.id }}
            className="group block space-y-5 rounded-lg bg-card p-7 transition-colors hover:bg-accent"
          >
            <h2 className="text-xl font-semibold">{s.title}</h2>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{s.total} 题</span>
              <span>
                {s.completed} / {s.total}
              </span>
            </div>
            <Progress
              value={s.total ? (s.completed / s.total) * 100 : 0}
              aria-label={`${s.title} 完成进度`}
            />
          </DetailLink>
        ))}
      </div>
      {data.data?.items.length === 0 && <Empty>暂无题单</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={24}
        hasMore={page * 24 < (data.data?.total ?? 0)}
      />
    </>
  );
}
export function ProblemSetDetail() {
  const { id } = useParams(),
    [params, setParams] = useSearchParams(),
    user = useUser();
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const setPage = (value: number) => setParams({ page: String(value) });
  const data = useAPI<ProblemSet & { items: Challenge[] }>(
      `/problemsets/${id}?page=${page}&page_size=10`,
    ),
    s = data.data;
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
      <Button variant="ghost" asChild className="mb-6">
        <Link to="/problemsets">
          <ArrowLeft />
          全部题单
        </Link>
      </Button>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {s && (
        <div data-card-detail={`/problemsets/${id}`}>
          <PageTitle
            action={
              <span className="text-sm text-muted-foreground">
                {s.completed} / {s.total} 已完成
              </span>
            }
          >
            {s.title}
          </PageTitle>
          {s.description && (
            <p className="mb-8 max-w-4xl whitespace-pre-wrap leading-7 text-muted-foreground">
              {s.description}
            </p>
          )}
          {user && (
            <Progress
              className="mb-8"
              value={s.total ? (s.completed / s.total) * 100 : 0}
              aria-label="题单进度"
            />
          )}
          <ChallengeCatalog
            items={s.items}
            getHref={(challenge) =>
              `/challenges?${new URLSearchParams({ problemset: id!, challenge, page: String(page) })}`
            }
          />
          {!s.items.length && <Empty>暂无可用题目</Empty>}
          <Pagination
            page={page}
            setPage={setPage}
            total={s.total}
            pageSize={10}
            alwaysShow
            hasMore={page * 10 < s.total}
          />
        </div>
      )}
    </>
  );
}
export function ProblemSetAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const data = useAPI<{ items: ProblemSet[]; total: number }>(
    `/admin/problemsets?${params}`,
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
        title="题单"
        createHref={editor("/admin/problemsets/new")}
        createLabel="新建题单"
        search={params.get("q") ?? ""}
        onSearch={(v) => filter("q", v)}
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table headers={["题单", "题目数", "状态", "操作"]}>
        {data.data?.items.map((s) => (
          <TableRow key={s.id} className="relative">
            <TableCell className="font-medium">
              <Link
                to={editor(`/admin/problemsets/${s.id}/edit`)}
                className="after:absolute after:inset-0"
              >
                {s.title}
              </Link>
            </TableCell>
            <TableCell>{s.challenges.length} 题</TableCell>
            <TableCell>
              <PublicationBadge published={s.published} />
            </TableCell>
            <TableCell>
              <Button
                asChild
                size="icon"
                variant="ghost"
                className="relative z-10"
              >
                <Link
                  to={editor(`/admin/problemsets/${s.id}/edit`)}
                  aria-label={`编辑 ${s.title}`}
                >
                  <Pencil />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的题单</Empty>}
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
export function ProblemSetEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    back = useEditorReturn("/admin/problemsets");
  const data = useAPI<ProblemSet>(`/admin/problemsets/${id}`, !!id);
  const save = useAction(
    (body: unknown) =>
      api(`/admin/problemsets${id ? `/${id}` : ""}`, id ? "PUT" : "POST", body),
    () => navigate(back),
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
        title={id ? "编辑题单" : "新建题单"}
        back={back}
        form="problemset-form"
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
        <ProblemSetForm
          key={id ?? "new"}
          initial={data.data ?? null}
          save={(body) => save.mutate(body)}
          pending={save.isPending}
        />
      )}
    </>
  );
}
function ProblemSetForm({
  initial,
  save,
  pending,
}: {
  initial: ProblemSet | null;
  save: (body: unknown) => void;
  pending: boolean;
}) {
  const [items, setItems] = useState(initial?.challenges ?? []),
    [requestedPage, setPage] = useState(1);
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(items.length / 12)),
  );
  function move(i: number, step: number) {
    const copy = [...items];
    [copy[i], copy[i + step]] = [copy[i + step]!, copy[i]!];
    setItems(copy);
    setPage(Math.floor((i + step) / 12) + 1);
  }
  return (
    <form
      id="problemset-form"
      className="space-y-6 rounded-xl bg-card p-6 lg:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          title: f.get("title"),
          description: f.get("description"),
          published: f.has("published"),
          challenge_ids: items.map((c) => c.id),
        });
      }}
    >
      <Field label="题单名称">
        <Input
          name="title"
          defaultValue={initial?.title}
          required
          maxLength={120}
        />
      </Field>
      <Field label="题单说明（可选）">
        <Textarea
          name="description"
          defaultValue={initial?.description}
          maxLength={4000}
        />
      </Field>
      <section className="space-y-3">
        <h3 className="text-sm font-medium">题目顺序 ({items.length}/500)</h3>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {items.slice((page - 1) * 12, page * 12).map((c, offset) => {
            const i = (page - 1) * 12 + offset;
            return (
              <div className="flex items-center gap-2" key={c.id}>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {i + 1}. {c.title}
                </span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`上移 ${c.title}`}
                  disabled={!i}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`下移 ${c.title}`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`移除 ${c.title}`}
                  onClick={() => setItems(items.filter((v) => v.id !== c.id))}
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
        <Pagination
          page={page}
          setPage={setPage}
          total={items.length}
          pageSize={12}
          hasMore={page * 12 < items.length}
          alwaysShow
        />
      </section>
      <ChallengePicker
        practice={true}
        value={items.map((c) => c.id)}
        onChange={(ids) =>
          setItems((previous) =>
            ids.map(
              (id) =>
                previous.find((c) => c.id === id) ?? { id, title: "题目" },
            ),
          )
        }
        onPick={(challenge) =>
          setItems((previous) =>
            previous.map((c) =>
              c.id === challenge.id ? { id: c.id, title: challenge.title } : c,
            ),
          )
        }
      />
      <label className="flex items-center gap-2 text-sm">
        <Switch name="published" defaultChecked={initial?.published} />
        发布题单
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "保存中" : "保存题单"}
      </Button>
    </form>
  );
}
