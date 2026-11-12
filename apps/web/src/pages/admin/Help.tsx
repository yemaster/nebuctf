import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useAPI } from "@/lib/api";
import type { HelpDocument } from "@/lib/help";
import { useManagementWrite } from "@/lib/use-management-access";
import { MarkdownEditor } from "@/components/markdown-editor";
import { HelpDocumentMeta } from "@/components/help-document-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  Field,
  Pagination,
  QueryState,
  Table,
} from "@/components/shared";
import {
  AdminToolbar,
  EditorHeading,
  useAdminList,
  useEditorLink,
  useEditorReturn,
} from "@/components/admin/shared";

type ManagedDocument = Omit<HelpDocument, "body">;

export function HelpAdmin() {
  const { params, page, setPage, filter } = useAdminList();
  const editor = useEditorLink();
  const write = useManagementWrite();
  const [deleting, setDeleting] = useState<ManagedDocument | null>(null);
  const data = useAPI<{
    items: ManagedDocument[];
    total: number;
    page: number;
  }>(`/admin/help?${params}`);
  const remove = useAction(
    (id: string) => api(`/admin/help/${id}`, "DELETE"),
    () => {
      setDeleting(null);
      toast.success("帮助文档已删除");
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
      <AdminToolbar
        title="帮助文档"
        createHref={editor("/admin/help/new")}
        createLabel="新建帮助文档"
        search={params.get("q") ?? ""}
        onSearch={(value) => filter("q", value)}
        actions={
          <Button asChild variant="outline">
            <Link to="/help" target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              打开帮助中心
            </Link>
          </Button>
        }
      />
      <p className="mb-6 text-sm leading-6 text-muted-foreground">
        帮助文档与知识库独立管理。相同分组的文档归入同一目录；排序号越小越靠前，分组按组内最小排序号排列。草稿不会在公开帮助中心显示。
      </p>
      <Table
        headers={["文档", "目录分组", "排序", "发布状态", "维护记录", "操作"]}
      >
        {data.data?.items.map((document) => (
          <TableRow key={document.id} className="relative">
            <TableCell>
              <Link
                to={editor(`/admin/help/${document.id}/edit`)}
                className="font-medium after:absolute after:inset-0"
              >
                {document.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                /help/{document.slug}
              </p>
            </TableCell>
            <TableCell>{document.category}</TableCell>
            <TableCell className="tabular-nums">{document.position}</TableCell>
            <TableCell>
              <Badge
                className={
                  document.published
                    ? "bg-success/10 text-success"
                    : "text-muted-foreground"
                }
              >
                {document.published ? "已发布" : "草稿"}
              </Badge>
            </TableCell>
            <TableCell>
              <HelpDocumentMeta
                document={document}
                className="flex-col items-start"
              />
            </TableCell>
            <TableCell>
              <div className="relative z-10 flex items-center gap-1">
                <Button asChild variant="ghost" size="icon">
                  <Link
                    to={editor(`/admin/help/${document.id}/edit`)}
                    aria-label={`${write ? "编辑" : "查看"} ${document.title}`}
                  >
                    <Pencil />
                  </Link>
                </Button>
                {document.published && (
                  <Button asChild variant="ghost" size="icon">
                    <Link
                      to={`/help/${document.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`阅读 ${document.title}`}
                    >
                      <ExternalLink />
                    </Link>
                  </Button>
                )}
                {write && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    aria-label={`删除 ${document.title}`}
                    onClick={() => setDeleting(document)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {data.data?.items.length === 0 && <Empty>没有符合条件的帮助文档</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        hasMore={page * 24 < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除帮助文档</DialogTitle>
            <DialogDescription>
              确认删除「{deleting?.title}
              」？删除后文档地址将无法访问，已有的正文链接也可能失效。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={remove.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {remove.isPending ? "删除中" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HelpEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useEditorReturn("/admin/help");
  const write = useManagementWrite();
  const data = useAPI<HelpDocument>(`/admin/help/${id}`, !!id);
  const save = useAction(
    (body: Record<string, unknown>) =>
      api(`/admin/help${id ? `/${id}` : ""}`, id ? "PUT" : "POST", body),
    () => {
      toast.success("帮助文档已保存");
      navigate(back);
    },
  );
  if (id && (data.error || data.isLoading))
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
        title={id ? "编辑帮助文档" : "新建帮助文档"}
        back={back}
        form="help-document-form"
        pending={save.isPending}
        actions={
          data.data?.published ? (
            <Button asChild variant="outline">
              <Link
                to={`/help/${data.data.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink />
                查看文档
              </Link>
            </Button>
          ) : undefined
        }
      />
      {data.data && <HelpDocumentMeta document={data.data} className="mb-6" />}
      <HelpForm
        key={id ?? "new"}
        document={data.data ?? null}
        disabled={!write || save.isPending}
        pending={save.isPending}
        write={write}
        save={(body) => save.mutate(body)}
      />
    </>
  );
}

function HelpForm({
  document,
  disabled,
  pending,
  write,
  save,
}: {
  document: HelpDocument | null;
  disabled: boolean;
  pending: boolean;
  write: boolean;
  save: (body: Record<string, unknown>) => void;
}) {
  const [body, setBody] = useState(document?.body ?? "");
  return (
    <form
      id="help-document-form"
      className="space-y-6 rounded-xl bg-card p-6 lg:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (!write || pending) return;
        const fields = new FormData(event.currentTarget);
        save({
          title: fields.get("title"),
          slug: fields.get("slug"),
          category: fields.get("category"),
          position: Number(fields.get("position")),
          body,
          published: fields.has("published"),
        });
      }}
    >
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="文档标题">
            <Input
              name="title"
              aria-label="文档标题"
              defaultValue={document?.title}
              maxLength={160}
              required
            />
          </Field>
          <Field label="路径标识">
            <Input
              name="slug"
              aria-label="路径标识"
              defaultValue={document?.slug}
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
            />
            <p className="text-xs leading-5 text-muted-foreground">
              地址为 /help/路径标识。修改后原地址失效，请同步更新引用链接。
            </p>
          </Field>
          <Field label="目录分组">
            <Input
              name="category"
              aria-label="目录分组"
              defaultValue={document?.category ?? "入门指南"}
              maxLength={40}
              required
            />
          </Field>
          <Field label="排序号">
            <Input
              name="position"
              aria-label="排序号"
              type="number"
              min={0}
              max={100000}
              step={1}
              defaultValue={document?.position ?? 100}
              required
            />
          </Field>
        </div>
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Markdown 正文</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            用 ## 和 ###
            编写小标题，阅读页自动生成「本页内容」。跨文档链接请使用
            /help/路径标识。
          </p>
          <MarkdownEditor
            id="help-document-body"
            name="body"
            label="帮助文档正文"
            value={body}
            onChange={setBody}
            disabled={disabled}
            maxLength={200000}
          />
        </section>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            name="published"
            defaultChecked={document?.published ?? false}
          />
          发布到帮助中心
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          已发布文档保存后对访客生效；关闭发布则从公开目录和文档地址同时隐藏。修改保存在数据库中，不需要重新部署。
        </p>
        {write && (
          <Button type="submit" disabled={pending}>
            {pending ? "保存中" : "保存帮助文档"}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
