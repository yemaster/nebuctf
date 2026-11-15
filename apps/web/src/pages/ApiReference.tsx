import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, Copy, KeyRound, Search } from "lucide-react";
import { toast } from "sonner";
import { useAPI } from "@/lib/api";
import {
  apiKeyEndpointMatches,
  type ApiKeyCatalogResponse,
  type ApiKeyEndpoint,
} from "@/lib/api-keys";
import { copyText } from "@/lib/clipboard";
import { Empty, PageTitle, QueryState } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EndpointCategory = {
  id: string;
  name: string;
  endpoints: ApiKeyEndpoint[];
};

function endpointId(endpoint: ApiKeyEndpoint) {
  return `${endpoint.method}:${endpoint.path}`;
}

function RequestExample({ endpoint }: { endpoint: ApiKeyEndpoint }) {
  const [copied, setCopied] = useState(false);
  const path = endpoint.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
  const parameters = Array.from(
    new Set(endpoint.path.match(/:[A-Za-z_][A-Za-z0-9_]*/g) ?? []),
  );
  const curl = `curl --globoff --request ${endpoint.method} \\\n  --url "${window.location.origin}${path}" \\\n  --header "Authorization: Bearer $NEBUCTF_API_KEY"`;

  return (
    <section
      aria-labelledby="api-endpoint-detail"
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
    >
      <div className="space-y-3 p-4 sm:p-5">
        <h2 id="api-endpoint-detail" className="font-semibold">
          {endpoint.summary}
        </h2>
        <div className="flex min-w-0 items-start gap-2">
          <Badge variant="outline" className="font-mono">
            {endpoint.method}
          </Badge>
          <code className="min-w-0 break-all text-xs leading-6">
            {endpoint.path}
          </code>
        </div>
        {parameters.length > 0 && (
          <p className="break-words text-xs leading-6 text-muted-foreground">
            路径参数：
            {parameters
              .map((parameter) => `{${parameter.slice(1)}}`)
              .join("、")}
          </p>
        )}
      </div>
      <div className="min-w-0 border-t bg-muted/40">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            curl
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await copyText(curl);
                setCopied(true);
                toast.success("请求示例已复制");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "复制失败，请手动复制",
                );
              }
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "已复制" : "复制请求"}
          </Button>
        </div>
        <pre className="max-w-full overflow-x-auto p-4 text-xs leading-6">
          <code>{curl}</code>
        </pre>
      </div>
    </section>
  );
}

