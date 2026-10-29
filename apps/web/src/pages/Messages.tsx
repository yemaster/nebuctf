import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Clock3,
  Mail,
  MailOpen,
  Megaphone,
  Search,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/App";
import { api, useAPI } from "@/lib/api";
import { date } from "@/lib/utils";
import {
  inboxKey,
  messageKinds,
  useInboxSummary,
  useMessageAction,
  type Message,
  type MessageDetail,
  type MessageKind,
} from "@/lib/notifications";
import {
  Empty,
  Loading,
  PageTitle,
  Pagination,
  QueryState,
} from "@/components/shared";
import { StatusPage } from "@/components/status-page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Item, ItemGroup } from "@/components/ui/item";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

const icons = { system: Megaphone, contest: Trophy, reminder: Clock3 };
type Inbox = {
  items: Message[];
  total: number;
  page_size: number;
  as_of: string;
};
export function Messages() {
  const user = useUser();
  const session = useAPI("/me", false);
  if (session.isLoading) return <Loading fullPage />;
  return user ? (
    <TooltipProvider delayDuration={250}>
      <Inbox user={user.id} />
    </TooltipProvider>
  ) : (
    <StatusPage status={401} />
  );
}
function IconAction({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function Inbox({ user }: { user: string }) {
  const [params, setParams] = useSearchParams(),
    cache = useQueryClient();
  const kind = Object.hasOwn(messageKinds, params.get("kind") ?? "")
    ? (params.get("kind") as MessageKind)
    : undefined;
  const state = ["unread", "archived"].includes(params.get("state") ?? "")
    ? params.get("state")!
    : "all";
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1)),
    q = params.get("q") ?? "";
  const selected = params.get("message"),
    [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({ page: String(page), state, q });
  if (kind) query.set("kind", kind);
  const path = `/notifications?${query}`;
  const data = useQuery({
    queryKey: [...inboxKey(user), "list", path],
    queryFn: ({ signal }) => api<Inbox>(path, "GET", undefined, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
  const summary = useInboxSummary(user),
    action = useMessageAction(user);
  function update(values: Record<string, string | null>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  }
  const allRead = useMutation({
    mutationFn: () =>
      api("/notifications/read-all", "PUT", {
        before: data.data!.as_of,
        ...(kind ? { kind } : {}),
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: inboxKey(user) });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (
      data.data &&
      !data.isPlaceholderData &&
      !data.isFetching &&
      page > Math.max(1, Math.ceil(data.data.total / 10))
    )
      update({ page: String(Math.max(1, Math.ceil(data.data.total / 10))) });
  }, [data.data, data.isFetching, data.isPlaceholderData, page]);
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
      <PageTitle
        action={
          <Button
            variant="ghost"
            onClick={() => allRead.mutate()}
            disabled={allRead.isPending || !summary.data?.unread || !data.data}
          >
            <CheckCheck />
            全部已读
          </Button>
        }
      >
        消息中心
        {summary.data?.unread ? (
          <Badge className="ml-3 align-middle" variant="secondary">
            {summary.data.unread} 未读
          </Badge>
        ) : null}
      </PageTitle>
      <Card className="gap-0 overflow-hidden border-0 py-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <Tabs
            value={kind ?? "all"}
            onValueChange={(value) =>
              update({ kind: value === "all" ? null : value, page: null })
            }
          >
            <TabsList variant="line">
              <TabsTrigger value="all">全部</TabsTrigger>
              {Object.entries(messageKinds).map(([value, label]) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <form
            className="w-64"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search.trim() || null, page: null });
            }}
          >
            <InputGroup>
              <InputGroupInput
                aria-label="搜索消息"
                placeholder="搜索消息"
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  size="icon-xs"
                  aria-label="搜索"
                >
                  <Search />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
          <div className="ml-auto flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={state === "unread"}
                disabled={state === "archived"}
                onCheckedChange={(value) =>
                  update({ state: value ? "unread" : null, page: null })
                }
              />
              只看未读
            </label>
            <Button
              variant={state === "archived" ? "secondary" : "ghost"}
              size="sm"
              onClick={() =>
                update({
                  state: state === "archived" ? null : "archived",
                  page: null,
                })
              }
            >
              <Archive />
              已归档
            </Button>
          </div>
        </div>
        <ItemGroup
          className="divide-y"
          aria-label="消息列表"
          aria-busy={data.isFetching || undefined}
        >
          {data.data?.items.map((message) => {
            const Icon = icons[message.kind];
            return (
              <Item
                key={message.id}
                role="listitem"
                className="group rounded-none border-0 border-b border-border/50 p-0 pr-4 last:border-b-0 hover:bg-muted/40"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => update({ message: message.id })}
                  aria-label={`查看消息：${message.title}`}
                >
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`truncate ${message.read_at ? "font-medium" : "font-semibold"}`}
                      >
                        {message.title}
                      </span>
                      {!message.read_at && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-primary"
                          aria-label="未读"
                        />
                      )}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {message.excerpt.replace(/\s+/g, " ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2 text-xs text-muted-foreground">
                    <time dateTime={message.created_at}>
                      {date(message.created_at)}
                    </time>
                    <span>{messageKinds[message.kind]}</span>
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <IconAction
                    label={message.read_at ? "标为未读" : "标为已读"}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: message.id, read: !message.read_at })
                    }
                  >
                    {message.read_at ? <Mail /> : <MailOpen />}
                  </IconAction>
                  <IconAction
                    label={message.archived_at ? "移回收件箱" : "归档"}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        id: message.id,
                        archived: !message.archived_at,
                      })
                    }
                  >
                    {message.archived_at ? <ArchiveRestore /> : <Archive />}
                  </IconAction>
                </div>
              </Item>
            );
          })}
        </ItemGroup>
        {!data.data?.items.length && (
          <Empty>
            <Bell className="size-8 text-muted-foreground/60" />
            {q
              ? "没有符合条件的消息"
              : state === "unread"
                ? "没有未读消息"
                : state === "archived"
                  ? "暂无归档消息"
                  : "暂无消息"}
          </Empty>
        )}
      </Card>
      <Pagination
        page={page}
        setPage={(value) => update({ page: String(value) })}
        total={data.data?.total}
        pageSize={10}
        hasMore={page * 10 < (data.data?.total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) update({ message: null });
        }}
      >
        <SheetContent
          className="w-full gap-0 sm:max-w-xl"
          aria-describedby={undefined}
        >
          {selected && (
            <MessageView
              key={selected}
              id={selected}
              user={user}
              close={() => update({ message: null })}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
function MessageView({
  id,
  user,
  close,
}: {
  id: string;
  user: string;
  close: () => void;
}) {
  const data = useQuery({
    queryKey: [...inboxKey(user), "detail", id],
    queryFn: ({ signal }) =>
      api<MessageDetail>(`/notifications/${id}`, "GET", undefined, signal),
  });
  const action = useMessageAction(user),
    marked = useRef(false);
  useEffect(() => {
    if (data.data && !marked.current) {
      marked.current = true;
      if (!data.data.read_at) action.mutate({ id, read: true });
    }
  }, [data.data, id]);
  const message = data.data;
  return (
    <>
      <SheetHeader className="p-6 pr-12">
        <SheetTitle>{message?.title ?? "消息详情"}</SheetTitle>
        {message && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{messageKinds[message.kind]}</span>
            <span>{message.sender ?? "系统"}</span>
            <time dateTime={message.created_at}>
              {date(message.created_at)}
            </time>
          </div>
        )}
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1 px-6">
        <QueryState
          loading={data.isLoading}
          error={data.error}
          retry={() => void data.refetch()}
        />
        {message && !data.error && (
          <p className="whitespace-pre-wrap break-words pb-6 text-sm leading-7">
            {message.body}
          </p>
        )}
      </ScrollArea>
      {message && !data.error && (
        <SheetFooter className="flex-row flex-wrap justify-start gap-2 border-t p-6">
          {message.actions?.map((action, i) => (
            <Button key={i} asChild variant={i === 0 ? "default" : "outline"}>
              <Link to={action.href} onClick={close}>
                <ArrowUpRight />
                {action.label}
              </Link>
            </Button>
          ))}
          {message.href && (
            <Button asChild>
              <Link to={message.href} onClick={close}>
                <ArrowUpRight />
                {message.action_label || "查看详情"}
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { id, archived: !message.archived_at },
                { onSuccess: close },
              )
            }
          >
            {message.archived_at ? <ArchiveRestore /> : <Archive />}
            {message.archived_at ? "移回收件箱" : "归档"}
          </Button>
          <IconAction
            label="标为未读"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({ id, read: false }, { onSuccess: close })
            }
          >
            <Mail />
          </IconAction>
        </SheetFooter>
      )}
    </>
  );
}
