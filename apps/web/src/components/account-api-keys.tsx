import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import {
  API_KEY_PAGE_SIZE,
  apiKeyLocalDate,
  formatApiKeyTime,
  type AccountApiKeysResponse,
  type ApiKeyIdentity,
  type ApiKeyCreatedResponse,
  type ApiKeyInput,
  type ApiKeyItem,
  type ApiKeyPolicy,
  type ApiKeyScope,
  type ApiKeyUpdatedResponse,
} from "@/lib/api-keys";
import { copyText } from "@/lib/clipboard";
import { ApiScopePicker } from "./api-scope-picker";
import { ConfirmAction } from "./confirm-action";
import { Empty, Field, Pagination, QueryState } from "./shared";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

export function AccountApiKeys() {
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ item: ApiKeyItem | null } | null>(
    null,
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyItem | null>(null);
  const query = useAPI<AccountApiKeysResponse>(
    `/account/api-keys?page=${page}`,
  );
  const data = query.data;
  const revoke = useAction(
    (id: string) =>
      api(`/account/api-keys/${encodeURIComponent(id)}`, "DELETE"),
    () => {
      setRevoking(null);
      toast.success("API Key 已撤销");
    },
    false,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-semibold">API Key</h2>
          <Link
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            to="/developers/api"
          >
            API 文档 <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <Button
          disabled={!data?.policy.enabled || !data.scopes.length}
          onClick={() => setEditor({ item: null })}
        >
          <Plus /> 创建 API Key
        </Button>
      </div>

      {!data ? (
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          {query.error && (
            <Alert variant="destructive">
              <AlertTitle>刷新失败</AlertTitle>
              <AlertDescription>
                <p>{query.error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!data.policy.enabled ? (
            <Alert>
              <ShieldAlert />
              <AlertTitle>API Key 功能已停用</AlertTitle>
              <AlertDescription>可查看历史记录或撤销密钥。</AlertDescription>
            </Alert>
          ) : !data.scopes.length ? (
            <Alert>
              <ShieldAlert />
              <AlertTitle>暂无可用身份或权限</AlertTitle>
            </Alert>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              上限 {data.limit} 个 · 最长 {data.policy.max_lifetime_days} 天
            </p>
          )}

          {data.items.length ? (
            <section
              aria-label="API Key 历史记录"
              className="divide-y rounded-lg border"
            >
              {data.items.map((item) => {
                const expired =
                  new Date(item.expires_at).getTime() <= Date.now();
                const identity = data.identities.find(
                  (entry) => entry.id === item.identity_id,
                );
                const available = item.identity_id
                  ? (identity?.scopes ?? [])
                  : data.policy.allowed_scopes;
                const blocked = item.scopes.filter(
                  (id) => !available.includes(id),
                );
                const status = item.revoked_at
                  ? "已撤销"
                  : expired
                    ? "已到期"
                    : !data.policy.enabled
                      ? "系统已停用"
                      : item.identity_id && !identity
                        ? "身份已停用"
                        : blocked.length === item.scopes.length
                          ? "权限已停用"
                          : blocked.length
                            ? "部分权限停用"
                            : "可用";
                return (
                  <article
                    key={item.id}
                    className="grid min-w-0 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
                  >
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-all font-medium">
                          {item.name}
                        </h3>
                        <Badge
                          variant={
                            item.revoked_at || expired
                              ? "outline"
                              : status === "可用"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {status}
                        </Badge>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.prefix}…
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          {item.identity_name ??
                            (item.identity_id ? "已删除身份" : "手动选择")}{" "}
                          · {item.scopes.length} 项权限
                        </summary>
                        <div
                          className="mt-2 flex flex-wrap gap-1.5"
                          aria-label="已授予权限"
                        >
                          {item.scopes.map((id) => (
                            <Badge
                              key={id}
                              variant={
                                available.includes(id) ? "outline" : "secondary"
                              }
                              className="max-w-full whitespace-normal break-all"
                            >
                              {data.scopes.find((scope) => scope.id === id)
                                ?.name ?? id}
                              {!available.includes(id) && " · 已停用"}
                            </Badge>
                          ))}
                        </div>
                      </details>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">创建时间</dt>
                          <dd className="mt-1">
                            {formatApiKeyTime(item.created_at)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">到期时间</dt>
                          <dd className="mt-1">
                            {formatApiKeyTime(item.expires_at)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">最近使用</dt>
                          <dd className="mt-1">
                            {formatApiKeyTime(item.last_used_at)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">最后修改</dt>
                          <dd className="mt-1">
                            {formatApiKeyTime(item.updated_at)}
                          </dd>
                        </div>
                        {item.revoked_at && (
                          <div>
                            <dt className="text-muted-foreground">撤销时间</dt>
                            <dd className="mt-1">
                              {formatApiKeyTime(item.revoked_at)}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {!item.revoked_at && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {!expired && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !data.policy.enabled || !data.scopes.length
                              }
                              onClick={() => setEditor({ item })}
                            >
                              编辑
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              revoke.reset();
                              setRevoking(item);
                            }}
                          >
                            撤销
                          </Button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <Empty>
              <KeyRound className="size-7" aria-hidden="true" />
              <p>还没有 API Key</p>
            </Empty>
          )}
          <Pagination
            page={page}
            setPage={setPage}
            total={data.total}
            pageSize={API_KEY_PAGE_SIZE}
            hasMore={page * API_KEY_PAGE_SIZE < data.total}
            disabled={query.isFetching}
          />
        </>
      )}

      {editor && data && (
        <ApiKeyEditor
          key={editor.item?.id ?? "new"}
          item={editor.item}
          policy={data.policy}
          scopes={data.scopes}
          identities={data.identities}
          onClose={() => setEditor(null)}
          onCreated={(value) => {
            setSecret(value);
            setPage(1);
          }}
        />
      )}
      {secret !== null && (
        <ApiKeySecret value={secret} onClose={() => setSecret(null)} />
      )}
      <ConfirmAction
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title="撤销 API Key？"
        description={`「${revoking?.name ?? ""}」将立即失效，无法恢复。`}
        confirm="确认撤销"
        pending={revoke.isPending}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
        }}
      >
        {revoke.error && <FieldError>{revoke.error.message}</FieldError>}
      </ConfirmAction>
    </div>
  );
}

function ApiKeyEditor({
  item,
  policy,
  scopes,
  identities,
  onClose,
  onCreated,
}: {
  item: ApiKeyItem | null;
  policy: ApiKeyPolicy;
  scopes: ApiKeyScope[];
  identities: ApiKeyIdentity[];
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [identityId, setIdentityId] = useState(
    item ? (item.identity_id ?? "custom") : (identities[0]?.id ?? "custom"),
  );
  const customScopes = scopes.filter((scope) =>
    policy.allowed_scopes.includes(scope.id),
  );
  const [selected, setSelected] = useState(
    item?.scopes.filter((id) => policy.allowed_scopes.includes(id)) ?? [],
  );
  const identity = identities.find((entry) => entry.id === identityId);
  const [preset, setPreset] = useState(
    item ? "custom" : String(Math.min(30, policy.max_lifetime_days)),
  );
  const initialExpiry = item ? apiKeyLocalDate(item.expires_at) : "";
  const [customExpiry, setCustomExpiry] = useState(initialExpiry);
  const [formError, setFormError] = useState<string | null>(null);
  const save = useAction<ApiKeyInput>(
    async (value) => {
      if (item) {
        await api<ApiKeyUpdatedResponse>(
          `/account/api-keys/${encodeURIComponent(item.id)}`,
          "PUT",
          value,
        );
      } else {
        const result = await api<ApiKeyCreatedResponse>(
          "/account/api-keys",
          "POST",
          value,
        );
        onCreated(result.key);
      }
    },
    () => {
      onClose();
      toast.success(item ? "API Key 已更新" : "API Key 已创建");
    },
    false,
  );
  const options = [
    ...new Set([7, 30, 90, 365, Math.min(30, policy.max_lifetime_days)]),
  ]
    .filter((days) => days <= policy.max_lifetime_days)
    .sort((a, b) => a - b);
  const unavailable =
    !policy.enabled || (!identities.length && !customScopes.length);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
        showCloseButton={!save.isPending}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{item ? "编辑 API Key" : "创建 API Key"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            const currentScopes =
              identityId === "custom"
                ? selected.filter((id) =>
                    customScopes.some((scope) => scope.id === id),
                  )
                : (identity?.scopes ?? []);
            const expires =
              preset === "custom"
                ? item && customExpiry === initialExpiry
                  ? new Date(item.expires_at).getTime()
                  : new Date(customExpiry).getTime()
                : Date.now() + Number(preset) * 86400000;
            if (!name.trim()) {
              setFormError("请输入名称");
              return;
            }
            if (!currentScopes.length) {
              setFormError("请选择可用身份或权限");
              return;
            }
            if (!Number.isFinite(expires) || expires <= Date.now()) {
              setFormError("请选择未来的到期时间");
              return;
            }
            if (expires > Date.now() + policy.max_lifetime_days * 86400000) {
              setFormError(`有效期不能超过 ${policy.max_lifetime_days} 天`);
              return;
            }
            save.mutate({
              name: name.trim(),
              expires_at: new Date(expires).toISOString(),
              ...(identityId === "custom"
                ? { scopes: currentScopes }
                : { identity_id: identityId }),
            });
          }}
        >
          <fieldset
            className="min-w-0 space-y-4"
            disabled={save.isPending || unavailable}
          >
            <Field label="名称">
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
                placeholder="例如：本地脚本"
                autoComplete="off"
              />
            </Field>
            <Field label="API 身份">
              <NativeSelect
                value={identityId}
                onChange={(event) => setIdentityId(event.target.value)}
                aria-label="API 身份"
              >
                {identities.map((entry) => (
                  <NativeSelectOption key={entry.id} value={entry.id}>
                    {entry.name}
                  </NativeSelectOption>
                ))}
                {customScopes.length > 0 && (
                  <NativeSelectOption value="custom">
                    手动选择
                  </NativeSelectOption>
                )}
                {identityId !== "custom" && !identity && (
                  <NativeSelectOption value={identityId} disabled>
                    {item?.identity_name ?? "原身份"}（已停用）
                  </NativeSelectOption>
                )}
                {identityId === "custom" && !customScopes.length && (
                  <NativeSelectOption value="custom" disabled>
                    手动选择（暂无允许的权限）
                  </NativeSelectOption>
                )}
              </NativeSelect>
            </Field>
            {identityId === "custom" ? (
              <ApiScopePicker
                scopes={customScopes}
                value={selected}
                onChange={setSelected}
                disabled={save.isPending || unavailable}
              />
            ) : (
              identity && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {identity.scopes.length} 项权限
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {identity.scopes.map((id) => (
                      <Badge key={id} variant="outline">
                        {scopes.find((scope) => scope.id === id)?.name ?? id}
                      </Badge>
                    ))}
                  </div>
                </details>
              )
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="有效期">
                <NativeSelect
                  value={preset}
                  onChange={(event) => setPreset(event.target.value)}
                  aria-label="有效期预设"
                >
                  {options.map((days) => (
                    <NativeSelectOption key={days} value={String(days)}>
                      {days} 天
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="custom">自定义</NativeSelectOption>
                </NativeSelect>
              </Field>
              {preset === "custom" && (
                <Field label="到期时间">
                  <Input
                    type="datetime-local"
                    value={customExpiry}
                    onChange={(event) => setCustomExpiry(event.target.value)}
                    min={apiKeyLocalDate(Date.now())}
                    max={apiKeyLocalDate(
                      Date.now() + policy.max_lifetime_days * 86400000,
                    )}
                    required
                  />
                </Field>
              )}
            </div>
          </fieldset>
          {unavailable && <FieldError>暂无可用身份或权限</FieldError>}
          {(formError || save.error) && (
            <FieldError>{formError ?? save.error?.message}</FieldError>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={save.isPending || unavailable}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {item ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeySecret({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>API Key 已创建</DialogTitle>
          <DialogDescription>仅显示一次，请妥善保存。</DialogDescription>
        </DialogHeader>
        <Field label="完整 API Key">
          <Input
            value={value}
            readOnly
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await copyText(value);
                setCopied(true);
                toast.success("API Key 已复制");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "复制失败，请手动复制",
                );
              }
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "已复制" : "复制密钥"}
          </Button>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