export function ApiReference() {
  const query = useAPI<ApiKeyCatalogResponse>("/api-keys/catalog");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null);
  const categories = useMemo(() => {
    const grouped = new Map<string, EndpointCategory>();
    if (!query.data?.enabled) return [];
    for (const scope of query.data.scopes) {
      const id = scope.id.replace(/:[^:]+$/, "");
      let category = grouped.get(id);
      if (!category) {
        category = {
          id,
          name: scope.name.replace(/[：:][^：:]+$/, ""),
          endpoints: [],
        };
        grouped.set(id, category);
      }
      for (const endpoint of scope.endpoints) {
        if (
          !category.endpoints.some(
            (existing) => endpointId(existing) === endpointId(endpoint),
          )
        ) {
          category.endpoints.push(endpoint);
        }
      }
    }
    return Array.from(grouped.values()).filter(
      (category) => category.endpoints.length > 0,
    );
  }, [query.data]);

  if (!query.data || query.error) {
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const activeCategory = categories.find(
    (category) => category.id === selectedCategory,
  );
  const matches = categories.map((category) => ({
    ...category,
    endpoints: category.name.toLocaleLowerCase().includes(normalizedSearch)
      ? category.endpoints
      : category.endpoints.filter((endpoint) =>
          apiKeyEndpointMatches(endpoint, normalizedSearch),
        ),
  }));
  const visible = matches.filter(
    (category) =>
      category.endpoints.length > 0 &&
      (!activeCategory || category.id === activeCategory.id),
  );
  const endpoints = visible.flatMap((category) => category.endpoints);
  const endpoint =
    endpoints.find((item) => endpointId(item) === selectedEndpoint) ??
    endpoints[0];
  const matchCount = matches.reduce(
    (count, category) => count + category.endpoints.length,
    0,
  );

  return (
    <>
      <PageTitle
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/account?section=api-keys">
              <KeyRound />
              我的密钥
            </Link>
          </Button>
        }
      >
        API 文档
      </PageTitle>
      {!query.data.enabled || !categories.length ? (
        <Empty>
          <BookOpen className="size-7" aria-hidden="true" />
          <p>{query.data.enabled ? "暂无开放接口" : "API Key 功能尚未开放"}</p>
        </Empty>
      ) : (
        <div className="min-w-0 space-y-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">
              认证
            </span>
            <code className="min-w-0 break-all text-xs leading-6 sm:text-sm">
              Authorization: Bearer &lt;API_KEY&gt;
            </code>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedEndpoint(null);
              }}
              className="pl-9"
              placeholder="搜索方法、路径或接口名称"
              aria-label="搜索 API 接口"
            />
          </div>
          <div className="grid min-w-0 gap-5 lg:grid-cols-[10rem_minmax(0,1fr)]">
            <nav aria-label="API 接口分类" className="min-w-0">
              <div className="flex flex-wrap gap-1 lg:sticky lg:top-4 lg:flex-col">
                <Button
                  variant={!activeCategory ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-between gap-3"
                  aria-pressed={!activeCategory}
                  onClick={() => {
                    setSelectedCategory(null);
                    setSelectedEndpoint(null);
                  }}
                >
                  全部接口
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {matchCount}
                  </span>
                </Button>
                {matches
                  .filter(
                    (category) =>
                      category.endpoints.length > 0 ||
                      category.id === activeCategory?.id,
                  )
                  .map((category) => (
                    <Button
                      key={category.id}
                      variant={
                        activeCategory?.id === category.id
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      className="justify-between gap-3"
                      aria-pressed={activeCategory?.id === category.id}
                      onClick={() => {
                        setSelectedCategory(category.id);
                        setSelectedEndpoint(null);
                      }}
                    >
                      {category.name}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {category.endpoints.length}
                      </span>
                    </Button>
                  ))}
              </div>
            </nav>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {activeCategory?.name ?? "全部接口"}
                </h2>
                <p className="text-xs text-muted-foreground" role="status">
                  {endpoints.length} 个接口
                </p>
              </div>
              {endpoint ? (
                <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="max-h-80 min-w-0 overflow-y-auto overscroll-contain rounded-lg border bg-card sm:max-h-[36rem]">
                    {visible.map((category) => (
                      <section key={category.id} aria-label={category.name}>
                        {!activeCategory && (
                          <h3 className="sticky top-0 z-10 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                            {category.name}
                          </h3>
                        )}
                        <ul className="divide-y">
                          {category.endpoints.map((item) => {
                            const selected =
                              endpointId(item) === endpointId(endpoint);
                            return (
                              <li key={endpointId(item)} className="min-w-0">
                                <button
                                  type="button"
                                  aria-pressed={selected}
                                  aria-controls="api-endpoint-detail"
                                  className={`w-full min-w-0 space-y-1 px-3 py-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? "bg-accent" : ""}`}
                                  onClick={() =>
                                    setSelectedEndpoint(endpointId(item))
                                  }
                                >
                                  <div className="flex min-w-0 items-start gap-2">
                                    <Badge
                                      variant={
                                        selected ? "outline" : "secondary"
                                      }
                                      className="min-w-14 font-mono text-[10px]"
                                    >
                                      {item.method}
                                    </Badge>
                                    <code className="min-w-0 break-all text-xs leading-5">
                                      {item.path}
                                    </code>
                                  </div>
                                  <p className="text-xs leading-5 text-muted-foreground">
                                    {item.summary}
                                  </p>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                  <RequestExample
                    key={endpointId(endpoint)}
                    endpoint={endpoint}
                  />
                </div>
              ) : (
                <Empty>
                  <p>没有匹配的接口</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setSelectedCategory(null);
                      setSelectedEndpoint(null);
                    }}
                  >
                    重置筛选
                  </Button>
                </Empty>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
