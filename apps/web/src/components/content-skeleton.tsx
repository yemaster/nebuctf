import type { ReactNode } from "react";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

export type SkeletonKind =
  | "content"
  | "home"
  | "contests"
  | "contest"
  | "catalog"
  | "workspace"
  | "objective-workspace"
  | "challenge"
  | "paper"
  | "directory"
  | "scoreboard"
  | "announcements"
  | "cards"
  | "article"
  | "tree"
  | "table"
  | "form"
  | "form-tabs"
  | "editor"
  | "account"
  | "submissions"
  | "team"
  | "auth"
  | "terminal"
  | "resources"
  | "overview"
  | "writeups"
  | "chart"
  | "radar"
  | "calendar"
  | "spectator"
  | "scene"
  | "document"
  | "rows"
  | "resource"
  | "posters"
  | "activity"
  | "objective-nav"
  | "console"
  | "tree-canvas"
  | "account-security";

export function pageSkeleton(path: string, search = ""): SkeletonKind {
  const params = new URLSearchParams(search);
  if (path === "/") return "home";
  if (path === "/challenges")
    return params.has("challenge") || params.has("problemset")
      ? params.get("challenge") === "objective"
        ? "objective-workspace"
        : "workspace"
      : "catalog";
  if (path === "/contests") return "contests";
  if (/^\/contests\/[^/]+\/challenges$/.test(path))
    return params.get("challenge") === "objective"
      ? "objective-workspace"
      : "workspace";
  if (/^\/contests\/[^/]+\/spectate$/.test(path)) return "spectator";
  if (/^\/contests\/[^/]+$/.test(path)) return "contest";
  if (/\/scoreboard$/.test(path))
    return path === "/scoreboard" &&
      (!params.get("scope") || params.get("scope") === "practice")
      ? "table"
      : "scoreboard";
  if (path === "/login" || path === "/register") return "auth";
  if (path === "/account")
    return params.get("section") === "submissions"
      ? "submissions"
      : params.get("section") === "security"
        ? "account-security"
        : "account";
  if (path === "/terminal") return "terminal";
  if (path.startsWith("/admin") || /\/manage(?:\/|$)/.test(path)) {
    if (/\/writeups(?:\/|$)/.test(path)) return "writeups";
    if (
      /^\/admin\/(challenges|contests)\/(?:new|[^/]+\/edit)$/.test(path) ||
      /^\/contests\/[^/]+\/manage\/settings$/.test(path)
    )
      return "form-tabs";
    if (/\/(edit|new|settings|containers|mail|import)$/.test(path))
      return "form";
    if (path === "/admin" || /\/overview$/.test(path)) return "overview";
    return "table";
  }
  if (/\/announcements$/.test(path)) return "announcements";
  if (/\/instances$/.test(path)) return "resources";
  if (/\/writeup$/.test(path) || path === "/team/new") return "form";
  if (path === "/team") return params.has("team") ? "team" : "cards";
  if (path === "/learning") return "cards";
  if (path.startsWith("/learning/")) return "tree";
  if (path === "/problemsets") return "cards";
  if (path.startsWith("/problemsets/")) return "catalog";
  if (path === "/library") return "table";
  if (path.startsWith("/library/")) return "article";
  return "content";
}

const repeat = (count: number, render: (index: number) => ReactNode) =>
  Array.from({ length: count }, (_, index) => (
    <div key={index}>{render(index)}</div>
  ));
