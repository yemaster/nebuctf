import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { PageTitle, QueryState, Empty } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
type OverviewData = {
  users: number;
  teams: number;
  challenges: number;
  published_challenges: number;
  active_contests: number;
  pending_registrations: number;
  new_users: number;
  activity: { day: string; submissions: number; correct: number }[];
  categories: { category: string; count: number }[];
  resources: {
    n: number;
    cpu: number;
    memory: number;
    limits: { n: number | null; cpu: number; memory: number };
    states: { resource_type: string; status: string; count: number }[];
  };
  failures: { id: string; title: string; error: string; updated_at: string }[];
  ai: { requests: number; failed: number; tokens: number };
  worker_at: string | null;
  sampled_at: string;
};
export function AdminOverview() {
  const [days, setDays] = useState("7"),
    query = useAPI<OverviewData>(`/admin/overview?days=${days}`, true, 30000);
  const data = query.data;
  if (!data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const totals = data.activity.reduce(
    (v, d) => ({
      submissions: v.submissions + d.submissions,
      correct: v.correct + d.correct,
    }),
    { submissions: 0, correct: 0 },
  );
  const healthy =
    data.worker_at &&
    Date.parse(data.sampled_at) - Date.parse(data.worker_at) < 60000;
  return (
    <>
      <PageTitle
        action={
          <div className="flex gap-2">
            <ToggleGroup
              type="single"
              value={days}
              onValueChange={(v) => v && setDays(v)}
              aria-label="统计周期"
            >
              <ToggleGroupItem value="7">7 天</ToggleGroupItem>
              <ToggleGroupItem value="30">30 天</ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新概览"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        }
      >
        概览
      </PageTitle>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[
            {
              name: "用户",
              value: data.users,
              note: `近 ${days} 天新增 ${data.new_users}`,
              href: "/admin/users",
            },
            {
              name: "战队",
              value: data.teams,
              note: `${data.pending_registrations} 份报名待审核`,
              href: "/admin/contests",
            },
            {
              name: "题目",
              value: data.challenges,
              note: `${data.published_challenges} 道已启用`,
              href: "/admin/challenges",
            },
            {
              name: "进行中比赛",
              value: data.active_contests,
              note: `近 ${days} 天 ${totals.submissions} 次提交`,
              href: "/admin/contests",
            },
          ].map((item) => (
            <Link
              key={item.name}
              to={item.href}
              className="group space-y-3 rounded-xl bg-card p-5 shadow-sm transition-colors hover:bg-accent/50"
            >
              <div className="flex justify-between text-sm text-muted-foreground">
                {item.name}
                <ArrowUpRight className="size-4" />
              </div>
              <div className="text-3xl font-semibold tabular-nums">
                {item.value.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">{item.note}</p>
            </Link>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)]">
          <section className="min-w-0 space-y-5 rounded-xl bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">提交趋势</h2>
              <span className="text-sm text-muted-foreground">
                正确率{" "}
                {totals.submissions
                  ? ((totals.correct / totals.submissions) * 100).toFixed(1)
                  : "0"}
                %
              </span>
            </div>
            <ChartContainer
              config={{
                submissions: { label: "提交", color: "var(--chart-1)" },
                correct: { label: "正确", color: "var(--chart-2)" },
              }}
              className="h-64 w-full aspect-auto"
            >
              <AreaChart
                data={data.activity}
                accessibilityLayer
                margin={{ left: -20, right: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(v) => v.slice(5)}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  type="monotone"
                  dataKey="submissions"
                  stroke="var(--color-submissions)"
                  fill="var(--color-submissions)"
                  fillOpacity={0.1}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="correct"
                  stroke="var(--color-correct)"
                  fill="var(--color-correct)"
                  fillOpacity={0.1}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              按 UTC 日期统计，包含练习与比赛提交。
            </p>
          </section>
          <section className="space-y-5 rounded-xl bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">资源占用</h2>
              <Badge
                variant="secondary"
                className={healthy ? "text-success" : "text-muted-foreground"}
              >
                {healthy ? "Worker 在线" : "Worker 未连接"}
              </Badge>
            </div>
            <div className="space-y-5">
              {(
                [
                  ["n", "容器名额", ""],
                  ["cpu", "CPU 配额", " 毫核"],
                  ["memory", "内存配额", " MiB"],
                ] as const
              ).map(([key, label, unit]) => (
                <div key={key} className="space-y-2">
                  <div className="flex justify-between gap-4 text-sm">
                    <span>{label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {data.resources[key]} /{" "}
                      {data.resources.limits[key] ?? "不限"}
                      {unit}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(
                      100,
                      data.resources.limits[key] == null
                        ? 0
                        : (data.resources[key] / data.resources.limits[key]!) *
                            100,
                    )}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {[
                ["运行", ["running"]],
                ["处理中", ["queued", "starting", "stopping"]],
                ["就绪附件", ["ready"]],
              ].map(([label, statuses]) => (
                <span key={String(label)}>
                  {label}{" "}
                  {data.resources.states
                    .filter((s) => (statuses as string[]).includes(s.status))
                    .reduce((n, s) => n + s.count, 0)}
                </span>
              ))}
            </div>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/admin/resources">管理资源</Link>
            </Button>
          </section>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl bg-card p-5 shadow-sm sm:p-6">
            <h2 className="font-medium">题目分类</h2>
            {data.categories.length ? (
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {data.categories.map((row) => (
                  <div
                    key={row.category}
                    className="flex justify-between gap-4 text-sm"
                  >
                    <span>{row.category}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>还没有题目</Empty>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
              <Link className="hover:underline" to="/admin/ai">
                AI 转发
              </Link>
              <span className="text-muted-foreground">
                {data.ai.requests} 次调用 / {data.ai.failed} 次失败 /{" "}
                {Number(data.ai.tokens).toLocaleString()} tokens
              </span>
            </div>
          </section>
          <section className="space-y-4 rounded-xl bg-card p-5 shadow-sm sm:p-6">
            <h2 className="font-medium">最近环境异常</h2>
            {data.failures.length ? (
              <div className="divide-y">
                {data.failures.map((row) => (
                  <Link
                    key={row.id}
                    to="/admin/resources"
                    className="block space-y-1 py-3 first:pt-0"
                  >
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium">{row.title}</span>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {date(row.updated_at)}
                      </time>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.error}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>暂无环境异常</Empty>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
