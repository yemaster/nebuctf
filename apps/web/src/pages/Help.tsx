import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  List,
} from "lucide-react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Markdown } from "@/components/markdown";
import { StatusPage } from "@/components/status-page";
import { Loading } from "@/components/shared";
import { HelpDocumentMeta } from "@/components/help-document-meta";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api, ApiError, useAPI } from "@/lib/api";
import {
  groupHelpDocuments,
  type HelpDocument,
  type HelpDocumentGroup,
  type HelpDocumentSummary,
} from "@/lib/help";
import { cn } from "@/lib/utils";

type Heading = { id: string; title: string; level: number };
function DocumentNavigation({
  groups,
  slug,
  onNavigate,
}: {
  groups: HelpDocumentGroup[];
  slug?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="帮助文档目录" className="flex flex-col gap-4">
      {groups.map((group) => (
        <SidebarGroup key={group.category} className="px-0">
          <SidebarGroupLabel
            asChild
            className="mb-2 text-sm font-semibold text-foreground"
          >
            <h2>{group.category || "帮助文档"}</h2>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.documents.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={slug === item.slug}
                    className="h-9 text-foreground/85 data-[active=true]:font-semibold data-[active=true]:text-primary"
                  >
                    <Link
                      to={`/help/${item.slug}`}
                      onClick={onNavigate}
                      aria-current={slug === item.slug ? "page" : undefined}
                      title={item.title}
                    >
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function OnThisPage({ headings, hash }: { headings: Heading[]; hash: string }) {
  return (
    <nav aria-label="本页内容" className="flex flex-col items-start gap-1">
      {headings.map((heading) => {
        const active =
          hash === `#${encodeURIComponent(heading.id)}` ||
          hash === `#${heading.id}`;
        return (
          <Button
            key={heading.id}
            asChild
            variant="link"
            className={cn(
              "h-auto justify-start whitespace-normal px-0 py-1 text-left font-normal text-muted-foreground hover:text-foreground",
              heading.level === 3 && "pl-4",
              active && "font-medium text-primary",
            )}
          >
            <Link
              to={`#${encodeURIComponent(heading.id)}`}
              aria-current={active ? "location" : undefined}
            >
              {heading.title}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function HelpArticle({
  document,
  previous,
  next,
  pending,
}: {
  document: HelpDocument;
  previous?: HelpDocumentSummary;
  next?: HelpDocumentSummary;
  pending: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const article = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);

  useLayoutEffect(() => {
    const used = new Set(["help-document-title"]);
    const outline: Heading[] = [];
    // Read rendered headings, never Markdown source: fenced code is not a heading.
    body.current
      ?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")
      .forEach((heading) => {
        const title = heading.textContent?.trim() || "章节";
        const base =
          title
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/[\s_]+/g, "-")
            .replace(/^-+|-+$/g, "") || "section";
        let id = base;
        for (let suffix = 1; used.has(id); suffix++) id = `${base}-${suffix}`;
        used.add(id);
        heading.id = id;
        heading.tabIndex = -1;
        heading.classList.add(
          "outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-ring",
        );
        const level = Number(heading.tagName.slice(1));
        if (level === 2 || level === 3) outline.push({ id, title, level });
      });
    setHeadings(outline);
  }, [document.body]);

  useLayoutEffect(() => {
    if (pending) return;
    const viewport = article.current?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    if (!location.hash) {
      viewport.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const heading = Array.from(
      body.current?.querySelectorAll<HTMLElement>("[id]") ?? [],
    ).find((element) => element.id === id);
    if (heading) {
      viewport.scrollTo({
        top:
          viewport.scrollTop +
          heading.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          24,
        behavior: "instant",
      });
      heading.focus({ preventScroll: true });
    }
  }, [document.slug, document.body, location.hash, location.key, pending]);

  function followInternalLink(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    )
      return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(`${destination.pathname}${destination.search}${destination.hash}`);
  }

  return (
    <>
      <article
        ref={article}
        aria-labelledby="help-document-title"
        className="min-w-0 pb-6 [overflow-wrap:anywhere]"
      >
        <header className="mb-10">
          <Breadcrumb aria-label="面包屑" className="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/help">使用帮助</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {document.category || "帮助文档"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1
            id="help-document-title"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {document.title}
          </h1>
          <HelpDocumentMeta document={document} className="mt-6" />
        </header>
        {headings.length > 0 && (
          <Collapsible className="mb-8 xl:hidden">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-3">
                本页内容
                <ChevronDown aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <OnThisPage headings={headings} hash={location.hash} />
            </CollapsibleContent>
          </Collapsible>
        )}
        <div
          ref={body}
          onClick={followInternalLink}
          className="[&_.markdown]:text-base [&_.markdown]:leading-8 [&_.markdown>:first-child]:mt-0 [&_.markdown>:last-child]:mb-0 [&_.markdown_pre]:max-w-full [&_.markdown_table]:max-w-full"
        >
          {document.body.trim() ? (
            <Markdown>{document.body}</Markdown>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              这篇文档暂时没有正文。
            </p>
          )}
        </div>
        <footer className="mt-12">
          <Separator className="mb-6" />
          <nav
            aria-label="相邻文档"
            className="flex flex-wrap items-center justify-between gap-4"
          >
            {previous && (
              <Button asChild variant="outline" className="max-w-full">
                <Link
                  to={`/help/${previous.slug}`}
                  aria-label={`上一篇：${previous.title}`}
                >
                  <ArrowLeft aria-hidden="true" />
                  <span className="truncate">{previous.title}</span>
                </Link>
              </Button>
            )}
            {next && (
              <Button asChild variant="outline" className="ml-auto max-w-full">
                <Link
                  to={`/help/${next.slug}`}
                  aria-label={`下一篇：${next.title}`}
                >
                  <span className="truncate">{next.title}</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )}
          </nav>
          <p className="mt-6 text-xs text-muted-foreground">
            最后更新于{" "}
            <time dateTime={document.updated_at}>
              {new Date(document.updated_at).toLocaleString("zh-CN")}
            </time>
          </p>
        </footer>
      </article>
      <aside className="sticky top-0 hidden h-[calc(100dvh-10rem)] xl:block">
        <ScrollArea className="h-full">
          <h2 className="mb-4 text-sm font-semibold">本页内容</h2>
          {headings.length ? (
            <OnThisPage headings={headings} hash={location.hash} />
          ) : (
            <p className="text-sm text-muted-foreground">本篇暂无小节目录</p>
          )}
        </ScrollArea>
      </aside>
    </>
  );
}

export function Help() {
  const { slug } = useParams<{ slug: string }>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduced = useReducedMotion();
  const directory = useAPI<{ items: HelpDocumentSummary[] }>("/help");
  const documentPath = `/help/${encodeURIComponent(slug ?? "")}`;
  const document = useQuery({
    queryKey: [documentPath],
    queryFn: ({ signal }) =>
      api<HelpDocument>(documentPath, "GET", undefined, signal),
    enabled: Boolean(slug),
    placeholderData: keepPreviousData,
  });
  const groups = useMemo(
    () => groupHelpDocuments(directory.data?.items ?? []),
    [directory.data],
  );
  const ordered = useMemo(
    () => groups.flatMap((group) => group.documents),
    [groups],
  );
  const loading =
    directory.isPending ||
    (slug ? document.isPending : !directory.isError && ordered.length > 0);
  const index = ordered.findIndex((item) => item.slug === document.data?.slug);
  const directoryNavigation = (
    <DocumentNavigation
      groups={groups}
      slug={slug}
      onNavigate={() => setMobileOpen(false)}
    />
  );
  const directoryState = directory.isError ? (
    <div className="px-3 text-sm text-muted-foreground">
      <p>文档目录加载失败</p>
      <Button
        variant="link"
        className="px-0"
        onClick={() => void directory.refetch()}
      >
        重新加载
      </Button>
    </div>
  ) : directory.isPending ? (
    <p role="status" className="px-3 text-sm text-muted-foreground">
      正在加载目录…
    </p>
  ) : groups.length ? (
    directoryNavigation
  ) : (
    <p className="px-3 text-sm text-muted-foreground">暂无已发布文档</p>
  );

  let content;
  if (!slug && directory.isError) {
    content = (
      <StatusPage
        compact
        status={503}
        message="无法加载帮助文档目录，请稍后重试。"
        retry={() => void directory.refetch()}
      />
    );
  } else if (!slug && ordered[0]) {
    content = <Navigate to={`/help/${ordered[0].slug}`} replace />;
  } else if (!slug && !directory.isPending) {
    content = (
      <div className="py-16 text-center">
        <BookOpen
          className="mx-auto mb-4 size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold">帮助文档</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          暂无已发布的帮助文档。
        </p>
      </div>
    );
  } else if (slug && document.isError) {
    content = (
      <StatusPage
        compact
        status={
          document.error instanceof ApiError ? document.error.status : 503
        }
        message={
          document.error instanceof ApiError && document.error.status === 404
            ? "这篇帮助文档不存在或尚未发布。"
            : "帮助文档加载失败，请稍后重试。"
        }
        retry={
          document.error instanceof ApiError && document.error.status === 404
            ? undefined
            : () => void document.refetch()
        }
      />
    );
  } else if (slug && document.data) {
    content = (
      <HelpArticle
        document={document.data}
        pending={document.isPlaceholderData}
        previous={index > 0 ? ordered[index - 1] : undefined}
        next={index >= 0 ? ordered[index + 1] : undefined}
      />
    );
  } else {
    content = null;
  }

  return (
    <>
      {loading && <Loading fullPage />}
      <SidebarProvider className="mx-auto h-full min-h-0 min-w-0 max-w-[1600px] flex-col lg:flex-row">
        <div className="mb-6 flex w-full shrink-0 items-center justify-between border-b pb-3 lg:hidden">
          <Link to="/help" className="text-sm font-semibold">
            使用帮助
          </Link>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm">
                <List aria-hidden="true" />
                文档目录
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              aria-describedby={undefined}
              className="w-80 max-w-[90vw]"
            >
              <SheetHeader>
                <SheetTitle>使用帮助</SheetTitle>
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1">
                <SidebarContent className="px-4 pb-8">
                  {directoryState}
                </SidebarContent>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
        <Sidebar
          collapsible="none"
          role="complementary"
          aria-label="帮助文档侧栏"
          className="hidden h-full w-64 shrink-0 bg-transparent lg:flex xl:w-72"
        >
          <ScrollArea className="h-full">
            <SidebarContent className="overflow-visible pr-4 pb-8">
              {directoryState}
            </SidebarContent>
          </ScrollArea>
        </Sidebar>
        <div
          className="min-h-0 w-full min-w-0 flex-1 lg:pl-12 xl:pl-16"
          role="region"
          aria-label="帮助文档正文"
          aria-busy={
            slug
              ? document.isPending || document.isPlaceholderData
              : directory.isPending
          }
        >
          {document.isPlaceholderData && (
            <span role="status" className="sr-only">
              正在加载文档…
            </span>
          )}
          <ScrollArea className="h-full">
            <m.div
              key={document.data?.slug ?? slug ?? "index"}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: document.isPlaceholderData ? 0.55 : 1 }}
              transition={{ duration: reduced ? 0 : 0.14, ease: "easeOut" }}
              inert={document.isPlaceholderData || undefined}
              aria-hidden={document.isPlaceholderData || undefined}
              className="grid min-w-0 items-start gap-12 pr-2 xl:grid-cols-[minmax(0,1fr)_12rem]"
            >
              {content}
            </m.div>
          </ScrollArea>
        </div>
      </SidebarProvider>
    </>
  );
}
