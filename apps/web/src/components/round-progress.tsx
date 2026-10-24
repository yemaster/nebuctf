import { useEffect, useState } from "react";
import { useAPI } from "@/lib/api";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { QueryState } from "./shared";
type Data = {
  round: {
    number: number;
    starts_at: string;
    ends_at: string;
    status: string;
  } | null;
  total: number;
  history: { number: number; points: number }[];
};
export function RoundProgress({
  id,
  scope,
  carry,
}: {
  id: string;
  scope: string;
  carry: boolean;
}) {
  const query = useAPI<Data>(
      `/challenges/${id}/rounds?scope=${scope}`,
      true,
      5000,
    ),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const r = query.data?.round,
    seconds = r
      ? Math.max(0, Math.ceil((Date.parse(r.ends_at) - now) / 1000))
      : 0;
  return (
    <section
      aria-label="轮次计分"
      className="space-y-4 rounded-lg bg-muted/30 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">{r ? `第 ${r.number} 轮` : "轮次计分"}</h2>
        <Badge variant="secondary">累计 {query.data?.total ?? 0} 分</Badge>
      </div>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {r && seconds > 0 && (
        <>
          <Progress
            value={
              ((seconds * 1000) /
                (Date.parse(r.ends_at) - Date.parse(r.starts_at))) *
              100
            }
            aria-label="本轮剩余时间"
          />
          <div className="flex justify-between gap-4 text-xs text-muted-foreground">
            <span>{carry ? "解出后逐轮得分" : "每轮需重新提交"}</span>
            <span>
              {Math.floor(seconds / 60)} 分 {seconds % 60} 秒
            </span>
          </div>
        </>
      )}
      {r && !seconds && (
        <p className="text-sm text-muted-foreground">等待轮次结算</p>
      )}
      {!!query.data?.history.length && (
        <details>
          <summary className="cursor-pointer text-sm">最近轮次得分</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {query.data.history.map((row) => (
              <div key={row.number} className="flex justify-between text-sm">
                <dt className="text-muted-foreground">第 {row.number} 轮</dt>
                <dd>{row.points} 分</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
