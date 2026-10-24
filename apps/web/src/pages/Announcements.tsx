import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAPI } from "@/lib/api";
import type { Announcement } from "@/lib/types";
import { date } from "@/lib/utils";
import { Empty, PageTitle, QueryState } from "@/components/shared";

export function Announcements({ scope }: { scope?: string }) {
  const data = useAPI<{ items: Announcement[] }>(
    scope ? `/announcements?scope=${scope}` : "/announcements",
  );
  const { hash } = useLocation();
  useEffect(() => {
    const announcement = data.data?.items.find(
      (a) => hash === `#announcement-${a.id}`,
    );
    if (!announcement) return;
    const target = document.getElementById(`announcement-${announcement.id}`);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [hash, data.data]);
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
      <PageTitle>公告</PageTitle>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      <div className="max-w-5xl space-y-6">
        {data.data?.items.map((a) => (
          <article
            key={a.id}
            id={`announcement-${a.id}`}
            tabIndex={-1}
            className="scroll-mt-6 space-y-5 rounded-xl bg-card p-6 ring-1 ring-border/60 sm:p-8 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 className="text-xl font-medium">{a.title}</h2>
              <time className="text-sm text-muted-foreground">
                {date(a.created_at)}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words leading-8 text-muted-foreground">
              {a.body}
            </p>
          </article>
        ))}
      </div>
      {data.data?.items.length === 0 && <Empty>暂无公告</Empty>}
    </>
  );
}
