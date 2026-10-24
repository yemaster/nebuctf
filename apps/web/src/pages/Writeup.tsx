import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAPI, useAction } from "@/lib/api";
import { uploadFile } from "@/lib/file-upload";
import { type OwnWriteup, fileSize, writeupStatuses } from "@/lib/writeups";
import { date } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { QueryState, PageTitle } from "@/components/shared";
import { ResourceError } from "@/components/resource-error";
import { DownloadButton } from "@/components/download-button";
export function WriteupPage() {
  const { id } = useParams(),
    data = useAPI<OwnWriteup>(`/contests/${id}/writeup`, true, 15000);
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return data.data ? (
    <WriteupForm
      id={id!}
      data={data.data}
      refresh={() => void data.refetch()}
    />
  ) : null;
}
function WriteupForm({
  id,
  data,
  refresh,
}: {
  id: string;
  data: OwnWriteup;
  refresh: () => void;
}) {
  const [version, setVersion] = useState(data.submission?.version ?? 0);
  const [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [now, setNow] = useState(Date.now());
  const controller = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const upload = useAction(
    async () => {
      if (!file) throw Error("请选择 WriteUp 文件");
      if (file.size > data.config.max_size_mb * 1024 * 1024)
        throw Error(`文件不能超过 ${data.config.max_size_mb} MiB`);
      if (
        !data.config.formats.some((f) =>
          file.name.toLowerCase().endsWith(`.${f}`),
        )
      )
        throw Error("文件格式不符合提交要求");
      controller.current = new AbortController();
      setProgress(0);
      return uploadFile(
        `/contests/${id}/writeup?version=${version}`,
        file,
        setProgress,
        controller.current.signal,
      );
    },
    () => {
      setFile(null);
      if (input.current) input.current.value = "";
      toast.success("WriteUp 已提交");
      refresh();
    },
    false,
  );
  const blocked = !data.config.enabled
    ? "提交已关闭"
    : now < Date.parse(data.opens_at)
      ? "尚未开放提交"
      : now >= Date.parse(data.config.deadline ?? "")
        ? "提交已截止"
        : !data.can_submit
          ? "仅队长可提交，请联系队长"
          : data.submission &&
              !data.config.allow_resubmit &&
              data.submission.status !== "changes_requested"
            ? "已提交，不可替换"
            : null;
  const submission = data.submission;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageTitle
        action={
          <Button variant="outline" asChild>
            <Link to={`/contests/${id}`}>比赛概览</Link>
          </Button>
        }
      >
        WriteUp
      </PageTitle>
      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div className="space-y-1">
          <span className="text-muted-foreground">提交战队</span>
          <p className="font-medium">{data.team.team_name}</p>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">开始提交</span>
          <p>{date(data.opens_at)}</p>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground">提交截止</span>
          <p>{date(data.config.deadline)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {data.config.required ? "必交" : "自愿提交"}
        </Badge>
        <Badge variant="secondary">
          每队一份 /{" "}
          {data.config.submitter === "captain"
            ? "仅队长提交"
            : "队长和队员均可提交"}
        </Badge>
        <Badge variant="secondary">
          {data.config.formats.map((f) => f.toUpperCase()).join(" / ")}，最多{" "}
          {data.config.max_size_mb} MiB
        </Badge>
        {blocked && <Badge variant="outline">{blocked}</Badge>}
      </div>
      {data.config.note && (
        <section className="space-y-3">
          <h2 className="font-medium">提交要求</h2>
          <Markdown>{data.config.note}</Markdown>
        </section>
      )}
      <section
        className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/60"
        aria-label="战队 WriteUp"
      >
        <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
          <FileText className="size-6 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="break-all font-medium">
              {submission?.name ?? "尚未提交 WriteUp"}
            </p>
            {submission && (
              <p className="text-xs text-muted-foreground">
                {fileSize(submission.size)} / 版本 {submission.version} /{" "}
                {submission.submitted_by} / {date(submission.submitted_at)}
              </p>
            )}
          </div>
          <Badge
            variant="secondary"
            className={
              submission?.status === "accepted"
                ? "text-success"
                : submission?.status === "changes_requested"
                  ? "text-warning"
                  : ""
            }
          >
            {submission ? writeupStatuses[submission.status] : "未提交"}
          </Badge>
          {submission && (
            <DownloadButton
              href={`/api/contests/${id}/writeup/file`}
              name={submission.name}
              label="下载 WriteUp"
              embedded
            />
          )}
        </div>
        {submission?.review_note && (
          <div className="space-y-1 border-t px-5 py-4 sm:px-6">
            <p className="text-sm font-medium">处理意见</p>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {submission.review_note}
            </p>
          </div>
        )}
        {!blocked && (
          <form
            className="space-y-4 border-t p-5 sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              upload.mutate();
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                ref={input}
                type="file"
                aria-label="选择 WriteUp 文件"
                accept={data.config.formats.map((f) => `.${f}`).join(",")}
                disabled={upload.isPending}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setVersion(data.submission?.version ?? 0);
                  upload.reset();
                }}
              />
              <Button disabled={!file || upload.isPending}>
                {upload.isPending ? (
                  <Loader2 className="motion-safe:animate-spin" />
                ) : (
                  <Upload />
                )}
                {upload.isPending
                  ? "正在提交"
                  : submission
                    ? "替换 WriteUp"
                    : "提交 WriteUp"}
              </Button>
            </div>
            {upload.isPending && (
              <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in">
                <div
                  role="status"
                  className="flex justify-between text-xs text-muted-foreground"
                >
                  <span>{progress === 100 ? "正在保存" : "正在上传"}</span>
                  <span>{progress}%</span>
                </div>
                <Progress
                  value={progress}
                  aria-label="WriteUp 上传进度"
                  className="h-1.5"
                />
              </div>
            )}
          </form>
        )}
        {upload.error && (
          <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-3 sm:px-6">
            <ResourceError error={upload.error} />
            <Button type="button" size="sm" variant="ghost" onClick={refresh}>
              刷新提交状态
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
