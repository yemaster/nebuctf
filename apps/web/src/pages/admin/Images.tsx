import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { useAdminList } from "@/components/admin/shared";
import {
  ImagePullButton,
  PullDialog,
  imageSize,
  imageState,
  type ImageRecord,
} from "@/components/admin/image-tools";
import { PageTitle, Pagination, QueryState, Empty } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function ImagesAdmin() {
  const { params, page, setPage, filter } = useAdminList();
  const data = useAPI<{
    items: ImageRecord[];
    total: number;
    worker: { online: boolean; checked_at?: string; error?: string };
  }>(`/admin/images?${params}`, true, 5000);
  const [jobId, setJobId] = useState<string | null>(null);
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新镜像列表"
            disabled={data.isFetching}
            onClick={() => void data.refetch()}
          >
            <RefreshCw
              className={data.isFetching ? "motion-safe:animate-spin" : ""}
            />
          </Button>
        }
      >
        Docker 镜像
      </PageTitle>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form
          key={params.get("q")}
          className="flex w-full gap-2 sm:w-96"
          onSubmit={(e) => {
            e.preventDefault();
            filter(
              "q",
              String(new FormData(e.currentTarget).get("q") ?? "").trim(),
            );
          }}
        >
          <Input
            name="q"
            aria-label="搜索镜像或题目"
            placeholder="搜索镜像或题目"
            defaultValue={params.get("q") ?? ""}
            maxLength={100}
          />
          <Button variant="secondary">搜索</Button>
        </form>
        <NativeSelect
          aria-label="镜像状态"
          value={params.get("state") ?? "all"}
          onChange={(e) => filter("state", e.target.value)}
        >
          <NativeSelectOption value="all">全部状态</NativeSelectOption>
          <NativeSelectOption value="present">已就绪</NativeSelectOption>
          <NativeSelectOption value="missing">未就绪</NativeSelectOption>
          <NativeSelectOption value="pulling">拉取中</NativeSelectOption>
        </NativeSelect>
        {data.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {data.data.worker.online
              ? `同步于 ${date(data.data.worker.checked_at!)}`
              : "Docker Worker 暂不可用"}
          </span>
        )}
      </div>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {data.data && (
        <div className="rounded-xl bg-card p-2 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>镜像</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">大小</TableHead>
                <TableHead className="text-right">关联题目数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.items.map((item) => (
                <TableRow key={item.image}>
                  <TableCell className="max-w-md whitespace-normal break-all">
                    <span className="text-sm font-medium">{item.image}</span>
                    {item.image_id && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.image_id.replace("sha256:", "").slice(0, 12)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        item.present
                          ? "text-success"
                          : item.job_status === "failed"
                            ? "text-destructive"
                            : ""
                      }
                    >
                      {imageState(item)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {imageSize(item.size)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.challenges.length}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {(!item.present ||
                        ["queued", "pulling"].includes(
                          item.job_status ?? "",
                        )) && (
                        <ImagePullButton
                          image={item.image}
                          working={["queued", "pulling"].includes(
                            item.job_status ?? "",
                          )}
                          jobId={item.job_id}
                          disabled={!data.data?.worker.online}
                          onOpen={setJobId}
                        />
                      )}
                      {item.job_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setJobId(item.job_id!)}
                        >
                          日志
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data.data.items.length && <Empty>没有符合条件的镜像</Empty>}
        </div>
      )}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        hasMore={page * 24 < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
      <PullDialog
        jobId={jobId}
        onClose={() => {
          setJobId(null);
          void data.refetch();
        }}
      />
    </>
  );
}