function Lines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {repeat(count, (i) => (
        <Skeleton className={cn("h-4", i === count - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
function Heading() {
  return (
    <div className="mb-8 flex h-8 items-center justify-between gap-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-8 w-24" />
    </div>
  );
}
function Filters() {
  return (
    <div className="mb-6 flex gap-3">
      <Skeleton className="h-9 w-64 max-w-[60%]" />
      <Skeleton className="h-9 w-28" />
    </div>
  );
}
function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-5 rounded-lg bg-card p-6", className)}>
      {children}
    </div>
  );
}
function Rows({
  count = 7,
  catalog = false,
}: {
  count?: number;
  catalog?: boolean;
}) {
  return (
    <div className="min-w-0 divide-y divide-border/50">
      {repeat(count, (i) => (
        <div
          className={cn(
            "flex items-center gap-4 px-4",
            catalog ? "h-14" : "h-12",
          )}
        >
          <Skeleton
            className={cn(
              "shrink-0",
              catalog ? "size-4 rounded-full" : "h-4 w-8",
            )}
          />
          <Skeleton
            className={cn("h-4 max-w-[40%]", i % 2 ? "w-48" : "w-64")}
          />
          <div className="ml-auto flex w-2/5 items-center justify-between gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
          </div>
        </div>
      ))}
    </div>
  );
}
function TableBody({ catalog = false }: { catalog?: boolean }) {
  return (
    <>
      <Filters />
      <Skeleton className="h-10 w-full rounded-none" />
      <Rows catalog={catalog} />
      <div className="mt-5 flex justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-7 w-44" />
      </div>
    </>
  );
}
function Cards({
  posters = false,
  count = 6,
}: {
  posters?: boolean;
  count?: number;
}) {
  return (
    <div
      className={
        posters
          ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-5"
          : "grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      }
    >
      {repeat(count, () => (
        <Panel className={posters ? "overflow-hidden p-0" : undefined}>
          {posters && (
            <Skeleton className="aspect-[16/9] w-full rounded-none" />
          )}
          <div className={cn("space-y-4", posters && "p-5 pt-0")}>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Panel>
      ))}
    </div>
  );
}
function CalendarBody() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-6 w-28" />
      <div className="flex justify-between">
        <Skeleton className="size-6" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="size-6" />
      </div>
      <div className="grid grid-cols-7 gap-x-2 gap-y-4">
        {repeat(35, () => (
          <Skeleton className="mx-auto h-5 w-5" />
        ))}
      </div>
    </div>
  );
}
function Notices({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {repeat(count, () => (
        <Panel>
          <Skeleton className="h-6 w-2/5" />
          <Lines />
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-2 h-3 w-28" />
          </div>
        </Panel>
      ))}
    </div>
  );
}
function Directory() {
  return (
    <div className="space-y-6 p-5">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-9 w-full" />
      {repeat(3, () => (
        <div className="space-y-3">
          <Skeleton className="h-4 w-16" />
          {repeat(3, () => (
            <div className="flex h-11 items-center gap-2">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="ml-auto h-4 w-8" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
function Resource() {
  return (
    <Panel className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-5" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-2 w-full" />
    </Panel>
  );
}
function ChallengeBody({ paper = false }: { paper?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-9 px-6 py-8 sm:px-10 lg:px-12 lg:py-12 xl:px-16">
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/2" />
        <div className="flex gap-5">
          {repeat(3, () => (
            <Skeleton className="h-4 w-16" />
          ))}
        </div>
      </div>
      {paper ? (
        repeat(3, () => (
          <Panel>
            <Skeleton className="h-5 w-3/4" />
            {repeat(4, () => (
              <div className="flex items-center gap-3">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </Panel>
        ))
      ) : (
        <>
          <Lines count={5} />
          <Resource />
          <Panel>
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-3">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-10 w-24" />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
function Chart() {
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        {repeat(3, () => (
          <Skeleton className="h-4 w-20" />
        ))}
      </div>
      <div className="flex h-56 gap-4">
        <div className="flex flex-col justify-between">
          {repeat(4, () => (
            <Skeleton className="h-3 w-6" />
          ))}
        </div>
        <Skeleton className="h-full flex-1" />
      </div>
      <div className="flex justify-between pl-10">
        {repeat(5, () => (
          <Skeleton className="h-3 w-12" />
        ))}
      </div>
    </div>
  );
}
function FormBody({ tabs = false }: { tabs?: boolean }) {
  return (
    <Panel>
      {tabs && (
        <div className="flex gap-5">
          {repeat(4, () => (
            <Skeleton className="h-7 w-20" />
          ))}
        </div>
      )}
      <div className="space-y-6 pt-3">
        {repeat(3, () => (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-36 w-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
    </Panel>
  );
}
function Tree() {
  return (
    <Panel className="min-h-[55dvh] space-y-8">
      <Skeleton className="mx-auto h-12 w-48" />
      <div className="mx-auto h-6 w-px bg-border" />
      <div className="grid grid-cols-3 gap-6">
        {repeat(3, () => (
          <div className="space-y-5">
            <Skeleton className="mx-auto h-12 w-full max-w-48" />
            <div className="mx-auto h-8 w-px bg-border" />
            {repeat(2, () => (
              <Skeleton className="mx-auto h-10 w-full max-w-40" />
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
function Body({ kind }: { kind: SkeletonKind }) {
  switch (kind) {
    case "home":
      return (
        <>
          <Heading />
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-8">
              <Notices />
              <Cards posters count={2} />
            </div>
            <div className="space-y-8">
              <Panel>
                <CalendarBody />
              </Panel>
              <Panel>
                <Rows count={4} />
              </Panel>
            </div>
          </div>
        </>
      );
    case "contests":
      return (
        <>
          <Heading />
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_288px]">
            <div className="space-y-6">
              <Skeleton className="h-7 w-28" />
              <Cards posters />
            </div>
            <Panel className="p-4">
              <CalendarBody />
            </Panel>
          </div>
        </>
      );
    case "contest":
      return (
        <div className="space-y-6">
          <Panel className="grid items-center gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_296px]">
            <div className="space-y-6">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex justify-between">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
              </div>
              <Skeleton className="h-2 w-full" />
              <div className="flex gap-3">
                {repeat(3, () => (
                  <Skeleton className="h-9 w-24" />
                ))}
              </div>
            </div>
            <Skeleton className="aspect-[16/9] w-full" />
          </Panel>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Panel>
              <Skeleton className="h-5 w-24" />
              <Lines count={5} />
            </Panel>
            <Panel>
              <Skeleton className="h-5 w-20" />
              {repeat(4, () => (
                <div className="flex gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="flex-1">
                    <Lines count={2} />
                  </div>
                </div>
              ))}
            </Panel>
          </div>
        </div>
      );
    case "catalog":
      return (
        <div className="p-4 sm:p-6 lg:p-8">
          <Heading />
          <TableBody catalog />
        </div>
      );
    case "objective-workspace":
    case "workspace":
      return (
        <div className="flex h-full min-h-[70dvh]">
          <div className="hidden w-80 shrink-0 bg-card lg:block 2xl:w-96">
            <Directory />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-14 items-center gap-3 px-5">
              <Skeleton className="h-8 w-32" />
            </div>
            <ChallengeBody paper={kind === "objective-workspace"} />
          </div>
        </div>
      );
    case "challenge":
      return <ChallengeBody />;
    case "paper":
      return <ChallengeBody paper />;
    case "directory":
      return <Directory />;
    case "scoreboard":
      return (
        <>
          <Heading />
          <Panel>
            <Chart />
          </Panel>
          <div className="mt-6">
            <TableBody />
          </div>
        </>
      );
    case "table":
      return (
        <>
          <Heading />
          <TableBody />
        </>
      );
    case "announcements":
      return (
        <>
          <Heading />
          <Notices count={3} />
        </>
      );
    case "cards":
      return (
        <>
          <Heading />
          <Cards />
        </>
      );
    case "article":
      return (
        <div className="mx-auto max-w-4xl space-y-8">
          <Heading />
          <Skeleton className="h-4 w-48" />
          <Lines count={5} />
          <Skeleton className="h-40 w-full" />
          <Lines count={5} />
        </div>
      );
    case "tree":
      return (
        <>
          <Heading />
          <Skeleton className="mb-8 h-1.5 w-full" />
          <Tree />
        </>
      );
    case "form-tabs":
    case "form":
      return (
        <>
          <Heading />
          <FormBody tabs={kind === "form-tabs"} />
        </>
      );
    case "editor":
      return (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <div className="grid min-h-80 grid-cols-2 gap-6">
            <Lines count={10} />
            <Lines count={10} />
          </div>
        </div>
      );
    case "account":
    case "account-security":
    case "submissions":
      return (
        <>
          <Heading />
          <div className="flex flex-col gap-8 md:flex-row">
            <div className="w-full shrink-0 space-y-3 md:w-48">
              {repeat(3, () => (
                <Skeleton className="h-11 w-full" />
              ))}
            </div>
            <Panel className="flex-1 p-7">
              {kind === "submissions" ? (
                <>
                  <Skeleton className="h-6 w-28" />
                  <TableBody />
                </>
              ) : kind === "account-security" ? (
                <>
                  <Skeleton className="h-6 w-28" />
                  {repeat(3, () => (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-9 w-full max-w-xl" />
                    </div>
                  ))}
                  <Skeleton className="h-9 w-24" />
                </>
              ) : (
                <>
                  <Skeleton className="h-6 w-28" />
                  <div className="flex items-center gap-5">
                    <Skeleton className="size-20 rounded-full" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    {repeat(4, () => (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                    ))}
                  </div>
                  <Skeleton className="h-9 w-24" />
                </>
              )}
            </Panel>
          </div>
        </>
      );
    case "team":
      return (
        <>
          <Heading />
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel>
              <Skeleton className="h-7 w-40" />
              {repeat(4, () => (
                <div className="flex h-12 items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </Panel>
            <FormBody />
          </div>
        </>
      );
    case "auth":
      return (
        <div className="mx-auto grid min-h-[70dvh] max-w-6xl items-center gap-16 px-8 lg:grid-cols-2">
          <div className="hidden space-y-6 lg:block">
            <Skeleton className="h-12 w-56" />
            <Lines />
          </div>
          <div className="space-y-7">
            <Skeleton className="h-9 w-32" />
            <FormBody />
          </div>
        </div>
      );
    case "terminal":
      return (
        <div className="flex h-[calc(100dvh-9rem)] min-h-96 flex-col rounded-lg bg-card">
          <div className="flex h-12 items-center justify-between px-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="flex-1 space-y-4 p-6">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-3" />
          </div>
        </div>
      );
    case "resources":
      return (
        <>
          <Heading />
          <div className="space-y-4">
            {repeat(3, () => (
              <Resource />
            ))}
          </div>
        </>
      );
    case "overview":
      return (
        <>
          <Heading />
          <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {repeat(4, () => (
              <Panel>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
              </Panel>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Panel>
              <Chart />
            </Panel>
            <Panel>
              <Lines count={8} />
            </Panel>
          </div>
          <div className="mt-6">
            <Rows count={4} />
          </div>
        </>
      );
    case "writeups":
      return (
        <>
          <Heading />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel>
              <Document />
            </Panel>
            <Panel>
              <Filters />
              <Rows count={8} />
            </Panel>
          </div>
        </>
      );
    case "chart":
      return <Chart />;
    case "radar":
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-4">
          <Skeleton className="size-48 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      );
    case "tree-canvas":
      return <Tree />;
    case "rows":
      return <Rows count={5} />;
    case "resource":
      return <Resource />;
    case "posters":
      return <Cards posters count={2} />;
    case "activity":
      return (
        <div className="space-y-5 p-4">
          {repeat(4, () => (
            <div className="flex gap-3">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      );
    case "objective-nav":
      return (
        <div className="grid grid-cols-5 gap-2 p-2">
          {repeat(15, () => (
            <Skeleton className="h-9 w-full" />
          ))}
        </div>
      );
    case "console":
      return (
        <div className="space-y-4 p-6">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-3" />
        </div>
      );
    case "calendar":
      return <CalendarBody />;
    case "spectator":
      return (
        <div className="spectator-screen dark h-full min-h-[70dvh] bg-background p-5">
          <Skeleton className="mb-6 h-6 w-48" />
          <div className="grid h-[65dvh] gap-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-8">
              <Rows count={6} />
              <Lines count={4} />
            </div>
            <Scene />
          </div>
        </div>
      );
    case "scene":
      return <Scene stats={false} />;
    case "document":
      return <Document />;
    default:
      return (
        <div className="space-y-5 py-4">
          <Skeleton className="h-5 w-1/3" />
          <Lines />
          <Skeleton className="h-9 w-28" />
        </div>
      );
  }
}
function Document() {
  return (
    <div className="mx-auto aspect-[210/297] w-full max-w-3xl space-y-8 bg-card p-8">
      <Skeleton className="mx-auto h-7 w-1/2" />
      <Lines count={8} />
      <Skeleton className="h-36 w-full" />
      <Lines count={5} />
    </div>
  );
}
function Scene({ stats = true }: { stats?: boolean }) {
  return (
    <div className="relative h-full min-h-80 p-6">
      {stats && (
        <div className="mx-auto flex max-w-lg justify-between gap-5">
          {repeat(4, () => (
            <div className="space-y-3">
              <Skeleton className="h-8 w-12" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      )}
      <Skeleton className="absolute inset-x-6 bottom-6 top-28" />
    </div>
  );
}

export function ContentSkeleton({
  kind = "content",
  fullPage = false,
  shell,
  className,
}: {
  kind?: SkeletonKind;
  fullPage?: boolean;
  shell?: "admin" | "management";
  className?: string;
}) {
  const body = <Body kind={kind} />;
  return (
    <div
      role="status"
      aria-label="加载中"
      aria-busy="true"
      data-skeleton={kind}
      className={cn(
        "w-full min-w-0",
        fullPage && "min-h-[55dvh]",
        shell && "h-full",
        className,
      )}
    >
      <span className="sr-only">加载中</span>
      <div
        aria-hidden="true"
        className={shell ? "flex h-full min-h-0 overflow-hidden" : undefined}
      >
        {shell ? (
          <>
            <div
              className={cn(
                "hidden shrink-0 space-y-8 bg-card p-5 md:block",
                shell === "admin" ? "w-56" : "w-48",
              )}
            >
              <Skeleton className="h-7 w-28" />
              {repeat(shell === "admin" ? 4 : 2, () => (
                <div className="space-y-4">
                  <Skeleton className="h-3 w-12" />
                  {repeat(3, () => (
                    <Skeleton className="h-7 w-full" />
                  ))}
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              {shell === "admin" && (
                <div className="flex h-12 items-center bg-card px-8">
                  <Skeleton className="h-4 w-48" />
                </div>
              )}
              <div className="p-4 sm:p-6 lg:p-8">{body}</div>
            </div>
          </>
        ) : (
          body
        )}
      </div>
    </div>
  );
}
