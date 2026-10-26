import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import { date } from "@/lib/utils";
import { activateFromRow } from "@/lib/row-action";
import { useAdminList } from "@/components/admin/shared";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table as TableRoot,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RegistrationMembers,
  RegistrationMembersPanel,
} from "@/components/admin/registration-members";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { Contest } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { MeasuredCollapse } from "@/components/measured-collapse";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useContestNow } from "@/components/contest-clock";
import {
  RegistrationActionButton,
  RegistrationReviewActions,
  RegistrationGroupControl,
  ReviewReasonAction,
  type ReviewChange,
} from "@/components/admin/registration-review-controls";
import {
  useBase,
  ReviewBadge,
  statuses,
  type Registration,
  type ReviewStatus,
} from "@/components/admin/contest-management-shared";
export function Registrations() {
  const { id, apiBase } = useBase(),
    { params, page, setPage, filter } = useAdminList();
  const data = useAPI<{
      items: Registration[];
      total: number;
      counts: { status: ReviewStatus; count: number }[];
    }>(`${apiBase}/registrations?${params}`),
    contest = useAPI<Contest>(`/contests/${id}`);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cache = useQueryClient();
  const now = useContestNow(contest.data?.clock, contest.dataUpdatedAt);
  useEffect(() => {
    setSelected([]);
    setExpanded(null);
  }, [params.toString()]);
  useEffect(() => {
    if (!data.data) return;
    const pendingIds = new Set(
      data.data.items
        .filter((r) => r.status === "pending")
        .map((r) => r.team_id),
    );
    setSelected((previous) => {
      const next = previous.filter((team) => pendingIds.has(team));
      return next.length === previous.length ? previous : next;
    });
  }, [data.data]);
  const review = useMutation({
    mutationFn: (change: ReviewChange) =>
      api(`${apiBase}/registrations`, "PUT", change),
    onSuccess: async (_, change) => {
      if (change.status)
        setSelected((previous) =>
          previous.filter((team) => !change.team_ids.includes(team)),
        );
      toast.success(
        change.status === "pending"
          ? "已转为待审核"
          : change.status
            ? `报名${statuses[change.status]}`
            : "组别已更新",
      );
      await cache.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).includes(id),
      });
    },
  });
  if (data.error || contest.error || data.isLoading || contest.isLoading)
    return (
      <QueryState
        loading={data.isLoading || contest.isLoading}
        error={data.error || contest.error}
        retry={() => {
          void data.refetch();
          void contest.refetch();
        }}
        fullPage
      />
    );
  const pending = data.data?.items.filter((r) => r.status === "pending") ?? [];
  return (
    <TooltipProvider delayDuration={150}>
      <PageTitle
        action={
          <Button asChild variant="outline">
            <Link to={`/contests/${id}`}>比赛概览</Link>
          </Button>
        }
      >
        报名战队
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-64"
          aria-label="搜索战队或队长"
          placeholder="搜索战队或队长"
          value={params.get("q") ?? ""}
          onChange={(e) => filter("q", e.target.value)}
        />
        <NativeSelect
          aria-label="报名状态"
          value={params.get("status") ?? ""}
          onChange={(e) => filter("status", e.target.value)}
        >
          <NativeSelectOption value="">全部状态</NativeSelectOption>
          {Object.entries(statuses).map(([s, title]) => (
            <NativeSelectOption key={s} value={s}>
              {title}（
              {data.data?.counts.find((c) => c.status === s)?.count ?? 0}）
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {!!contest.data?.groups.length && (
          <NativeSelect
            aria-label="报名组别"
            value={params.get("group") ?? ""}
            onChange={(e) => filter("group", e.target.value)}
          >
            <NativeSelectOption value="">全部组别</NativeSelectOption>
            {contest.data.groups.map((g) => (
              <NativeSelectOption value={g.id} key={g.id}>
                {g.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {selected.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="mr-2 text-sm text-muted-foreground">
              已选 {selected.length} 队
            </span>
            <RegistrationActionButton
              label={`通过所选（${selected.length}）`}
              icon={Check}
              tone="success"
              disabled={review.isPending}
              onClick={() =>
                review.mutate(
                  { team_ids: selected, status: "accepted" },
                  { onError: (e) => toast.error(e.message) },
                )
              }
            />
            <ReviewReasonAction
              key={selected.join(",")}
              teamIds={selected}
              title={`所选 ${selected.length} 支战队`}
              label="拒绝所选"
              status="rejected"
              busy={review.isPending}
              submit={review.mutateAsync}
            />
          </div>
        )}
      </div>
      <div className="rounded-lg bg-card">
        <TableRoot aria-label="报名战队" className="min-w-[1000px] table-fixed">
          <colgroup>
            <col className="w-12" />
            <col />
            <col className="w-32" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-36" />
            <col className="w-28" />
          </colgroup>
          <TableHeader className="bg-muted/70">
            <TableRow>
              {[
                <Checkbox
                  key="select"
                  aria-label="选择本页待审核战队"
                  checked={
                    pending.length > 0 &&
                    pending.every((r) => selected.includes(r.team_id))
                  }
                  disabled={!pending.length || review.isPending}
                  onCheckedChange={(v) =>
                    setSelected(v ? pending.map((r) => r.team_id) : [])
                  }
                />,
                "战队",
                "队长",
                "人数",
                "组别",
                "状态",
                "报名时间",
                "操作",
              ].map((header, index) => (
                <TableHead
                  key={index}
                  className={`px-4 text-xs text-muted-foreground ${index === 1 ? "pl-10" : index === 7 ? "text-right" : ""}`}
                >
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {data.data?.items.map((r) => (
            <Collapsible
              key={r.team_id}
              asChild
              open={expanded === r.team_id}
              onOpenChange={(open) => setExpanded(open ? r.team_id : null)}
            >
              <TableBody className="border-b last:border-b-0">
                <TableRow
                  className="cursor-pointer [&>td]:px-4 [&>td]:py-3"
                  onClick={(event) =>
                    activateFromRow(event, () =>
                      setExpanded(expanded === r.team_id ? null : r.team_id),
                    )
                  }
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`选择 ${r.name}`}
                      disabled={r.status !== "pending" || review.isPending}
                      checked={selected.includes(r.team_id)}
                      onCheckedChange={(v) =>
                        setSelected(
                          v
                            ? [...selected, r.team_id]
                            : selected.filter((t) => t !== r.team_id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto min-w-0 max-w-72 shrink justify-start gap-2 px-0 py-1 text-left whitespace-normal hover:bg-transparent has-[>svg]:px-0 dark:hover:bg-transparent"
                          aria-label={`${expanded === r.team_id ? "收起" : "展开"} ${r.name} 的成员`}
                        >
                          <ChevronRight
                            className={`shrink-0 motion-safe:transition-transform ${expanded === r.team_id ? "rotate-90" : ""}`}
                          />
                          <span className="min-w-0 break-all">{r.name}</span>
                        </Button>
                      </CollapsibleTrigger>
                      {r.practice_only && (
                        <Badge variant="secondary">赛后练习</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="break-all whitespace-normal">
                    {r.captain}
                  </TableCell>
                  <TableCell>{r.member_count}</TableCell>
                  <TableCell className="break-all whitespace-normal">
                    <RegistrationGroupControl
                      registration={r}
                      groups={contest.data?.groups ?? []}
                      locked={now >= Date.parse(contest.data!.starts_at)}
                      busy={review.isPending}
                      submit={review.mutateAsync}
                    />
                  </TableCell>
                  <TableCell>
                    <ReviewBadge status={r.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {date(r.created_at)}
                  </TableCell>
                  <TableCell>
                    <RegistrationReviewActions
                      registration={r}
                      busy={review.isPending}
                      submit={review.mutateAsync}
                    />
                  </TableCell>
                </TableRow>
                <CollapsibleContent asChild forceMount>
                  <TableRow
                    aria-hidden={expanded !== r.team_id || undefined}
                    className="border-0 bg-muted/20 hover:bg-muted/20"
                  >
                    <TableCell className="p-0" aria-hidden="true" />
                    <TableCell colSpan={7} className="p-0">
                      <MeasuredCollapse open={expanded === r.team_id}>
                        <section
                          aria-label={`${r.name} 的成员`}
                          className="py-2 pr-4 pl-10"
                        >
                          {r.review_note && (
                            <div className="flex gap-3 border-b py-3 text-sm">
                              <span className="shrink-0 text-muted-foreground">
                                审核说明
                              </span>
                              <p className="min-w-0 whitespace-pre-wrap break-words">
                                {r.review_note}
                              </p>
                            </div>
                          )}
                          <RegistrationMembersPanel
                            apiBase={apiBase}
                            team={r.team_id}
                            open={expanded === r.team_id}
                            count={r.member_count}
                          />
                        </section>
                      </MeasuredCollapse>
                    </TableCell>
                  </TableRow>
                </CollapsibleContent>
              </TableBody>
            </Collapsible>
          ))}
        </TableRoot>
      </div>
      {!data.data?.items.length && <Empty>暂无报名战队</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
      />
    </TooltipProvider>
  );
}
export function RegistrationDetail() {
  const { team } = useParams(),
    { id, base, apiBase } = useBase(),
    data = useAPI<Registration>(`${apiBase}/registrations/${team}`),
    contest = useAPI<Contest>(`/contests/${id}`);
  if (data.error || contest.error || data.isLoading || contest.isLoading)
    return (
      <QueryState
        loading={data.isLoading || contest.isLoading}
        error={data.error || contest.error}
        retry={() => {
          void data.refetch();
          void contest.refetch();
        }}
        fullPage
      />
    );
  if (!data.data || !contest.data) return null;
  return (
    <RegistrationForm
      key={team}
      registration={data.data}
      contest={contest.data}
      back={`${base}/teams`}
      apiBase={apiBase}
    />
  );
}
function RegistrationForm({
  registration: r,
  contest,
  back,
  apiBase,
}: {
  registration: Registration;
  contest: Contest;
  back: string;
  apiBase: string;
}) {
  const [status, setStatus] = useState<ReviewStatus>(r.status),
    [group, setGroup] = useState(r.group_id ?? ""),
    [note, setNote] = useState(r.review_note);
  const save = useAction(
    () =>
      api(`${apiBase}/registrations`, "PUT", {
        team_ids: [r.team_id],
        status,
        group_id: group || null,
        review_note: note,
      }),
    () => toast.success("报名信息已更新"),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-6"
    >
      <PageTitle action={<Button disabled={save.isPending}>保存</Button>}>
        <span className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={back} aria-label="返回报名战队">
              <ArrowLeft />
            </Link>
          </Button>
          {r.name}
          <ReviewBadge status={r.status} />
        </span>
      </PageTitle>
      <fieldset disabled={save.isPending} className="space-y-5">
        <Field label="参赛状态">
          <RadioGroup
            value={status}
            onValueChange={(v) => setStatus(v as ReviewStatus)}
            className="flex flex-wrap gap-5"
          >
            {Object.entries(statuses).map(([s, title]) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value={s}
                  disabled={
                    !!r.accepted_at && (s === "pending" || s === "rejected")
                  }
                />
                {title}
              </label>
            ))}
          </RadioGroup>
        </Field>
        {!!contest.groups.length && (
          <Field label="参赛组别">
            <NativeSelect
              aria-label="参赛组别"
              className="sm:w-72"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              disabled={Date.parse(contest.starts_at) <= Date.now()}
            >
              {contest.groups.map((g) => (
                <NativeSelectOption key={g.id} value={g.id}>
                  {g.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="审核说明">
          <Textarea
            aria-label="审核说明"
            className="max-w-2xl"
            maxLength={500}
            rows={3}
            required={status === "rejected" || status === "suspended"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="未通过或暂停参赛时，请说明原因"
          />
        </Field>
      </fieldset>
      <section className="space-y-3">
        <h2 className="font-medium">战队成员</h2>
        <RegistrationMembers members={r.members} registration={r} />
      </section>
    </form>
  );
}
