import { Copy, ExternalLink, RotateCw } from "lucide-react";
import { api, ApiError, useAPI, useAction } from "@/lib/api";
import { endpointURL } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "./ui/table";
import { QueryState } from "./shared";
import { ResourceError } from "./resource-error";
import { OperationProgress } from "./operation-progress";
type Arena = {
  resource_blocked?: {
    message: string;
    action: { label: string; href: string };
  } | null;
  round: { number: number; ends_at: string } | null;
  items: {
    team_id: string;
    name: string;
    instance_id: string | null;
    endpoint: string | null;
    status: string | null;
    own: boolean;
    health: string | null;
  }[];
  history: {
    number: number;
    points: number;
    details: {
      attack: number;
      defense: number;
      availability: number;
      health: string;
    };
  }[];
};
const health: Record<string, string> = {
  up: "正常",
  down: "异常",
  checking: "巡检中",
  error: "巡检失败",
};
export function AwdArena({ id, scope }: { id: string; scope: string }) {
  const query = useAPI<Arena>(
      `/challenges/${id}/arena?scope=${scope}`,
      true,
      5000,
    ),
    restart = useAction(
      () => api(`/challenges/${id}/restart`, "POST", { scope }),
      undefined,
      false,
    );
  return (
    <section aria-label="AWD 对抗环境" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">对抗环境</h2>
        {query.data?.round && (
          <Badge variant="secondary">
            第 {query.data.round.number} 轮，
            {new Date(query.data.round.ends_at).toLocaleTimeString()} 结束
          </Badge>
        )}
      </div>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {query.data?.resource_blocked && (
        <ResourceError
          error={
            new ApiError(
              query.data.resource_blocked.message,
              409,
              query.data.resource_blocked.action,
            )
          }
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>战队</TableHead>
            <TableHead>服务</TableHead>
            <TableHead>地址</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.items.map((i) => (
            <TableRow key={i.team_id}>
              <TableCell className="font-medium">
                {i.name}
                {i.own && (
                  <Badge variant="secondary" className="ml-2">
                    我的战队
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <span
                  className={
                    i.health === "up"
                      ? "text-success"
                      : i.health === "down"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {health[i.health ?? ""] ??
                    (i.status === "failed" ? "启动失败" : "准备中")}
                </span>
              </TableCell>
              <TableCell className="break-all font-mono text-xs">
                {i.endpoint ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {i.endpoint && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`复制 ${i.name} 靶机地址`}
                        onClick={() =>
                          void navigator.clipboard.writeText(i.endpoint!)
                        }
                      >
                        <Copy />
                      </Button>
                      {endpointURL(i.endpoint) && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={endpointURL(i.endpoint)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`打开 ${i.name} 靶机`}
                          >
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </>
                  )}
                  {i.own && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="重启我的靶机"
                      disabled={
                        restart.isPending ||
                        ["starting", "stopping", "queued"].includes(
                          i.status ?? "",
                        )
                      }
                      onClick={() => restart.mutate()}
                    >
                      <RotateCw />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <OperationProgress
        busy={restart.isPending}
        failed={restart.isError}
        label="正在重启靶机"
        completeLabel="已提交重启"
      />
      {restart.error && <ResourceError error={restart.error} />}
      {!!query.data?.history.length && (
        <details className="rounded-lg bg-muted/30 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            最近轮次得分
          </summary>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                {["轮次", "攻击", "防守", "服务可用", "合计"].map((t) => (
                  <TableHead key={t}>{t}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.history.map((r) => (
                <TableRow key={r.number}>
                  <TableCell>{r.number}</TableCell>
                  <TableCell>{r.details.attack}</TableCell>
                  <TableCell>{r.details.defense}</TableCell>
                  <TableCell>{r.details.availability}</TableCell>
                  <TableCell>{r.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      )}
    </section>
  );
}
