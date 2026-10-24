import { endpointURL } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Copy,
  RotateCw,
  Square,
  ExternalLink,
  Server,
  FileArchive,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/App";
import { api, ApiError, useAction, useAPI } from "@/lib/api";
import type { Instance, Contest } from "@/lib/types";
import { statusNames } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemMedia,
  ItemActions,
  ItemFooter,
} from "@/components/ui/item";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Empty, LoginPrompt, PageTitle, QueryState } from "@/components/shared";
import { DownloadButton } from "@/components/download-button";
import { OperationProgress } from "@/components/operation-progress";
import { ResourceError } from "@/components/resource-error";
import { useVisibleInstances, useResourceCooldown } from "@/lib/instances";

export function InstanceRow({
  instance: i,
  compact = false,
}: {
  instance: Instance;
  compact?: boolean;
}) {
  const user = useUser();
  const cache = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [operation, setOperation] = useState<"renew" | "stop" | null>(null);
  const [renewedExpiry, setRenewedExpiry] = useState<string>();
  const [stopAccepted, setStopAccepted] = useState(false);
  const [copied, setCopied] = useState(false);
  const stop = useAction(
    async () => {
      setOperation("stop");
      renew.reset();
      await api(`/instances/${i.id}/stop`, "POST");
      setStopAccepted(true);
      cache.setQueriesData<{ items: Instance[] }>(
        {
          predicate: (query) =>
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith("/instances?scope="),
        },
        (old) =>
          old
            ? {
                ...old,
                items: old.items.map((row) =>
                  row.id === i.id ? { ...row, status: "stopping" } : row,
                ),
              }
            : old,
      );
    },
    undefined,
    false,
  );
  const renew = useAction(
    async () => {
      setOperation("renew");
      stop.reset();
      const result = await api<{ expires_at: string }>(
        `/instances/${i.id}/renew`,
        "POST",
      );
      setRenewedExpiry(result.expires_at);
    },
    undefined,
    false,
  );
  const cooldown = useResourceCooldown(
    i.next_operation_at,
    stop.error instanceof ApiError ? stop.error.retryAfter : undefined,
  );
  const alive = !["stopped", "failed"].includes(i.status);
  useEffect(() => {
    if (!alive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [alive]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const expires = Math.max(
    Date.parse(i.expires_at),
    Date.parse(renewedExpiry ?? i.expires_at),
  );
  const remaining = Math.max(0, Math.ceil((expires - now) / 1000));
  const counting = ["running", "ready"].includes(i.status);
  const expired = counting && remaining === 0;
  const lifetime = i.shared
    ? Math.max(1, (expires - Date.parse(i.created_at)) / 1000)
    : (i.ttl ?? Math.max(1, (expires - Date.parse(i.created_at)) / 1000));
  const canManage = !i.shared || user?.role === "admin";
  const stopping =
    i.status === "stopping" || (stopAccepted && alive) || expired;
  const busy =
    stop.isPending ||
    renew.isPending ||
    stopping ||
    ["queued", "starting"].includes(i.status);
  const attachment = i.kind === "dynamic_attachment";
  const label = renew.isPending
    ? "正在续期"
    : stop.isPending || stopping
      ? "正在释放环境"
      : i.status === "queued"
        ? "正在排队"
        : attachment
          ? "正在生成专属附件"
          : "正在启动靶机";
  const success =
    operation === "stop" || i.status === "stopped"
      ? "环境已释放"
      : operation === "renew"
        ? "续期完成"
        : attachment
          ? "专属附件已生成"
          : "靶机已就绪";
  const error =
    stop.error ??
    renew.error ??
    i.error ??
    (i.status === "failed" ? "环境启动失败，请重试" : undefined);
  const duration =
    remaining >= 3600
      ? `${Math.floor(remaining / 3600)}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`
      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const url = i.endpoint ? endpointURL(i.endpoint) : undefined;
  return (
    <Item
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 border-0 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-6 [&_[data-slot=item-footer]]:col-span-full ${compact ? "rounded-none bg-transparent" : "rounded-xl bg-card shadow-sm ring-1 ring-border/60"}`}
    >
      <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
        {attachment ? (
          <FileArchive className="size-5" />
        ) : (
          <Server className="size-5" />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-2">
        <ItemTitle className="w-full flex-wrap gap-3 text-base leading-6">
          <span className="break-words">
            {compact ? (attachment ? "专属附件" : "靶机") : i.title}
          </span>
          <Badge
            variant="secondary"
            className={
              i.status === "running" || i.status === "ready"
                ? "bg-success/10 text-success"
                : i.status === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : ""
            }
          >
            {stopping ? "回收中" : statusNames[i.status]}
          </Badge>
        </ItemTitle>
      </ItemContent>
      {alive && (
        <ItemActions className="col-span-full flex-wrap justify-end sm:col-span-1">
          {i.status === "ready" && !stopping && (
            <DownloadButton
              href={`/api/instances/${i.id}/artifact`}
              name="专属附件.zip"
              embedded
            />
          )}
          {canManage && (
            <>
              {i.status === "running" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => renew.mutate()}
                >
                  <RotateCw />
                  续期
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  stop.isPending || renew.isPending || stopping || cooldown > 0
                }
                onClick={() => stop.mutate()}
              >
                <Square />
                {cooldown
                  ? `${cooldown} 秒后可销毁`
                  : attachment
                    ? "删除"
                    : "销毁"}
              </Button>
            </>
          )}
        </ItemActions>
      )}
      {!compact && i.status === "failed" && (
        <ItemActions className="ml-auto">
          <Button size="sm" asChild>
            <Link
              to={
                !i.scope || i.scope === "practice"
                  ? `/challenges?challenge=${i.challenge_id}`
                  : `/contests/${i.scope}/challenges?challenge=${i.challenge_id}`
              }
            >
              <RotateCw />
              返回题目重试
            </Link>
          </Button>
        </ItemActions>
      )}
      {i.endpoint && i.status === "running" && !stopping && (
        <ItemFooter className="flex-wrap gap-3">
          <InputGroup className="h-11 min-w-0 flex-1 border-0 bg-muted/60 shadow-none">
            <InputGroupInput
              value={i.endpoint}
              readOnly
              aria-label="靶机连接地址"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label="复制地址"
                onClick={() =>
                  navigator.clipboard
                    .writeText(i.endpoint!)
                    .then(() => setCopied(true))
                    .catch(() => toast.error("复制失败，请手动选择地址"))
                }
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </InputGroupButton>
              {url && (
                <InputGroupButton size="icon-sm" asChild>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="打开靶机"
                    title="打开靶机"
                  >
                    <ExternalLink />
                  </a>
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </ItemFooter>
      )}
      {counting && !stopping && (
        <ItemFooter className="flex-col items-stretch gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>剩余时间</span>
            <span className="tabular-nums">{duration}</span>
          </div>
          <Progress
            aria-label={attachment ? "附件剩余时间" : "靶机剩余时间"}
            aria-valuetext={`剩余 ${duration}`}
            value={Math.min(100, (remaining / lifetime) * 100)}
            className={
              remaining < 300
                ? "h-1.5 bg-warning/15 [&_[data-slot=progress-indicator]]:bg-warning"
                : "h-1.5"
            }
          />
        </ItemFooter>
      )}
      <div className="col-span-full w-full empty:hidden">
        <OperationProgress
          busy={busy}
          failed={!!error || i.status === "failed"}
          label={label}
          completeLabel={success}
        />
      </div>
      {error && (
        <ItemFooter>
          <ResourceError error={error} />
        </ItemFooter>
      )}
    </Item>
  );
}
export function ScopeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const contests = useAPI<{ items: Contest[] }>("/contests");
  return (
    <NativeSelect
      aria-label="选择赛场"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <NativeSelectOption value="practice">练习场</NativeSelectOption>
      {contests.data?.items.map((c) => (
        <NativeSelectOption key={c.id} value={c.id}>
          {c.title}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
export function Instances({ scope: contestScope }: { scope?: string }) {
  const [params] = useSearchParams(),
    user = useUser();
  const [selectedScope, setScope] = useState(params.get("scope") ?? "practice");
  const scope = contestScope ?? selectedScope;
  const data = useAPI<{ items: Instance[] }>(
    `/instances?scope=${scope}&owned=true`,
    !!user,
    5000,
  );
  const rows = useVisibleInstances(data.data?.items, `${scope}:${user?.id}`);
  if (!user) return <LoginPrompt />;
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
      <PageTitle
        action={
          contestScope ? undefined : (
            <ScopeSelect value={scope} onChange={setScope} />
          )
        }
      >
        我的靶机
      </PageTitle>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {!data.isLoading &&
        !data.error &&
        (rows.length ? (
          <div className="grid items-start gap-6 xl:grid-cols-2">
            {rows.map((i) => (
              <InstanceRow key={i.id} instance={i} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4">
            <Empty>暂无运行中的环境</Empty>
            <Button variant="secondary" asChild>
              <Link
                to={
                  scope === "practice"
                    ? "/challenges"
                    : `/contests/${scope}/challenges`
                }
              >
                前往赛题
              </Link>
            </Button>
          </div>
        ))}
    </>
  );
}
