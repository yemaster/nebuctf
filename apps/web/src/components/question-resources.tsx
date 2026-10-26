import { Link, useLocation } from "react-router-dom";
import { FileArchive, Server, RotateCw } from "lucide-react";
import { useUser } from "@/App";
import { api, ApiError, useAPI, useAction } from "@/lib/api";
import { useVisibleInstances, useResourceCooldown } from "@/lib/instances";
import type { Challenge, Instance } from "@/lib/types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemFooter,
} from "./ui/item";
import { DownloadButton } from "./download-button";
import { OperationProgress } from "./operation-progress";
import { ResourceError } from "./resource-error";
import { QueryState } from "./shared";
import { InstanceRow } from "@/pages/Instances";
import { useState } from "react";
import { ConfirmAction } from "./confirm-action";
export function QuestionResources({
  challenge: c,
  scope,
  accessNotice,
}: {
  challenge: Challenge;
  scope: string;
  accessNotice?: { message: string; label: string; href: string } | null;
}) {
  const container = c.resources
      ? !!c.resources.container
      : c.kind.endsWith("_container"),
    attachment = c.resources
      ? !!c.resources.attachment
      : c.kind === "dynamic_attachment";
  if (
    !c.attachments.length &&
    (!container || c.challenge_type === "awd") &&
    !attachment
  )
    return null;
  return (
    <section
      aria-label="题目资源"
      className="divide-y overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/60"
    >
      {accessNotice && (container || attachment) ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <Server className="size-4 shrink-0" />
            {accessNotice.message}
          </span>
          <Button variant="secondary" size="sm" asChild>
            <Link to={accessNotice.href}>{accessNotice.label}</Link>
          </Button>
        </div>
      ) : (
        container &&
        c.challenge_type !== "awd" && (
          <ResourceLaunch challenge={c} scope={scope} type="container" />
        )
      )}
      {(attachment || c.attachments.length > 0) && (
        <section aria-label="附件" className="divide-y">
          {attachment && !accessNotice && (
            <ResourceLaunch challenge={c} scope={scope} type="attachment" />
          )}
          {c.attachments.map((a) => (
            <DownloadButton
              key={a.id}
              href={`/api/attachments/${a.id}?scope=${scope}`}
              name={a.name}
              size={a.size}
              row
            />
          ))}
        </section>
      )}
    </section>
  );
}

