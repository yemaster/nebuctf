import { lazy, useState, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useAPI } from "@/lib/api";
import type { Article, LearningTree } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Field,
  Empty,
  QueryState,
  Table,
  Pagination,
  Loading,
} from "@/components/shared";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  AdminToolbar,
  EditorHeading,
  PublicationBadge,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";
const TreeForm = lazy(() =>
  import("@/components/learning-tree-editor").then((m) => ({
    default: m.LearningTreeEditor,
  })),
);
export function ArticleAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const data = useAPI<{ items: Article[]; total: number }>(
    `/admin/articles?${params}`,
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
        title="文档"
        createHref={editor("/admin/articles/new")}
        createLabel="新建文档"
        search={params.get("q") ?? ""}
        onSearch={(v) => filter("q", v)}
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table headers={["文档", "分类", "类型", "状态", "操作"]}>
        {data.data?.items.map((a) => (
          <TableRow key={a.id} className="relative">
            <TableCell className="font-medium">
              <Link
                to={editor(`/admin/articles/${a.id}/edit`)}
                className="after:absolute after:inset-0"
              >
                {a.title}
              </Link>
            </TableCell>
            <TableCell>{a.category}</TableCell>
            <TableCell>{a.kind === "tutorial" ? "教程" : "文档"}</TableCell>
            <TableCell>
              <PublicationBadge published={a.published} />
            </TableCell>
            <TableCell>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="relative z-10"
              >
                <Link
                  to={editor(`/admin/articles/${a.id}/edit`)}
                  aria-label={`编辑 ${a.title}`}
                >
                  <Pencil />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的文档</Empty>}
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
export function ArticleEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    back = useEditorReturn("/admin/articles");
  const data = useAPI<Article>(`/admin/articles/${id}`, !!id);
  const save = useAction(
    (body: Record<string, unknown>) =>
      api(`/admin/articles${id ? `/${id}` : ""}`, id ? "PUT" : "POST", body),
    () => {
      toast.success("文档已保存");
      navigate(back);
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
        title={id ? "编辑文档" : "新建文档"}
        back={back}
        form="article-form"
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
        <ArticleForm
          key={id ?? "new"}
          article={data.data ?? null}
          save={(body) => save.mutate(body)}
          pending={save.isPending}
        />
      )}
    </>
  );
}
function ArticleForm({
  article: a,
  save,
  pending,
}: {
  article: Article | null;
  save: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [body, setBody] = useState(a?.body ?? "");
  return (
    <form
      id="article-form"
      className="space-y-6 rounded-xl bg-card p-6 lg:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          title: f.get("title"),
          slug: f.get("slug"),
          category: f.get("category"),
          kind: f.get("kind"),
          body,
          published: f.has("published"),
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="标题">
          <Input
            name="title"
            defaultValue={a?.title}
            maxLength={160}
            required
          />
        </Field>
        <Field label="路径标识">
          <Input
            name="slug"
            defaultValue={a?.slug}
            maxLength={80}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
        </Field>
        <Field label="分类">
          <Input
            name="category"
            defaultValue={a?.category ?? "入门"}
            maxLength={40}
            required
          />
        </Field>
        <Field label="类型">
          <NativeSelect name="kind" defaultValue={a?.kind ?? "document"}>
            <NativeSelectOption value="document">文档</NativeSelectOption>
            <NativeSelectOption value="tutorial">教程</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Markdown 正文</h2>
        <MarkdownEditor
          id="article-body"
          name="body"
          label="知识库文章正文"
          value={body}
          onChange={setBody}
          maxLength={200000}
        />
      </section>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Switch name="published" defaultChecked={a?.published} />
          启用文档
        </label>
        <Button disabled={pending}>保存文档</Button>
      </div>
    </form>
  );
}
export function TreeAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    editor = useEditorLink();
  const data = useAPI<{ items: LearningTree[]; total: number }>(
    `/admin/learning/trees?${params}`,
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
        title="技能树"
        createHref={editor("/admin/learning/new")}
        createLabel="新建技能树"
        search={params.get("q") ?? ""}
        onSearch={(v) => filter("q", v)}
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <Table headers={["技能树", "节点", "状态", "操作"]}>
        {data.data?.items.map((t) => (
          <TableRow key={t.id} className="relative">
            <TableCell className="font-medium">
              <Link
                to={editor(`/admin/learning/${t.id}/edit`)}
                className="after:absolute after:inset-0"
              >
                {t.title}
              </Link>
            </TableCell>
            <TableCell>{t.nodes.length}</TableCell>
            <TableCell>
              <PublicationBadge published={t.published} />
            </TableCell>
            <TableCell>
              <Button
                asChild
                size="icon"
                variant="ghost"
                className="relative z-10"
              >
                <Link
                  to={editor(`/admin/learning/${t.id}/edit`)}
                  aria-label={`编辑 ${t.title}`}
                >
                  <Pencil />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的技能树</Empty>}
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
export function TreeEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    back = useEditorReturn("/admin/learning");
  const data = useAPI<LearningTree>(`/admin/learning/trees/${id}`, !!id);
  const save = useAction(
    (body: Record<string, unknown>) =>
      api(
        `/admin/learning/trees${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        body,
      ),
    () => {
      toast.success("技能树已保存");
      navigate(back);
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
        title={id ? "编辑技能树" : "新建技能树"}
        back={back}
        form="tree-form"
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
        <Suspense fallback={<Loading variant="tree-canvas" />}>
          <TreeForm
            key={id ?? "new"}
            tree={data.data ?? null}
            onSave={(body) => save.mutate(body)}
            pending={save.isPending}
          />
        </Suspense>
      )}
    </>
  );
}
