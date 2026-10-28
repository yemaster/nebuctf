import { cn } from "@/lib/utils";
import { useRef, type ReactNode } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import {
  ContentSkeleton,
  pageSkeleton,
  type SkeletonKind,
} from "./content-skeleton";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
} from "./ui/pagination";
import { ApiError } from "@/lib/api";
import { StatusPage } from "./status-page";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Empty as EmptyRoot, EmptyContent } from "./ui/empty";
import {
  Table as TableRoot,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function PageTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      data-slot="page-title"
      className="mb-8 flex flex-wrap items-center justify-between gap-3"
    >
      <h1 className="text-2xl font-semibold ">{children}</h1>
      {action}
    </div>
  );
}
export function Empty({ children = "暂无内容" }: { children?: ReactNode }) {
  return (
    <EmptyRoot className="py-10 md:p-10">
      <EmptyContent className="gap-3 text-muted-foreground">
        {children}
      </EmptyContent>
    </EmptyRoot>
  );
}
type LoadingProps = {
  fullPage?: boolean;
  variant?: SkeletonKind;
  routeShell?: boolean;
  className?: string;
};
export function Loading(props: LoadingProps) {
  const routed = useInRouterContext();
  return routed ? (
    <RouteLoading {...props} />
  ) : (
    <ContentSkeleton
      kind={props.variant}
      fullPage={props.fullPage}
      className={props.className}
    />
  );
}
function RouteLoading({
  fullPage = false,
  variant,
  routeShell = false,
  className,
}: LoadingProps) {
  const { pathname, search } = useLocation();
  const shell = routeShell
    ? pathname.startsWith("/admin")
      ? "admin"
      : /\/manage(?:\/|$)/.test(pathname)
        ? "management"
        : undefined
    : undefined;
  return (
    <ContentSkeleton
      kind={variant ?? (fullPage ? pageSkeleton(pathname, search) : "content")}
      fullPage={fullPage}
      shell={shell}
      className={className}
    />
  );
}
export function QueryState({
  loading,
  error,
  retry,
  fullPage = false,
  variant,
}: {
  loading: boolean;
  error: Error | null;
  retry?: () => void;
  fullPage?: boolean;
  variant?: SkeletonKind;
}) {
  if (error)
    return (
      <StatusPage
        status={error instanceof ApiError ? error.status : 0}
        message={error.message}
        action={error instanceof ApiError ? error.action : undefined}
        retry={retry}
        compact={!fullPage}
      />
    );
  if (loading) return <Loading fullPage={fullPage} variant={variant} />;
  return null;
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-2 text-sm font-medium ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function LoginPrompt() {
  return <StatusPage status={401} />;
}
export function Pagination({
  page,
  setPage,
  hasMore,
  total,
  pageSize = 24,
  disabled = false,
  alwaysShow = false,
  compact = false,
}: {
  page: number;
  setPage: (n: number) => void;
  hasMore: boolean;
  total?: number;
  pageSize?: number;
  disabled?: boolean;
  alwaysShow?: boolean;
  compact?: boolean;
}) {
  const jump = useRef<HTMLInputElement>(null);
  const pages = total == null ? null : Math.max(1, Math.ceil(total / pageSize));
  const go = () => {
    const value = Number(jump.current?.value);
    if (Number.isInteger(value) && value >= 1 && pages && value <= pages)
      setPage(value);
  };
  if (!alwaysShow && page === 1 && !hasMore) return null;
  const numbers = pages
    ? Array.from(
        new Set(
          [1, page - 1, page, page + 1, pages].filter(
            (n) => n >= 1 && n <= pages,
          ),
        ),
      ).sort((a, b) => a - b)
    : [page];
  return (
    <div
      className={cn(
        "mt-5 flex flex-wrap items-center justify-between gap-3 text-muted-foreground",
        compact ? "text-xs gap-2" : "text-sm",
      )}
    >
      <span>{total == null ? `第 ${page} 页` : `共 ${total} 条`}</span>
      <PaginationRoot className="mx-0 w-auto" aria-label="分页">
        <PaginationContent className={compact ? "gap-0.5" : undefined}>
          <PaginationItem>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={
                compact ? "size-7 text-xs [&_svg]:size-3.5" : undefined
              }
              aria-label="上一页"
              disabled={disabled || page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
          </PaginationItem>
          {numbers.map((n, i) => (
            <PaginationItem key={n} className="flex items-center">
              {i > 0 && n > numbers[i - 1]! + 1 && (
                <PaginationEllipsis
                  className={compact ? "size-5 [&_svg]:size-3" : undefined}
                />
              )}
              <Button
                type="button"
                size="icon"
                className={
                  compact ? "size-7 text-xs [&_svg]:size-3.5" : undefined
                }
                variant={n === page ? "outline" : "ghost"}
                aria-label={`第 ${n} 页`}
                aria-current={n === page ? "page" : undefined}
                disabled={disabled}
                onClick={() => setPage(n)}
              >
                {n}
              </Button>
            </PaginationItem>
          ))}
          <PaginationItem>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={
                compact ? "size-7 text-xs [&_svg]:size-3.5" : undefined
              }
              aria-label="下一页"
              disabled={disabled || !hasMore}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </PaginationRoot>
      {pages && pages > 5 && (
        <div className="flex items-center gap-2">
          <Input
            ref={jump}
            key={page}
            aria-label="跳转页码"
            type="number"
            className={compact ? "h-7 w-14 text-xs" : "w-20"}
            min={1}
            max={pages}
            defaultValue={page}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            className={compact ? "h-7 px-2 text-xs" : undefined}
            onClick={go}
          >
            跳转
          </Button>
        </div>
      )}
    </div>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card">
      <TableRoot>
        <TableHeader className="bg-muted/70">
          <TableRow>
            {headers.map((h, index) => (
              <TableHead
                key={typeof h === "string" ? h : index}
                className={`px-4 text-xs text-muted-foreground ${typeof h === "string" && ["得分", "解题"].includes(h) ? "text-right" : ""}`}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-4 [&_td]:py-3">{children}</TableBody>
      </TableRoot>
    </div>
  );
}
