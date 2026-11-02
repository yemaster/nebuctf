import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Eye, Settings2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useUser } from "@/App";
import { can } from "@/lib/access-control";
import { api, useAPI, useAction } from "@/lib/api";
import { date } from "@/lib/utils";
import { useDraft } from "@/lib/use-draft";
import {
  Field,
  PageTitle,
  QueryState,
  Table,
  Empty,
  Pagination,
} from "@/components/shared";
import { useAdminList } from "@/components/admin/shared";
import { ConfigCard } from "@/components/admin/config-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type Policy = {
  enabled: boolean;
  capture_enabled: boolean;
  sample_seconds: number;
  retention_days: number;
  instance_mib: number;
  total_mib: number;
  capture_limit: number;
  snap_length: number;
};
type Resource = {
  id: string;
  title: string;
  team_name: string;
  endpoint: string | null;
  status: string;
  rx_bytes: string;
  tx_bytes: string;
  rx_rate: number;
  tx_rate: number;
  sampled_at: string | null;
  capture_status: string;
  capture_error: string | null;
  files: number;
};
const statuses: Record<string, string> = {
  off: "未开启",
  stopped: "已停止",
  running: "采集中",
  starting: "启动中",
  queued: "等待采集",
  limited: "容量已满",
  failed: "采集失败",
};
function bytes(value: number | string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
  return `${(n / 1073741824).toFixed(2)} GiB`;
}
function Summary({
  received,
  sent,
  rx_rate,
  tx_rate,
}: {
  received: string;
  sent: string;
  rx_rate: number;
  tx_rate: number;
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[
        ["接收", bytes(received)],
        ["发送", bytes(sent)],
        ["接收速率", `${bytes(rx_rate)}/s`],
        ["发送速率", `${bytes(tx_rate)}/s`],
      ].map(([label, value]) => (
        <div className="rounded-lg bg-card p-5" key={label}>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 font-mono text-xl font-semibold tabular-nums">
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
export function TrafficOverview() {
  const user = useUser(),
    { params, page, setPage, filter } = useAdminList();
  const query = useAPI<{
    items: { id: string; title: string; running: number }[];
    total: number;
  }>(`/admin/traffic/contests?${params}`);
  return (
    <>
      <PageTitle>流量监测</PageTitle>
      <Tabs defaultValue="contests">
        <TabsList variant="line">
          <TabsTrigger value="contests">比赛</TabsTrigger>
          {can(user, "traffic.read") && (
            <TabsTrigger value="settings">采集策略</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="contests">
          <Input
            placeholder="搜索比赛"
            aria-label="搜索比赛"
            className="mb-4 max-w-sm"
            value={params.get("q") ?? ""}
            onChange={(e) => filter("q", e.target.value)}
          />
          <QueryState
            loading={query.isLoading}
            error={query.error}
            retry={() => void query.refetch()}
          />
          {query.data && (
            <>
              <Table headers={["比赛", "运行靶机", "操作"]}>
                {query.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>{c.running}</TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          to={`/contests/${c.id}/manage/traffic`}
                          aria-label={`查看 ${c.title}流量`}
                        >
                          <Eye />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
              <Pagination
                page={page}
                setPage={setPage}
                total={query.data.total}
                pageSize={10}
                hasMore={page * 10 < query.data.total}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="settings">
          <TrafficSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}
function TrafficSettings() {
  const query = useAPI<Policy>("/admin/settings/traffic");
  if (!query.data || query.error)
    return (
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return <PolicyForm data={query.data} />;
}
function PolicyForm({ data }: { data: Policy }) {
  const user = useUser(),
    [value, setValue, clear] = useDraft(`traffic-policy:${user?.id}`, data),
    write = can(user, "traffic.write");
  const save = useAction(
    () => api("/admin/settings/traffic", "PUT", value),
    () => {
      clear();
      toast.success("采集策略已保存");
    },
  );
  return (
    <ConfigCard>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!write || save.isPending} className="space-y-5">
          <div className="flex flex-wrap gap-6">
            {(
              [
                ["enabled", "流量监测"],
                ["capture_enabled", "默认开启抓包"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 text-sm">
                <Switch
                  checked={value[key]}
                  onCheckedChange={(v) => setValue({ ...value, [key]: v })}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["sample_seconds", "采样间隔（秒）", 10, 120],
                ["retention_days", "保留天数", 1, 30],
                ["instance_mib", "单靶机容量（MiB）", 8, 1024],
                ["total_mib", "总容量（MiB）", 64, 102400],
                ["capture_limit", "同时采集靶机数", 1, 32],
                ["snap_length", "单包截取长度（字节）", 128, 65535],
              ] as const
            ).map(([key, label, min, max]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  required
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            PCAP 按靶机归档并轮转。关闭监测后停止采集，已有文件按保留期限清理。
          </p>
          {write && (
            <Button type="submit">
              <Settings2 />
              保存策略
            </Button>
          )}
        </fieldset>
      </form>
    </ConfigCard>
  );
}
export function ContestTraffic() {
  const { id } = useParams(),
    user = useUser(),
    { params, page, setPage, filter } = useAdminList();
  const query = useAPI<{
    contest: { title: string; traffic_mode: string };
    policy: Policy;
    summary: {
      received: string;
      sent: string;
      rx_rate: number;
      tx_rate: number;
    };
    items: Resource[];
    total: number;
  }>(`/admin/contests/${id}/traffic?${params}`, true, 10000);
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const data = query.data;
  return (
    <>
      <PageTitle>流量监测</PageTitle>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜索战队或题目"
          aria-label="搜索战队或题目"
          value={params.get("q") ?? ""}
          onChange={(e) => filter("q", e.target.value)}
          className="max-w-sm"
        />
        {can(user, "traffic.write", id) && (
          <ContestCapturePolicy
            key={data.contest.traffic_mode}
            id={id!}
            mode={data.contest.traffic_mode}
          />
        )}
        {!data.policy.enabled && (
          <Badge variant="secondary">全局监测已关闭</Badge>
        )}
      </div>
      <Summary {...data.summary} />
      <Table
        headers={[
          "战队 / 题目",
          "接收",
          "发送",
          "速率（收 / 发）",
          "抓包",
          "操作",
        ]}
      >
        {data.items.map((i) => (
          <TableRow key={i.id}>
            <TableCell>
              <div className="font-medium">{i.team_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {i.title}
              </div>
              {i.endpoint && (
                <code className="mt-1 block max-w-64 break-all text-xs text-muted-foreground">
                  {i.endpoint}
                </code>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {bytes(i.rx_bytes)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {bytes(i.tx_bytes)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {bytes(i.rx_rate)}/s
              <br />
              {bytes(i.tx_rate)}/s
            </TableCell>
            <TableCell>
              <Badge variant="secondary">
                {statuses[i.capture_status] ?? "未开启"}
              </Badge>
              {i.capture_error && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {i.capture_error}
                </p>
              )}
            </TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="icon">
                <Link
                  to={`/contests/${id}/manage/traffic/${i.id}`}
                  aria-label={`查看 ${i.team_name} ${i.title}流量`}
                >
                  <Eye />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {!data.items.length && <Empty>暂无监测记录</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.total}
        pageSize={10}
        hasMore={page * 10 < data.total}
      />
    </>
  );
}
function ContestCapturePolicy({ id, mode }: { id: string; mode: string }) {
  const [value, setValue] = useState(mode),
    save = useAction(
      () => api(`/admin/contests/${id}/traffic/policy`, "PUT", { mode: value }),
      () => toast.success("采集设置已保存"),
    );
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label="比赛采集方式"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <NativeSelectOption value="inherit">沿用全局策略</NativeSelectOption>
        <NativeSelectOption value="off">关闭监测</NativeSelectOption>
        <NativeSelectOption value="stats">仅流量统计</NativeSelectOption>
        <NativeSelectOption value="capture">统计与抓包</NativeSelectOption>
      </NativeSelect>
      <Button
        variant="outline"
        disabled={save.isPending || mode === value}
        onClick={() => save.mutate()}
      >
        保存
      </Button>
    </div>
  );
}
export function TrafficDetail() {
  const { id, instance } = useParams(),
    { page, setPage } = useAdminList();
  const query = useAPI<{
    instance: Resource;
    timeline: { bucket: string; rx_bytes: string; tx_bytes: string }[];
    files: { id: string; size: string; created_at: string }[];
    total: number;
  }>(
    `/admin/contests/${id}/traffic/instances/${instance}?page=${page}`,
    true,
    10000,
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(file: string) {
    setDownloading(file);
    try {
      const response = await fetch(
        `/api/admin/contests/${id}/traffic/files/${file}`,
      );
      if (!response.ok)
        throw Error((await response.json()).error ?? "下载失败");
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `capture-${file}.pcap`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const data = query.data,
    i = data.instance;
  return (
    <>
      <PageTitle
        action={
          <Button asChild variant="outline">
            <Link to={`/contests/${id}/manage/traffic`}>
              <ArrowLeft />
              返回流量监测
            </Link>
          </Button>
        }
      >
        {i.team_name} / {i.title}
      </PageTitle>
      <Summary
        received={i.rx_bytes}
        sent={i.tx_bytes}
        rx_rate={i.rx_rate}
        tx_rate={i.tx_rate}
      />
      <ConfigCard>
        <h2 className="mb-4 font-medium">最近一小时</h2>
        {data.timeline.length ? (
          <ChartContainer
            className="h-60 w-full"
            config={{
              rx: { label: "接收", color: "var(--primary)" },
              tx: { label: "发送", color: "var(--color-blue-500)" },
            }}
          >
            <AreaChart
              data={data.timeline.map((p) => ({
                time: Date.parse(p.bucket),
                rx: Number(p.rx_bytes),
                tx: Number(p.tx_bytes),
              }))}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={bytes}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_v, payload) =>
                      new Date(
                        Number(payload[0]?.payload?.time),
                      ).toLocaleTimeString("zh-CN")
                    }
                    formatter={(v, name) => (
                      <span>
                        {name === "rx" ? "接收" : "发送"} {bytes(Number(v))}
                      </span>
                    )}
                  />
                }
              />
              <Area
                dataKey="rx"
                stroke="var(--color-rx)"
                fill="var(--color-rx)"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
              <Area
                dataKey="tx"
                stroke="var(--color-tx)"
                fill="var(--color-tx)"
                fillOpacity={0.08}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <Empty>等待流量采样</Empty>
        )}
      </ConfigCard>
      <div className="mt-6">
        <h2 className="mb-4 flex items-center gap-3 font-medium">
          PCAP{" "}
          <Badge variant="secondary">
            {statuses[i.capture_status] ?? "未开启"}
          </Badge>
        </h2>
        <Table headers={["采集时间", "大小", "操作"]}>
          {data.files.map((file) => (
            <TableRow key={file.id}>
              <TableCell>{date(file.created_at)}</TableCell>
              <TableCell className="font-mono text-xs">
                {bytes(file.size)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="下载 PCAP"
                  disabled={!!downloading}
                  onClick={() => void download(file.id)}
                >
                  <Download />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </Table>
        {!data.files.length && (
          <Empty>
            {i.capture_status === "running"
              ? "采集中，文件封存后可下载"
              : "暂无抓包文件"}
          </Empty>
        )}
        <Pagination
          page={page}
          setPage={setPage}
          total={data.total}
          pageSize={10}
          hasMore={page * 10 < data.total}
        />
      </div>
    </>
  );
}
