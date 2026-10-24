import type { ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { PageTitle } from "../shared";

export const adminPageSize = 24;
export function useAdminList() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const setPage = (page: number) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("page", String(page));
      return next;
    });
  const filter = (name: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("page", "1");
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  return { params, page, setPage, filter };
}
export function useEditorLink() {
  const location = useLocation();
  return (path: string) =>
    `${path}?return=${encodeURIComponent(location.pathname + location.search)}`;
}
export function useEditorReturn(fallback: string, contestId?: string) {
  const [params] = useSearchParams();
  const path = params.get("return");
  if (!path || /[\\\x00-\x1f]/.test(path)) return fallback;
  const sameContest =
    contestId &&
    path.match(/^\/contests\/([^/?#]+)(?:[/?#]|$)/)?.[1] === contestId;
  return path.startsWith("/admin/") || sameContest ? path : fallback;
}
export function AdminToolbar({
  title,
  createHref,
  createLabel,
  search,
  onSearch,
  children,
}: {
  title: string;
  createHref: string;
  createLabel: string;
  search: string;
  onSearch: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <PageTitle
        action={
          <Button asChild>
            <Link to={createHref}>
              <Plus />
              {createLabel}
            </Link>
          </Button>
        }
      >
        {title}
      </PageTitle>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form
          className="flex w-full gap-2 sm:w-80"
          key={search}
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(
              String(new FormData(e.currentTarget).get("q") ?? "").trim(),
            );
          }}
          role="search"
        >
          <Input
            name="q"
            aria-label={`搜索${title}`}
            placeholder={`搜索${title}`}
            defaultValue={search}
            maxLength={100}
          />
          <Button
            type="submit"
            variant="secondary"
            size="icon"
            aria-label="搜索"
          >
            <Search />
          </Button>
        </form>
        {children}
      </div>
    </>
  );
}
export function EditorHeading({
  title,
  back,
  form,
  pending,
  backLabel = "返回列表",
}: {
  title: string;
  back: string;
  form: string;
  pending: boolean;
  backLabel?: string;
}) {
  return (
    <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center justify-between gap-4 bg-background py-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button asChild size="icon" variant="ghost">
          <Link to={back} aria-label={backLabel}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 break-words text-2xl font-semibold">{title}</h1>
      </div>
      <Button type="submit" form={form} disabled={pending}>
        {pending ? "保存中" : "保存"}
      </Button>
    </div>
  );
}
export function PublicationBadge({
  published,
  publish_at,
}: {
  published: boolean;
  publish_at?: string | null;
}) {
  return (
    <Badge
      className={
        published
          ? "bg-success/10 text-success"
          : publish_at
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : "text-muted-foreground"
      }
    >
      {published ? "已启用" : publish_at ? "定时上线" : "未启用"}
    </Badge>
  );
}
export const inputDate = (value: string | null | undefined) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
