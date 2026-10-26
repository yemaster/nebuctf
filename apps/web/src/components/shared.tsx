import { useRef, type ReactNode } from "react";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
  PaginationEllipsis,
} from "./ui/pagination";
import { ApiError } from "@/lib/api";
import { StatusPage } from "./status-page";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
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
export function Loading({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      role="status"
      className={`flex w-full flex-col items-center justify-center gap-5 text-muted-foreground ${fullPage ? "h-full min-h-[55dvh]" : "min-h-48 py-10"}`}
    >
      <Loader2 className="size-9 motion-safe:animate-spin" />
      <span className="text-sm">加载中</span>
    </div>
  );
}
export function QueryState({
  loading,
  error,
  retry,
  fullPage = false,
}: {
  loading: boolean;
  error: Error | null;
  retry?: () => void;
  fullPage?: boolean;
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
  if (loading) return <Loading fullPage={fullPage} />;
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
}: {
  page: number;
  setPage: (n: number) => void;
  hasMore: boolean;
  total?: number;
  pageSize?: number;
  disabled?: boolean;
  alwaysShow?: boolean;
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
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{total == null ? `第 ${page} 页` : `共 ${total} 条`}</span>
      <PaginationRoot className="mx-0 w-auto" aria-label="分页">
        <PaginationContent>
          <PaginationItem>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="上一页"
              disabled={disabled || page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
          </PaginationItem>
          {numbers.map((n, i) => (
            <PaginationItem key={n} className="flex items-center">
              {i > 0 && n > numbers[i - 1]! + 1 && <PaginationEllipsis />}
              <Button
                type="button"
                size="icon"
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
            className="w-20"
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
