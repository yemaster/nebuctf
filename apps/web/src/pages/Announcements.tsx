import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAPI } from "@/lib/api";
import type { Announcement } from "@/lib/types";
import { AnnouncementMeta } from "@/components/announcement-meta";
import { Markdown } from "@/components/markdown";
import {
  Card,
  CardContent,
  CardHeader,
  CardFooter,
} from "@/components/ui/card";
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
      <div className="space-y-4">
        {data.data?.items.map((a) => (
          <article
            key={a.id}
            id={`announcement-${a.id}`}
            tabIndex={-1}
            className="scroll-mt-6 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="gap-4 border-0 py-6 shadow-sm">
              <CardHeader className="block">
                <h2 className="text-xl font-semibold">{a.title}</h2>
              </CardHeader>
              <CardContent className="[&_.markdown>:first-child]:mt-0 [&_.markdown>:last-child]:mb-0">
                <Markdown>{a.body}</Markdown>
              </CardContent>
              <CardFooter>
                <AnnouncementMeta notice={a} />
              </CardFooter>
            </Card>
          </article>
        ))}
      </div>
      {data.data?.items.length === 0 && <Empty>暂无公告</Empty>}
    </>
  );
}
