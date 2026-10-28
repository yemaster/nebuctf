import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileArchive, Upload, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { questionTypes } from "@/lib/competition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { TableCell, TableRow } from "@/components/ui/table";
import { Field, Pagination, Table } from "@/components/shared";
import { OperationProgress } from "@/components/operation-progress";
import { inputDate, useEditorReturn } from "@/components/admin/shared";

type Preview = {
  token: string;
  kind: "contest" | "challenge";
  title: string;
  size: number;
  starts_at?: string;
  ends_at?: string;
  questions: {
    id: string;
    title: string;
    category: string;
    challenge_type: keyof typeof questionTypes;
    parts: number;
    attachments: number;
  }[];
  required_flags: { id: string; label: string }[];
  warnings: string[];
};
export function ContentImport({ kind }: { kind: Preview["kind"] }) {
  const label = kind === "contest" ? "比赛" : "题目";
  const back = useEditorReturn(
      `/admin/${kind === "contest" ? "contests" : "challenges"}`,
    ),
    navigate = useNavigate(),
    cache = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null),
    [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [flags, setFlags] = useState<Record<string, string>>({}),
    [page, setPage] = useState(1),
    [filename, setFilename] = useState("");
  const current = useRef<string | null>(null);
  const discard = (token: string | null) => {
    if (token) void api(`/admin/transfers/${token}`, "DELETE").catch(() => {});
  };
  useEffect(() => () => discard(current.current), []);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 256 * 1024 * 1024)
        throw new Error("文件包不能超过 256 MiB");
      const body = new FormData();
      body.append("file", file);
      return api<Preview>(
        `/admin/transfers/preview?kind=${kind}`,
        "POST",
        body,
      );
    },
    onSuccess: (data) => {
      current.current = data.token;
      setPreview(data);
      setTitle(data.title);
      setFlags({});
      setPage(1);
      setStart(
        inputDate(
          data.starts_at && Date.parse(data.starts_at) > Date.now() + 60000
            ? data.starts_at
            : new Date(Date.now() + 86400000).toISOString(),
        ),
      );
    },
  });
  const commit = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/admin/transfers/${preview!.token}/commit`, "POST", {
        title,
        flags,
        ...(kind === "contest"
          ? { starts_at: new Date(start).toISOString() }
          : {}),
      }),
    onSuccess: (data) => {
      current.current = null;
      void cache.invalidateQueries();
      toast.success(`${label}已导入`);
      navigate(
        `/admin/${kind === "contest" ? "contests" : "challenges"}/${data.id}/edit?return=${encodeURIComponent(back)}`,
        { replace: true },
      );
    },
  });
  const pending = upload.isPending || commit.isPending;
  const error = upload.error ?? commit.error;
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to={back} aria-label="返回列表">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">导入{label}</h1>
      </div>
      <Card className="py-0">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-wrap items-center gap-4">
            <FileArchive className="size-6 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium">
                {filename || "NebuCTF 文件包"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                ZIP，最大 256 MiB
              </p>
            </div>
            <Button asChild variant="outline">
              <label
                className={
                  pending ? "pointer-events-none opacity-50" : "cursor-pointer"
                }
              >
                <Upload />
                {filename ? "重新选择" : "选择文件"}
                <input
                  className="sr-only"
                  type="file"
                  aria-label="选择导入文件"
                  accept=".zip,application/zip"
                  disabled={pending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    discard(current.current);
                    current.current = null;
                    setPreview(null);
                    setFilename(file.name);
                    commit.reset();
                    upload.mutate(file);
                  }}
                />
              </label>
            </Button>
          </div>
          <OperationProgress
            busy={pending}
            failed={!!error}
            label={commit.isPending ? "正在导入" : "正在校验文件包"}
          />
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>{error.message}</AlertTitle>
              {error instanceof ApiError && error.status === 404 && (
                <AlertDescription>请重新选择文件。</AlertDescription>
              )}
            </Alert>
          )}
          {preview && (
            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                commit.mutate();
              }}
            >
              <div className="grid items-start gap-4 md:grid-cols-2">
                <Field label={`${label}名称`}>
                  <Input
                    value={title}
                    maxLength={120}
                    required
                    disabled={pending}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                {kind === "contest" && (
                  <Field label="开赛时间">
                    <Input
                      type="datetime-local"
                      value={start}
                      min={inputDate(
                        new Date(Date.now() + 60000).toISOString(),
                      )}
                      required
                      disabled={pending}
                      onChange={(e) => setStart(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      赛程、题目上线及 WriteUp 时间同步平移。
                    </p>
                  </Field>
                )}
              </div>
              <div>
                <div className="mb-3 flex items-center gap-4 text-sm">
                  <h2 className="font-medium">包内题目</h2>
                  <span className="text-muted-foreground">
                    {preview.questions.length} 题 /{" "}
                    {preview.questions.reduce((n, c) => n + c.attachments, 0)}{" "}
                    个附件
                  </span>
                </div>
                <Table headers={["题目", "分类", "类型", "小题", "附件"]}>
                  {preview.questions
                    .slice((page - 1) * 10, page * 10)
                    .map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.title}</TableCell>
                        <TableCell>{c.category}</TableCell>
                        <TableCell>{questionTypes[c.challenge_type]}</TableCell>
                        <TableCell>{c.parts || "—"}</TableCell>
                        <TableCell>{c.attachments}</TableCell>
                      </TableRow>
                    ))}
                </Table>
                {preview.questions.length > 10 && (
                  <Pagination
                    page={page}
                    setPage={setPage}
                    total={preview.questions.length}
                    pageSize={10}
                    hasMore={page * 10 < preview.questions.length}
                    disabled={pending}
                  />
                )}
              </div>
              {!!preview.required_flags.length && (
                <section className="space-y-4">
                  <div>
                    <h2 className="text-sm font-medium">静态 Flag</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      来源站点密钥不同，请填写对应 Flag。
                    </p>
                  </div>
                  <div className="grid items-start gap-4 md:grid-cols-2">
                    {preview.required_flags.map((f) => (
                      <Field key={f.id} label={f.label}>
                        <Input
                          className="font-mono"
                          autoComplete="off"
                          value={flags[f.id] ?? ""}
                          onChange={(e) =>
                            setFlags((v) => ({ ...v, [f.id]: e.target.value }))
                          }
                          required
                          maxLength={256}
                          disabled={pending}
                        />
                      </Field>
                    ))}
                  </div>
                </section>
              )}
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  导入为
                  {kind === "contest" ? "未发布的新比赛" : "未启用的新题目"}
                  ，保留现有数据。
                </p>
                {preview.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={pending || !title.trim()}>
                  {commit.isPending ? "正在导入" : "确认导入"}
                </Button>
                <Button asChild variant="outline">
                  <Link to={back}>取消</Link>
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </>
  );
}
