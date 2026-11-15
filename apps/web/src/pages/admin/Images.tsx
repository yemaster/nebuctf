import { ImageImportActions } from "@/components/admin/image-import-actions";
import { useManagementWrite } from "@/lib/use-management-access";
import { useUser } from "@/App";
import { can } from "@/lib/access-control";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, FileText, RefreshCw, Search } from "lucide-react";
import { useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { useAdminList, useEditorLink } from "@/components/admin/shared";
import {
  ImagePullButton,
  PullDialog,
  imageSize,
  ImageStatus,
  type ImageRecord,
} from "@/components/admin/image-tools";
import { PageTitle, Pagination, QueryState, Empty } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const user = useUser();
  const write = useManagementWrite();
  const editor = useEditorLink();
  const { params, page, setPage, filter } = useAdminList();
  const usage = params.get("usage") === "unused" ? "unused" : "used";
  const query = new URLSearchParams(params);
  query.set("usage", usage);
  query.set("group_by", usage === "used" ? "challenge" : "none");
  const data = useAPI<{
    items?: ImageRecord[];
    groups?: { id: string; title: string; items: ImageRecord[] }[];
    group_total?: number;
    total: number;
    counts: { used: number; unused: number };
    worker: { online: boolean; checked_at?: string; error?: string };
  }>(`/admin/images?${query}`, true, 5000);
  const [jobId, setJobId] = useState<string | null>(null);
  const groups =
    usage === "used"
      ? (data.data?.groups ?? [])
      : [{ id: "unused", title: "未应用", items: data.data?.items ?? [] }];
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ImageImportActions
              disabled={!write || !data.data?.worker.online}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新镜像列表"
              disabled={data.isFetching}
              onClick={() => void data.refetch()}
            >
              <RefreshCw
                className={data.isFetching ? "motion-safe:animate-spin" : ""}
              />
            </Button>
          </div>
        }
      >
        Docker 镜像
      </PageTitle>
      <Tabs
        value={usage}
        onValueChange={(value) => filter("usage", value)}
        className="gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line" aria-label="镜像用途">
            <TabsTrigger value="used">
              题目使用中
              <span className="text-xs tabular-nums text-muted-foreground">
                {data.data?.counts?.used ?? "—"}
              </span>
            </TabsTrigger>
            <TabsTrigger value="unused">
              未应用
              <span className="text-xs tabular-nums text-muted-foreground">
                {data.data?.counts?.unused ?? "—"}
              </span>
            </TabsTrigger>
          </TabsList>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <form
              key={params.get("q")}
              role="search"
              className="flex min-w-0 flex-1 gap-2 lg:w-72"
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
              <Button
                type="submit"
                variant="secondary"
                size="icon"
                aria-label="搜索"
              >
                <Search />
              </Button>
            </form>
            <NativeSelect
              aria-label="镜像状态"
              value={params.get("state") ?? "all"}
              onChange={(e) => filter("state", e.target.value)}
            >
              <NativeSelectOption value="all">全部状态</NativeSelectOption>
              <NativeSelectOption value="present">已就绪</NativeSelectOption>
              <NativeSelectOption value="missing">未就绪</NativeSelectOption>
              <NativeSelectOption value="pulling">处理中</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <TabsContent value={usage} className="space-y-4">
          <QueryState
            loading={data.isLoading}
            error={data.error}
            retry={() => void data.refetch()}
          />
          {data.data && !data.error && (
            <>
              <div className="space-y-6" aria-busy={data.isFetching}>
                {groups.map((group) => (
                  <section
                    key={group.id}
                    className="space-y-2"
                    aria-labelledby={
                      usage === "used" ? `image-group-${group.id}` : undefined
                    }
                  >
                    {usage === "used" && (
                      <div className="flex items-center justify-between gap-3">
                        <h2
                          id={`image-group-${group.id}`}
                          className="min-w-0 break-words text-base font-semibold"
                        >
                          {group.title}
                        </h2>
                        {can(user, "challenges.read", group.id) && (
                          <Button asChild variant="ghost" size="icon-sm">
                            <Link
                              to={editor(`/admin/challenges/${group.id}/edit`)}
                              aria-label={`编辑 ${group.title}`}
                            >
                              <ArrowUpRight />
                            </Link>
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="rounded-xl bg-card p-2 shadow-sm">
                      <Table
                        className="table-fixed"
                        aria-label={`${group.title}的镜像`}
                      >
                        <TableHeader>
                          <TableRow>
                            <TableHead>镜像</TableHead>
                            <TableHead className="hidden w-24 md:table-cell">
                              状态
                            </TableHead>
                            <TableHead className="hidden w-24 text-right md:table-cell">
                              大小
                            </TableHead>
                            <TableHead className="w-32 text-right md:w-40">
                              操作
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.map((item) => {
                            const working = ["queued", "pulling"].includes(
                              item.job_status ?? "",
                            );
                            return (
                              <TableRow key={item.image}>
                                <TableCell className="whitespace-normal break-all py-3">
                                  <span className="font-medium">
                                    {item.image}
                                  </span>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
                                    <ImageStatus item={item} />
                                    <span className="text-xs tabular-nums text-muted-foreground">
                                      {imageSize(item.size)}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  <ImageStatus item={item} />
                                </TableCell>
                                <TableCell className="hidden text-right tabular-nums md:table-cell">
                                  {imageSize(item.size)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap items-center justify-end gap-1">
                                    {working && item.job_id ? (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setJobId(item.job_id!)}
                                      >
                                        <RefreshCw className="motion-safe:animate-spin" />
                                        进度
                                      </Button>
                                    ) : (
                                      <>
                                        {!item.present && (
                                          <ImagePullButton
                                            image={item.image}
                                            disabled={
                                              !write ||
                                              !data.data?.worker.online
                                            }
                                            onOpen={setJobId}
                                          />
                                        )}
                                        {item.job_id && (
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`查看 ${item.image} 的镜像日志`}
                                            title="镜像日志"
                                            onClick={() =>
                                              setJobId(item.job_id!)
                                            }
                                          >
                                            <FileText />
                                          </Button>
                                        )}
                                        {item.present && !item.job_id && (
                                          <span className="text-muted-foreground">
                                            —
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {!group.items.length && (
                        <Empty>
                          {params.get("q") ||
                          (params.get("state") && params.get("state") !== "all")
                            ? "没有符合条件的镜像"
                            : usage === "used"
                              ? "暂无题目使用的镜像"
                              : "暂无未应用的镜像"}
                        </Empty>
                      )}
                    </div>
                  </section>
                ))}
                {!groups.length && (
                  <Empty>
                    {params.get("q") ||
                    (params.get("state") && params.get("state") !== "all")
                      ? "没有符合条件的镜像"
                      : usage === "used"
                        ? "暂无题目使用的镜像"
                        : "暂无未应用的镜像"}
                  </Empty>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 [&>div]:mt-0">
                <span className="text-xs text-muted-foreground">
                  {data.data.worker.online
                    ? data.data.worker.checked_at
                      ? `同步于 ${date(data.data.worker.checked_at)}`
                      : "已同步"
                    : "Docker Worker 暂不可用"}
                </span>
                <Pagination
                  page={page}
                  setPage={setPage}
                  total={usage === "used" ? undefined : data.data.total}
                  hasMore={
                    usage === "used"
                      ? page * 12 < (data.data.group_total ?? 0)
                      : page * 24 < data.data.total
                  }
                  disabled={data.isFetching}
                  alwaysShow
                />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
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
