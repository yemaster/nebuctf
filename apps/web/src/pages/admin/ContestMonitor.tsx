import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import { date } from "@/lib/utils";
import { useAdminList } from "@/components/admin/shared";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
  Table,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TableRow, TableCell } from "@/components/ui/table";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  useBase,
  ReviewBadge,
  integrityStatuses,
  type Activity,
  type Clue,
} from "@/components/admin/contest-management-shared";
const eventNames: Record<string, string> = {
  submission: "Flag 提交",
  release: "题目上线",
  withdraw: "题目下线",
  hint: "提示更新",
  registration: "报名审核",
  judge: "补丁判题",
};
export function MonitorList({
  integrity = false,
  live,
}: {
  integrity?: boolean;
  live: boolean;
}) {
  const { base, apiBase } = useBase(),
    { params, page, setPage, filter } = useAdminList();
  const data = useAPI<{ items: (Clue & Activity)[]; total: number }>(
    `${apiBase}/${integrity ? "integrity" : "activity"}?${params}`,
  );
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
          <Badge
            variant="secondary"
            className={live ? "text-success" : "text-muted-foreground"}
          >
            {live ? "实时连接" : "正在重连"}
          </Badge>
        }
      >
        {integrity ? "作弊线索" : "比赛动态"}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-72"
          aria-label="搜索战队、选手或题目"
          placeholder="搜索战队、选手或题目"
          value={params.get("q") ?? ""}
          onChange={(e) => filter("q", e.target.value)}
        />
        <NativeSelect
          aria-label={integrity ? "核实状态" : "动态类型"}
          value={params.get(integrity ? "status" : "type") ?? ""}
          onChange={(e) =>
            filter(integrity ? "status" : "type", e.target.value)
          }
        >
          <NativeSelectOption value="">
            {integrity ? "全部状态" : "全部动态"}
          </NativeSelectOption>
          {Object.entries(integrity ? integrityStatuses : eventNames).map(
            ([s, title]) => (
              <NativeSelectOption key={s} value={s}>
                {title}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
        {!integrity && (
          <NativeSelect
            aria-label="提交结果"
            value={params.get("correct") ?? ""}
            onChange={(e) => filter("correct", e.target.value)}
          >
            <NativeSelectOption value="">全部结果</NativeSelectOption>
            <NativeSelectOption value="true">正确提交</NativeSelectOption>
            <NativeSelectOption value="false">错误提交</NativeSelectOption>
          </NativeSelect>
        )}
      </div>
      {integrity && (
        <p className="mb-4 text-sm text-muted-foreground">
          他队专属 Flag 提交记录，需人工核实。
        </p>
      )}
      <Table
        headers={
          integrity
            ? [
                "题目",
                "提交战队 / 选手",
                "Flag 所属战队",
                "提交时间",
                "状态",
                "操作",
              ]
            : ["时间", "动态", "题目", "战队 / 选手", "结果"]
        }
      >
        {data.data?.items.map((r) => (
          <TableRow key={`${r.type ?? "clue"}:${r.id}`}>
            {integrity ? (
              <>
                <TableCell>
                  <span className="font-medium">{r.challenge_title}</span>
                  {r.part_title && (
                    <span className="block text-xs text-muted-foreground">
                      {r.part_title}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    to={`${base}/teams/${r.team_id}`}
                    className="hover:underline"
                  >
                    {r.team_name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {r.username}
                  </span>
                </TableCell>
                <TableCell>{r.source_team_name}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {date(r.submitted_at)}
                </TableCell>
                <TableCell>
                  <ReviewBadge status={r.status} />
                </TableCell>
                <TableCell>
                  <Button asChild size="sm" variant="ghost">
                    <Link to={`${base}/integrity/${r.id}`}>核实</Link>
                  </Button>
                </TableCell>
              </>
            ) : (
              <>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {date(r.created_at)}
                </TableCell>
                <TableCell>
                  {eventNames[r.type]}
                  {r.contest_practice && (
                    <Badge variant="secondary" className="ml-2">
                      赛后练习
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {r.challenge_title ?? "—"}
                  {r.part_title && (
                    <span className="block text-xs text-muted-foreground">
                      {r.part_title}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {r.team_id ? (
                    <Link
                      to={`${base}/teams/${r.team_id}`}
                      className="hover:underline"
                    >
                      {r.team_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {r.username}
                  </span>
                </TableCell>
                <TableCell>
                  {r.correct !== null ? (
                    <Badge
                      variant="secondary"
                      className={
                        r.correct ? "text-success" : "text-destructive"
                      }
                    >
                      {r.correct ? "正确" : "错误"}
                    </Badge>
                  ) : r.detail?.startsWith("registration.") ? (
                    <ReviewBadge status={r.detail.split(".")[1]!} />
                  ) : (
                    ((
                      {
                        passed: "校验通过",
                        failed: "校验失败",
                        queued: "排队中",
                        building: "构建中",
                        checking: "校验中",
                        cancelled: "已取消",
                      } as Record<string, string>
                    )[r.detail ?? ""] ?? "—")
                  )}
                </TableCell>
              </>
            )}
          </TableRow>
        ))}
      </Table>
      {!data.data?.items.length && (
        <Empty>{integrity ? "暂无线索" : "暂无动态"}</Empty>
      )}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
      />
    </>
  );
}
export function IntegrityDetail() {
  const { event } = useParams(),
    { apiBase, base } = useBase(),
    data = useAPI<Clue>(`${apiBase}/integrity/${event}`);
  if (data.isLoading || data.error)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return data.data ? (
    <IntegrityForm key={event} clue={data.data} apiBase={apiBase} base={base} />
  ) : null;
}
function IntegrityForm({
  clue,
  apiBase,
  base,
}: {
  clue: Clue;
  apiBase: string;
  base: string;
}) {
  const [status, setStatus] = useState(clue.status),
    [note, setNote] = useState(clue.note),
    [page, setPage] = useState(1);
  const reviews = useAPI<{
    total: number;
    items: {
      id: string;
      username: string;
      status: string;
      note: string;
      created_at: string;
    }[];
  }>(`${apiBase}/integrity/${clue.id}/reviews?page=${page}`);
  const save = useAction(
    () => api(`${apiBase}/integrity/${clue.id}`, "PUT", { status, note }),
    () => toast.success("核实记录已保存"),
  );
  if (reviews.error)
    return (
      <QueryState
        loading={false}
        error={reviews.error}
        retry={() => void reviews.refetch()}
        fullPage
      />
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-6"
    >
      <PageTitle
        action={<Button disabled={save.isPending}>保存核实记录</Button>}
      >
        <span className="flex items-center gap-3">
          <Button asChild size="icon" variant="ghost">
            <Link to={`${base}/integrity`} aria-label="返回作弊线索">
              <ArrowLeft />
            </Link>
          </Button>
          核实线索
        </span>
      </PageTitle>
      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          [
            "题目",
            `${clue.challenge_title}${clue.part_title ? ` / ${clue.part_title}` : ""}`,
          ],
          ["提交选手", clue.username],
          ["提交时间", date(clue.submitted_at)],
        ].map(([key, value]) => (
          <div key={key} className="space-y-1">
            <dt className="text-muted-foreground">{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="space-y-1">
          <dt className="text-muted-foreground">提交战队</dt>
          <dd>
            <Link
              className="underline underline-offset-4"
              to={`${base}/teams/${clue.team_id}`}
            >
              {clue.team_name}
            </Link>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Flag 所属战队</dt>
          <dd>
            <Link
              className="underline underline-offset-4"
              to={`${base}/teams/${clue.source_team_id}`}
            >
              {clue.source_team_name}
            </Link>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">提交记录</dt>
          <dd className="break-all font-mono text-xs">{clue.submission_id}</dd>
        </div>
      </dl>
      <fieldset disabled={save.isPending} className="space-y-4">
        <Field label="核实结果">
          <RadioGroup
            value={status}
            onValueChange={(v) => setStatus(v as Clue["status"])}
            className="flex flex-wrap gap-5"
          >
            {Object.entries(integrityStatuses).map(([s, title]) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={s} />
                {title}
              </label>
            ))}
          </RadioGroup>
        </Field>
        <Field label="核实说明">
          <Textarea
            aria-label="核实说明"
            className="max-w-2xl"
            required
            maxLength={1000}
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </fieldset>
      <section className="space-y-3">
        <h2 className="font-medium">处理记录</h2>
        <Table headers={["管理员", "结果", "说明", "时间"]}>
          {reviews.data?.items.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.username}</TableCell>
              <TableCell>
                <ReviewBadge status={r.status} />
              </TableCell>
              <TableCell className="max-w-xl whitespace-pre-wrap break-words">
                {r.note}
              </TableCell>
              <TableCell>{date(r.created_at)}</TableCell>
            </TableRow>
          ))}
        </Table>
        <Pagination
          page={page}
          setPage={setPage}
          pageSize={10}
          total={reviews.data?.total}
          hasMore={page * 10 < (reviews.data?.total ?? 0)}
        />
      </section>
    </form>
  );
}