function ResourceLaunch({
  challenge: c,
  scope,
  type,
}: {
  challenge: Challenge;
  scope: string;
  type: "container" | "attachment";
}) {
  const user = useUser(),
    location = useLocation(),
    attachment = type === "attachment",
    title = attachment ? "专属附件" : "靶机";
  const instances = useAPI<{ items: Instance[] }>(
    `/instances?scope=${scope}`,
    !!user,
    5000,
  );
  const policy = useAPI<{
    next_operation_at: string | null;
    auto_destroy?: boolean;
    quota?: {
      team_used: number;
      team_limit: number | null;
      total_used: number;
      total_limit: number | null;
      blocked: {
        message: string;
        action: { label: string; href: string };
      } | null;
    } | null;
  }>(
    `/challenges/${c.id}/instance-policy?scope=${scope}&resource_type=${type}`,
    !!user,
    5000,
  );
  const canReplace =
    !!policy.data?.auto_destroy &&
    policy.data.quota?.team_limit !== 0 &&
    policy.data.quota?.total_limit !== 0;
  const [replacements, setReplacements] = useState<
    { id: string; title: string }[] | null
  >(null);
  const start = useAction(
    async (replace_ids: string[] = []) => {
      const result = await api<{
        requires_confirmation?: boolean;
        replacements?: { id: string; title: string }[];
      }>(`/challenges/${c.id}/instances`, "POST", {
        scope,
        resource_type: type,
        replace_ids,
      });
      setReplacements(
        result.requires_confirmation ? result.replacements! : null,
      );
    },
    undefined,
    false,
  );
  const cooldown = useResourceCooldown(
    policy.data?.next_operation_at,
    start.error instanceof ApiError ? start.error.retryAfter : undefined,
  );
  const visible = useVisibleInstances(
    instances.data?.items,
    `${scope}:${user?.id}`,
  );
  const current = visible.find(
    (i) =>
      i.challenge_id === c.id &&
      (i.resource_type ??
        (i.kind === "dynamic_attachment" ? "attachment" : "container")) ===
        type,
  );
  const canStart = !current || ["failed", "stopped"].includes(current.status),
    error =
      start.error ??
      (current?.status === "failed"
        ? current.error || (attachment ? "附件生成失败" : "靶机启动失败")
        : null);
  const shared =
    !attachment &&
    (c.resources
      ? c.resources.container?.mode === "public"
      : c.kind === "static_container");
  return (
    <div aria-label={title}>
      {!user ? (
        <Button variant="secondary" asChild className="m-5">
          <Link
            to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
          >
            登录后使用
          </Link>
        </Button>
      ) : (
        <>
          {instances.error ? (
            <div className="flex items-start gap-3 p-5">
              <ResourceError error={instances.error} />
              <Button
                variant="secondary"
                size="sm"
                disabled={instances.isFetching}
                onClick={() => void instances.refetch()}
              >
                重试
              </Button>
            </div>
          ) : (
            <QueryState loading={instances.isLoading} error={null} />
          )}
          {current && !canStart && !instances.error && (
            <InstanceRow key={current.id} instance={current} compact />
          )}
          {canStart &&
            !instances.isLoading &&
            !instances.error &&
            (shared && user.role !== "admin" ? (
              <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
                <h2 className="font-medium">靶机</h2>
                <span className="text-sm text-muted-foreground">尚未启动</span>
              </div>
            ) : (
              <Item
                className="w-full items-center gap-4 rounded-none border-0 p-5 sm:p-6"
                aria-label={title}
              >
                <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
                  {attachment ? (
                    <FileArchive className="size-5" />
                  ) : (
                    <Server className="size-5" />
                  )}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="flex-wrap gap-3 text-base">
                    {title}
                    {error && !start.isPending && (
                      <Badge variant="secondary" className="text-destructive">
                        {attachment ? "生成失败" : "启动失败"}
                      </Badge>
                    )}
                  </ItemTitle>
                  {policy.data?.quota?.team_limit != null && (
                    <p className="text-xs text-muted-foreground">
                      本队 {policy.data.quota.team_used} /{" "}
                      {policy.data.quota.team_limit}
                    </p>
                  )}
                </ItemContent>
                <ItemActions className="ml-auto max-sm:w-full max-sm:justify-end">
                  <Button
                    variant="default"
                    disabled={
                      start.isPending ||
                      cooldown > 0 ||
                      policy.isLoading ||
                      policy.isError ||
                      (!!policy.data?.quota?.blocked && !canReplace)
                    }
                    onClick={() => start.mutate([])}
                  >
                    {error ? (
                      <RotateCw />
                    ) : attachment ? (
                      <FileArchive />
                    ) : (
                      <Server />
                    )}
                    {cooldown
                      ? `${cooldown} 秒后可${attachment ? "生成" : "启动"}`
                      : start.isPending
                        ? "创建中"
                        : error
                          ? attachment
                            ? "重新生成"
                            : "重试启动"
                          : attachment
                            ? "生成附件"
                            : "启动靶机"}
                  </Button>
                </ItemActions>
                <ItemFooter className="flex-col items-stretch gap-3 empty:hidden">
                  <OperationProgress
                    busy={start.isPending}
                    failed={start.isError}
                    label={attachment ? "正在准备生成" : "正在准备环境"}
                    completeLabel={replacements ? "等待确认" : "已加入队列"}
                  />
                  {error &&
                    !start.isPending &&
                    !policy.data?.quota?.blocked && (
                      <ResourceError error={error} />
                    )}{" "}
                  {policy.data?.quota?.blocked && !canReplace && (
                    <ResourceError
                      error={
                        new ApiError(
                          policy.data.quota.blocked.message,
                          409,
                          policy.data.quota.blocked.action,
                        )
                      }
                    />
                  )}
                  {policy.error && (
                    <>
                      <ResourceError error={policy.error} />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="self-start"
                        onClick={() => void policy.refetch()}
                      >
                        重新检查状态
                      </Button>
                    </>
                  )}
                </ItemFooter>
              </Item>
            ))}
        </>
      )}
      <ConfirmAction
        open={!!replacements}
        onOpenChange={(open) => !open && setReplacements(null)}
        title="替换旧靶机"
        description="此次启动将销毁以下靶机，清理完成后创建新环境。"
        confirm="销毁并启动"
        pending={start.isPending}
        onConfirm={() => start.mutate(replacements!.map((i) => i.id))}
      >
        <ul className="divide-y rounded-lg bg-muted px-4">
          {replacements?.map((i) => (
            <li key={i.id} className="py-3 text-sm">
              {i.title}
            </li>
          ))}
        </ul>
        {start.error && <ResourceError error={start.error} />}
      </ConfirmAction>
    </div>
  );
}
