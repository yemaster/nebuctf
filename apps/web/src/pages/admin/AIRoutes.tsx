import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, KeyRound, Trash2, PlugZap, X } from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import {
  Field,
  PageTitle,
  QueryState,
  Table,
  Empty,
  Pagination,
} from "@/components/shared";
import { EditorHeading, useAdminList } from "@/components/admin/shared";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TableRow, TableCell } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { ToggleField } from "./SystemSettings";
type AIRoute = {
  id: string;
  name: string;
  enabled: boolean;
  protocol: "openai" | "anthropic";
  base_url: string;
  models: { alias: string; upstream: string }[];
  rpm: number;
  daily_limit: number;
  concurrency: number;
  max_tokens: number;
  timeout_seconds: number;
  access_prefix: string;
  key_set?: boolean;
  calls?: number;
  failures?: number;
};
const initial: Omit<AIRoute, "id" | "access_prefix"> = {
  name: "",
  enabled: false,
  protocol: "openai",
  base_url: "",
  models: [{ alias: "", upstream: "" }],
  rpm: 60,
  daily_limit: 1000,
  concurrency: 4,
  max_tokens: 4096,
  timeout_seconds: 120,
};
async function copy(value: string) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(value);
    else {
      const field = document.createElement("textarea");
      field.value = value;
      field.className = "sr-only";
      document.body.append(field);
      field.select();
      try {
        if (!document.execCommand("copy")) throw Error("copy failed");
      } finally {
        field.remove();
      }
    }
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请手动选择内容");
  }
}
export function AIRoutesAdmin() {
  const { page, setPage } = useAdminList(),
    query = useAPI<{ items: AIRoute[]; total: number }>(
      `/admin/ai-routes?page=${page}`,
    );
  const toggle = useAction(
    ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/admin/ai-routes/${id}`, "PATCH", { enabled }),
  );
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return (
    <>
      <PageTitle
        action={
          <Button asChild>
            <Link to="/admin/ai/new">
              <Plus />
              添加路由
            </Link>
          </Button>
        }
      >
        AI 转发
      </PageTitle>
      <Table
        headers={["路由", "上游协议", "模型", "近 24 小时", "限额", "启用", ""]}
      >
        {query.data.items.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                to={`/admin/ai/${row.id}/edit`}
                className="font-medium hover:underline"
              >
                {row.name}
              </Link>
              <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">
                {row.base_url}
              </p>
            </TableCell>
            <TableCell>
              {row.protocol === "openai" ? "OpenAI" : "Anthropic"}
            </TableCell>
            <TableCell>{row.models.length}</TableCell>
            <TableCell>
              <span className="tabular-nums">{row.calls} 次</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {row.failures} 失败
              </span>
            </TableCell>
            <TableCell className="text-xs">
              {row.rpm} 次/分钟
              <br />
              {row.daily_limit} 次/日
            </TableCell>
            <TableCell>
              <Switch
                checked={row.enabled}
                aria-label={`${row.name}启用`}
                disabled={toggle.isPending}
                onCheckedChange={(enabled) =>
                  toggle.mutate({ id: row.id, enabled })
                }
              />
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/admin/ai/${row.id}/edit`}>编辑</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
      {!query.data.items.length && <Empty>还没有转发路由</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        hasMore={page * 10 < query.data.total}
        total={query.data.total}
        pageSize={10}
      />
    </>
  );
}
export function AIRouteEditor() {
  const { id } = useParams(),
    query = useAPI<AIRoute>(`/admin/ai-routes/${id}`, !!id);
  if (id && (!query.data || query.error))
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return <RouteForm key={id ?? "new"} route={query.data} />;
}
function SecretReceipt({
  value,
  onDismiss,
}: {
  value: string;
  onDismiss: () => void;
}) {
  return (
    <section
      className="space-y-3 rounded-lg bg-muted p-4"
      aria-label="新访问密钥"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">访问密钥</h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="关闭密钥"
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          readOnly
          aria-label="新访问密钥"
          autoComplete="off"
        />
        <Button
          variant="secondary"
          size="icon"
          aria-label="复制访问密钥"
          onClick={() => copy(value)}
        >
          <Copy />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        仅显示一次，请保存。此密钥只能访问当前路由。
      </p>
    </section>
  );
}
function RouteForm({ route }: { route?: AIRoute }) {
  const [enabled, setEnabled] = useState(route?.enabled ?? false),
    [protocol, setProtocol] = useState(route?.protocol ?? "openai"),
    [models, setModels] = useState(route?.models ?? initial.models),
    [secret, setSecret] = useState(""),
    [createdId, setCreatedId] = useState(""),
    [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);
  const navigate = useNavigate(),
    cache = useQueryClient(),
    data = route ?? initial;
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api<{ id: string; access_key?: string }>(
        `/admin/ai-routes${route ? "/" + route.id : ""}`,
        route ? "PUT" : "POST",
        body,
      ),
    onSuccess: (result) => {
      void cache.invalidateQueries({
        queryKey: ["/admin/ai-routes/" + result.id],
      });
      void cache.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("/admin/ai-routes?"),
      });
      if (result.access_key) {
        setCreatedId(result.id);
        setSecret(result.access_key);
      }
      toast.success("已保存");
    },
  });
  const rotate = useMutation({
    mutationFn: () =>
      api<{ access_key: string }>(
        `/admin/ai-routes/${route!.id}/rotate`,
        "POST",
        {},
      ),
    onSuccess: (result) => {
      setSecret(result.access_key);
      setConfirm(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useAction(
    () => api(`/admin/ai-routes/${route!.id}`, "DELETE"),
    () => navigate("/admin/ai"),
  );
  const test = useAction(
    () => api(`/admin/ai-routes/${route!.id}/test`, "POST", {}),
    () => toast.success("上游连接正常"),
  );
  if (createdId)
    return (
      <>
        <PageTitle>路由已创建</PageTitle>
        <div className="max-w-3xl space-y-5">
          {secret && (
            <SecretReceipt value={secret} onDismiss={() => setSecret("")} />
          )}
          <Button asChild>
            <Link to={`/admin/ai/${createdId}/edit`}>查看接入信息</Link>
          </Button>
        </div>
      </>
    );
  return (
    <>
      <EditorHeading
        title={route ? `编辑路由 / ${route.name}` : "添加 AI 路由"}
        back="/admin/ai"
        form="ai-route"
        pending={save.isPending}
      />
      <div className="max-w-4xl space-y-6">
        {secret && (
          <SecretReceipt value={secret} onDismiss={() => setSecret("")} />
        )}
        <form
          id="ai-route"
          className="space-y-7 rounded-xl bg-card p-5 shadow-sm sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate({
              name: f.get("name"),
              base_url: f.get("base_url"),
              api_key: f.get("api_key"),
              enabled,
              protocol,
              models,
              ...Object.fromEntries(
                [
                  "rpm",
                  "daily_limit",
                  "concurrency",
                  "max_tokens",
                  "timeout_seconds",
                ].map((key) => [key, Number(f.get(key))]),
              ),
            });
          }}
        >
          <div className="grid items-end gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="路由名称">
              <Input
                name="name"
                required
                maxLength={80}
                defaultValue={data.name}
              />
            </Field>
            <ToggleField
              label="启用转发"
              checked={enabled}
              onChange={setEnabled}
            />
          </div>
          <section className="space-y-4">
            <h2 className="font-medium">上游连接</h2>
            <Field label="上游协议">
              <RadioGroup
                className="flex gap-6"
                value={protocol}
                onValueChange={(v) => setProtocol(v as typeof protocol)}
              >
                {[
                  ["openai", "OpenAI"],
                  ["anthropic", "Anthropic"],
                ].map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={v!} />
                    {label}
                  </label>
                ))}
              </RadioGroup>
            </Field>
            <Field label="API 基础地址">
              <Input
                name="base_url"
                type="url"
                required
                maxLength={500}
                defaultValue={data.base_url}
                placeholder={
                  protocol === "openai"
                    ? "https://api.example.com/v1"
                    : "https://api.anthropic.com/v1"
                }
              />
            </Field>
            <Field label="上游 API 密钥">
              <Input
                name="api_key"
                type="password"
                autoComplete="new-password"
                required={!route?.key_set}
                maxLength={2048}
                placeholder={route?.key_set ? "已设置，留空保留" : ""}
              />
            </Field>
          </section>
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-medium">模型映射</h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={models.length >= 50}
                onClick={() =>
                  setModels([...models, { alias: "", upstream: "" }])
                }
              >
                <Plus />
                添加模型
              </Button>
            </div>
            <div className="space-y-3">
              {models.map((model, index) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3"
                  key={index}
                >
                  <Field label={index === 0 ? "调用模型名" : ""}>
                    <Input
                      aria-label={`调用模型名 ${index + 1}`}
                      required
                      maxLength={100}
                      value={model.alias}
                      onChange={(e) =>
                        setModels(
                          models.map((m, i) =>
                            i === index ? { ...m, alias: e.target.value } : m,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label={index === 0 ? "上游模型名" : ""}>
                    <Input
                      aria-label={`上游模型名 ${index + 1}`}
                      required
                      maxLength={200}
                      value={model.upstream}
                      onChange={(e) =>
                        setModels(
                          models.map((m, i) =>
                            i === index
                              ? { ...m, upstream: e.target.value }
                              : m,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={models.length === 1}
                    aria-label={`移除模型 ${index + 1}`}
                    onClick={() =>
                      setModels(models.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-4">
            <h2 className="font-medium">调用限制</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["rpm", "每分钟次数", 1, 10000],
                ["daily_limit", "每日次数", 1, 1000000],
                ["concurrency", "同时请求数", 1, 100],
                ["max_tokens", "最大输出 tokens", 1, 131072],
                ["timeout_seconds", "超时（秒）", 5, 300],
              ].map(([key, label, min, max]) => (
                <Field key={String(key)} label={String(label)}>
                  <Input
                    name={String(key)}
                    type="number"
                    required
                    min={Number(min)}
                    max={Number(max)}
                    defaultValue={data[key as keyof typeof data] as number}
                  />
                </Field>
              ))}
            </div>
          </section>
          {save.error && (
            <Alert variant="destructive">
              <AlertTitle>{save.error.message}</AlertTitle>
            </Alert>
          )}
        </form>
        {route && (
          <section className="space-y-5 rounded-xl bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">接入信息</h2>
              <Button
                variant="secondary"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                <PlugZap />
                测试已保存连接
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              两种格式均可调用。文本、工具调用与流式响应支持跨协议转换。
            </p>
            {[
              [
                "OpenAI 基础地址",
                `${window.location.origin}/api/ai/${route.id}/v1`,
              ],
              [
                "Anthropic 基础地址",
                `${window.location.origin}/api/ai/${route.id}`,
              ],
              ["访问密钥", `${route.access_prefix}…`],
            ].map(([label, value]) => (
              <Field key={label} label={label!}>
                <div className="flex gap-2">
                  <Input readOnly value={value} aria-label={label} />
                  {label !== "访问密钥" && (
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={`复制${label}`}
                      onClick={() => copy(value!)}
                    >
                      <Copy />
                    </Button>
                  )}
                </div>
              </Field>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setConfirm("rotate")}>
                <KeyRound />
                重置访问密钥
              </Button>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setConfirm("delete")}
              >
                <Trash2 />
                删除路由
              </Button>
            </div>
          </section>
        )}
      </div>
      <ConfirmAction
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === "delete" ? "删除路由" : "重置访问密钥"}
        description={
          confirm === "delete"
            ? "删除后，此路由及其访问密钥立即失效。"
            : "原访问密钥将立即失效，使用此路由的靶机需要更新密钥。"
        }
        pending={remove.isPending || rotate.isPending}
        onConfirm={() =>
          confirm === "delete" ? remove.mutate() : rotate.mutate()
        }
      />
    </>
  );
}
