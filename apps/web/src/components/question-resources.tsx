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
export function QuestionResources({
  challenge: c,
  scope,
}: {
  challenge: Challenge;
  scope: string;
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
      {container && c.challenge_type !== "awd" && (
        <ResourceLaunch challenge={c} scope={scope} type="container" />
      )}
      {(attachment || c.attachments.length > 0) && (
        <section aria-label="附件" className="divide-y">
          {attachment && (
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
  const policy = useAPI<{ next_operation_at: string | null }>(
    `/challenges/${c.id}/instance-policy?scope=${scope}&resource_type=${type}`,
    !!user,
  );
  const start = useAction(
    () =>
      api(`/challenges/${c.id}/instances`, "POST", {
        scope,
        resource_type: type,
      }),
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
          <QueryState
            loading={instances.isLoading}
            error={instances.error}
            retry={() => void instances.refetch()}
          />
          {current && !canStart && (
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
                </ItemContent>
                <ItemActions className="ml-auto max-sm:w-full max-sm:justify-end">
                  <Button
                    variant={error ? "default" : "secondary"}
                    disabled={
                      start.isPending ||
                      cooldown > 0 ||
                      policy.isLoading ||
                      policy.isError
                    }
                    onClick={() => start.mutate()}
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
                    completeLabel="已加入队列"
                  />
                  {error && !start.isPending && <ResourceError error={error} />}{" "}
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
    </div>
  );
}
