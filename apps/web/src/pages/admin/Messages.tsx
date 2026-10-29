import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import { useAdminList, AdminToolbar } from "@/components/admin/shared";
import { ConfigCard } from "@/components/admin/config-card";
import {
  Empty,
  Field,
  PageTitle,
  Pagination,
  QueryState,
  Table,
} from "@/components/shared";
import { ConfirmAction } from "@/components/confirm-action";
import { ActionError } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

type SentMessage = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  action_label: string | null;
  audience: string;
  sender: string;
  created_at: string;
  withdrawn_at: string | null;
  recipients: number;
  read_count: number;
};
export function MessagesAdmin() {
  const { params, page, setPage, filter } = useAdminList(),
    cache = useQueryClient();
  const data = useAPI<{ items: SentMessage[]; total: number }>(
    `/admin/notifications?page=${page}&q=${encodeURIComponent(params.get("q") ?? "")}`,
  );
  const [selected, setSelected] = useState<SentMessage | null>(null),
    [expanded, setExpanded] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api(`/admin/notifications/${selected!.id}`, "DELETE"),
    onSuccess: () => {
      setSelected(null);
      void cache.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0].startsWith("/admin/notifications") ||
            q.queryKey[0] === "notifications"),
      });
      toast.success("消息已撤回");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (data.isLoading || data.error)
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
      <AdminToolbar
        title="系统消息"
        createHref="/admin/messages/new"
        createLabel="发送消息"
        search={params.get("q") ?? ""}
        onSearch={(value) => filter("q", value)}
      />
      <div className="mb-4">
        <Button asChild variant="outline">
          <Link to="/admin/messages/welcome">注册欢迎消息</Link>
        </Button>
      </div>
      <Table
        headers={[
          "消息",
          "接收对象",
          "已读 / 接收",
          "发送人",
          "发送时间",
          "状态",
          "",
        ]}
      >
        {data.data?.items.map((message) => (
          <Fragment key={message.id}>
            <TableRow
              className="cursor-pointer"
              tabIndex={0}
              aria-expanded={expanded === message.id}
              onClick={() =>
                setExpanded(expanded === message.id ? null : message.id)
              }
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  ["Enter", " "].includes(event.key)
                ) {
                  event.preventDefault();
                  setExpanded(expanded === message.id ? null : message.id);
                }
              }}
            >
              <TableCell
                className="max-w-96 truncate font-medium"
                title={message.title}
              >
                <span className="flex items-center gap-2">
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded === message.id ? "rotate-90" : ""}`}
                  />
                  <span className="truncate">{message.title}</span>
                </span>
              </TableCell>
              <TableCell className="max-w-64 truncate" title={message.audience}>
                {message.audience}
              </TableCell>
              <TableCell className="tabular-nums">
                {message.read_count} / {message.recipients}
              </TableCell>
              <TableCell>{message.sender}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {date(message.created_at)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {message.withdrawn_at ? "已撤回" : "已发送"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`撤回 ${message.title}`}
                  title="撤回"
                  disabled={!!message.withdrawn_at}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(message);
                  }}
                >
                  <Undo2 />
                </Button>
              </TableCell>
            </TableRow>
            {expanded === message.id && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="p-0">
                  <Collapsible open>
                    <CollapsibleContent className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150 pl-6 pb-2">
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">
                        {message.body}
                      </p>
                      {message.href && (
                        <Button asChild variant="link" className="px-0">
                          <Link to={message.href}>
                            {message.action_label || "查看详情"}
                          </Link>
                        </Button>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </Table>
      {!data.data?.items.length && <Empty>暂无发送记录</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
        alwaysShow
      />
      <ConfirmAction
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="撤回消息"
        description={`撤回“${selected?.title ?? ""}”后，接收用户将无法查看。`}
        confirm="撤回"
        pending={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />
    </>
  );
}
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function MessageComposer() {
  const navigate = useNavigate(),
    cache = useQueryClient(),
    [request] = useState(requestId);
  const [audience, setAudience] = useState("users"),
    [contest, setContest] = useState<{ id: string; title: string } | null>(
      null,
    );
  const send = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const values = new FormData(form);
      return api<{ id: string; recipients: number }>(
        "/admin/notifications",
        "POST",
        {
          request_id: request,
          audience,
          recipients: String(values.get("recipients") ?? "")
            .split(/[\s,，;；]+/)
            .filter(Boolean),
          ...(audience === "contest" && contest
            ? { contest_id: contest.id }
            : {}),
          title: String(values.get("title") ?? ""),
          body: String(values.get("body") ?? ""),
          href: String(values.get("href") ?? ""),
          action_label: String(values.get("action_label") ?? ""),
        },
      );
    },
    onSuccess: (result) => {
      void cache.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0].startsWith("/admin/notifications") ||
            q.queryKey[0] === "notifications"),
      });
      toast.success(
        result.recipients
          ? `已发送给 ${result.recipients} 位用户`
          : "消息已发送",
      );
      navigate("/admin/messages");
    },
  });
  return (
    <>
      <PageTitle>
        <span className="flex items-center gap-3">
          <Button asChild size="icon" variant="ghost">
            <Link to="/admin/messages" aria-label="返回消息列表">
              <ArrowLeft />
            </Link>
          </Button>
          发送系统消息
        </span>
      </PageTitle>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (audience === "contest" && !contest) {
            toast.error("请选择比赛");
            return;
          }
          send.mutate(event.currentTarget);
        }}
      >
        <ConfigCard>
          <div className="space-y-5">
            <Field label="接收对象">
              <RadioGroup
                value={audience}
                onValueChange={setAudience}
                className="flex flex-wrap gap-6"
              >
                {[
                  ["users", "指定用户"],
                  ["contest", "比赛战队"],
                  ["all", "全体用户"],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <RadioGroupItem value={value!} />
                    {label}
                  </label>
                ))}
              </RadioGroup>
            </Field>
            {audience === "users" && (
              <Field label="用户名或邮箱">
                <Textarea
                  name="recipients"
                  required
                  maxLength={25500}
                  rows={3}
                  placeholder="每行一位，最多 100 位"
                />
              </Field>
            )}
            {audience === "contest" && (
              <>
                <ContestAudience selected={contest} onSelect={setContest} />
                <p className="text-xs text-muted-foreground">
                  发送给已通过审核的参赛队员。
                </p>
              </>
            )}
            {audience === "all" && (
              <p className="text-sm text-muted-foreground">
                发送给当前所有未禁用的用户。
              </p>
            )}
          </div>
        </ConfigCard>
        <ConfigCard>
          <div className="space-y-5">
            <Field label="标题">
              <Input name="title" required maxLength={120} />
            </Field>
            <Field label="内容">
              <Textarea name="body" required maxLength={8000} rows={8} />
            </Field>
            <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
              <Field label="站内链接（选填）">
                <Input name="href" maxLength={500} placeholder="/contests" />
              </Field>
              <Field label="按钮文字">
                <Input
                  name="action_label"
                  maxLength={30}
                  defaultValue="查看详情"
                />
              </Field>
            </div>
          </div>
        </ConfigCard>
        {send.error && <ActionError error={send.error} />}
        <div className="flex gap-3">
          <Button type="submit" disabled={send.isPending}>
            <Send />
            {send.isPending ? "发送中" : "发送消息"}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/admin/messages">取消</Link>
          </Button>
        </div>
      </form>
    </>
  );
}
function ContestAudience({
  selected,
  onSelect,
}: {
  selected: { id: string; title: string } | null;
  onSelect: (value: { id: string; title: string }) => void;
}) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const data = useAPI<{
    items: { id: string; title: string; starts_at: string }[];
    total: number;
  }>(
    `/admin/contests?page=${page}&page_size=10&q=${encodeURIComponent(query)}`,
  );
  return (
    <div className="space-y-3">
      <Input
        aria-label="搜索比赛"
        placeholder="搜索比赛"
        value={search}
        maxLength={100}
        onChange={(event) => setSearch(event.target.value)}
      />
      {selected && <Badge variant="secondary">{selected.title}</Badge>}
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
      {!data.error && (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.data?.items.map((c) => (
            <Button
              type="button"
              key={c.id}
              variant={selected?.id === c.id ? "secondary" : "ghost"}
              className="h-auto min-w-0 justify-start py-3 text-left"
              onClick={() => onSelect(c)}
            >
              {selected?.id === c.id && <Check />}
              <span className="min-w-0">
                <span className="block truncate">{c.title}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {date(c.starts_at)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
      {!data.isLoading && !data.error && !data.data?.items.length && (
        <Empty>没有符合条件的比赛</Empty>
      )}
      <Pagination
        page={page}
        setPage={setPage}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
        compact
      />
    </div>
  );
}
