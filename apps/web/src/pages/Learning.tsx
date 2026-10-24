import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { DetailLink } from "@/components/detail-link";
import {
  Link,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { lazy, Suspense, useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronRight, Search } from "lucide-react";
import { useUser } from "@/App";
import { api, useAction, useAPI } from "@/lib/api";
import type { Article, LearningTree } from "@/lib/types";
import { date } from "@/lib/utils";
import { learningReturnPath } from "@/lib/learning-navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemGroup,
} from "@/components/ui/item";
import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Empty,
  PageTitle,
  Pagination,
  QueryState,
  Loading,
} from "@/components/shared";
import { Markdown } from "@/components/markdown";
const LearningTreeView = lazy(() =>
  import("@/components/learning-tree-view").then((m) => ({
    default: m.LearningTreeView,
  })),
);
export function Library() {
  const [category, setCategory] = useState(""),
    [kind, setKind] = useState(""),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const categories = useAPI<{ items: { category: string }[] }>(
    "/articles/categories",
  );
  const data = useAPI<{ items: Article[]; total: number }>(
    `/articles?kind=${kind}&category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}&page=${page}`,
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
          <Button variant="outline" asChild>
            <Link to="/learning">
              技能树
              <ArrowUpRight />
            </Link>
          </Button>
        }
      >
        文档与教程
      </PageTitle>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          value={kind || "all"}
          onValueChange={(v) => {
            if (v) {
              setKind(v === "all" ? "" : v);
              setPage(1);
            }
          }}
          aria-label="内容类型"
        >
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="document">文档</ToggleGroupItem>
          <ToggleGroupItem value="tutorial">教程</ToggleGroupItem>
        </ToggleGroup>
        <NativeSelect
          aria-label="文档分类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.data?.items.map((v) => (
            <NativeSelectOption key={v.category}>
              {v.category}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <form
          className="relative w-full sm:w-64"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search);
            setPage(1);
          }}
        >
          <InputGroup>
            <InputGroupInput
              aria-label="搜索文档"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文档和教程"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" size="icon-sm" aria-label="搜索">
                <Search />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      <ItemGroup className="rounded-lg bg-card">
        {data.data?.items.map((a) => (
          <Item key={a.id} size="sm" asChild>
            <DetailLink
              destination={{ kind: "article", id: a.slug }}
              role="listitem"
            >
              <ItemContent className="min-w-0">
                <ItemTitle className="break-words">
                  {a.title}
                  {a.completed && (
                    <CheckCircle2
                      className="size-4 shrink-0 text-success"
                      aria-label="已完成"
                    />
                  )}
                </ItemTitle>
                <ItemDescription className="text-xs">
                  <span>{a.category}</span>
                  <span className="ml-3">
                    {a.kind === "tutorial" ? "教程" : "文档"}
                  </span>
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <time className="hidden text-xs text-muted-foreground sm:block">
                  {date(a.updated_at)}
                </time>
                <ChevronRight className="size-4 text-muted-foreground" />
              </ItemActions>
            </DetailLink>
          </Item>
        ))}
        {data.data?.items.length === 0 && <Empty>暂无文档</Empty>}
      </ItemGroup>
      <Pagination
        page={page}
        setPage={setPage}
        hasMore={page * 24 < (data.data?.total ?? 0)}
      />
    </>
  );
}
export function ArticlePage() {
  const [params] = useSearchParams(),
    location = useLocation();
  const returnToTree = learningReturnPath(params);
  const { slug } = useParams(),
    user = useUser();
  const data = useAPI<Article>(`/articles/${slug}`),
    a = data.data;
  const complete = useAction(() => api(`/articles/${a!.id}/complete`, "POST"));
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
    <div className="mx-auto max-w-4xl">
      <Link
        to={returnToTree ?? "/library"}
        className="mb-6 inline-block text-sm text-muted-foreground hover:text-primary"
      >
        {returnToTree ? "← 返回技能树" : "← 返回文档与教程"}
      </Link>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {a && (
        <article
          data-card-detail={`/library/${encodeURIComponent(slug!)}`}
          className="rounded-lg bg-card p-6 sm:p-10"
        >
          <div className="mb-7 pb-4">
            <h1 className="text-2xl font-semibold ">{a.title}</h1>
            <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
              <Badge>{a.category}</Badge>
              <span>{a.kind === "tutorial" ? "教程" : "文档"}</span>
              <span>{date(a.updated_at)}</span>
            </div>
          </div>
          <Markdown>{a.body}</Markdown>
          <div className="mt-10 flex items-center justify-between gap-4 pt-4">
            <Link
              to={returnToTree ?? "/learning"}
              className="text-sm text-primary"
            >
              {returnToTree ? "返回技能树" : "查看技能树"}
            </Link>
            {user ? (
              <Button
                variant={a.completed ? "secondary" : "default"}
                disabled={a.completed || complete.isPending}
                onClick={() => complete.mutate()}
              >
                <CheckCircle2 />
                {a.completed ? "已完成学习" : "标记为已完成"}
              </Button>
            ) : (
              <Button asChild>
                <Link
                  to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
                >
                  登录以保存进度
                </Link>
              </Button>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
export function Learning() {
  const data = useAPI<{
    items: (Omit<LearningTree, "nodes"> & { nodes: number })[];
  }>("/learning/trees");
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
          <Button variant="outline" asChild>
            <Link to="/library">
              文档与教程
              <ArrowUpRight />
            </Link>
          </Button>
        }
      >
        技能树
      </PageTitle>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.data?.items.map((t) => (
          <DetailLink
            key={t.id}
            destination={{ kind: "learning", id: t.id }}
            className="group block rounded-xl bg-card outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full gap-6 border-0 bg-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-lg leading-6">
                  {t.title}
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </CardTitle>
              </CardHeader>
              <CardFooter className="text-sm text-muted-foreground">
                {t.nodes} 个技能节点
              </CardFooter>
            </Card>
          </DetailLink>
        ))}
      </div>
      {data.data?.items.length === 0 && (
        <div className="rounded-lg bg-card">
          <Empty>暂无学习路线</Empty>
        </div>
      )}
    </>
  );
}
export function LearningDetail() {
  const { id } = useParams();
  const data = useAPI<LearningTree>(`/learning/trees/${id}`),
    tree = data.data;
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
      <Link
        to="/learning"
        className="mb-6 inline-block text-sm text-muted-foreground"
      >
        ← 全部技能树
      </Link>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {tree && (
        <div data-card-detail={`/learning/${id}`}>
          <PageTitle
            action={
              <span className="text-sm tabular-nums text-muted-foreground">
                {tree.completed} / {tree.nodes.length} 已完成
              </span>
            }
          >
            {tree.title}
          </PageTitle>
          <Progress
            aria-label="学习进度"
            className="mb-8 h-1.5"
            value={
              tree.nodes.length ? (tree.completed / tree.nodes.length) * 100 : 0
            }
          />
          <Suspense fallback={<Loading fullPage />}>
            <LearningTreeView key={id} nodes={tree.nodes} />
          </Suspense>
        </div>
      )}
    </>
  );
}
