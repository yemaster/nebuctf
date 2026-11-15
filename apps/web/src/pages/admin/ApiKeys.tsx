import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleHelp,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, useAPI, useAction } from "@/lib/api";
import type { ApiKeyPolicy, ApiKeyPolicyResponse } from "@/lib/api-keys";
import { randomUUID } from "@/lib/random-uuid";
import { useManagementWrite } from "@/lib/use-management-access";
import { ConfigCard } from "@/components/admin/config-card";
import { ApiScopePicker } from "@/components/api-scope-picker";
import { ConfirmAction } from "@/components/confirm-action";
import { Empty, Field, PageTitle, QueryState } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ApiKeysAdmin() {
  const query = useAPI<ApiKeyPolicyResponse>("/admin/api-keys/policy");
  if (!query.data || query.error) {
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <ApiKeyPolicyForm key={JSON.stringify(query.data)} data={query.data} />
    </TooltipProvider>
  );
}

function ApiKeyPolicyForm({ data }: { data: ApiKeyPolicyResponse }) {
  const write = useManagementWrite();
  const [policy, setPolicy] = useState(data.policy);
  const [maxDays, setMaxDays] = useState(String(data.policy.max_lifetime_days));
  const [editor, setEditor] = useState<{
    id: string | null;
    name: string;
    scopes: string[];
    isNew?: boolean;
  } | null>(null);
  const [removing, setRemoving] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = useAction<ApiKeyPolicy>(
    (value) => api("/admin/api-keys/policy", "PUT", value),
    () => toast.success("API Key 设置已保存"),
    false,
  );
  const disabled = !write || save.isPending;
  const changed =
    JSON.stringify(policy) !== JSON.stringify(data.policy) ||
    maxDays !== String(data.policy.max_lifetime_days);
  const allowedScopes = new Set(policy.allowed_scopes);

  return (
    <>
      <PageTitle
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/developers/api">
                <ExternalLink />
                API 文档
              </Link>
            </Button>
            <Button
              type="submit"
              form="api-key-policy"
              disabled={disabled || !changed}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              保存
            </Button>
          </div>
        }
      >
        API KEY
      </PageTitle>
      <ConfigCard>
        <form
          id="api-key-policy"
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            setFormError(null);
            const days = Number(maxDays);
            if (!Number.isInteger(days) || days < 1 || days > 365) {
              setFormError("有效期须为 1–365 天");
              return;
            }
            save.mutate({ ...policy, max_lifetime_days: days });
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch
                checked={policy.enabled}
                onCheckedChange={(enabled) =>
                  setPolicy((previous) => ({ ...previous, enabled }))
                }
                aria-label="启用 API Key"
                disabled={disabled}
              />
              启用 API Key
            </label>
            <label className="flex items-center gap-2 text-sm">
              最长有效期
              <Input
                type="number"
                min={1}
                max={365}
                step={1}
                required
                value={maxDays}
                onChange={(event) => setMaxDays(event.target.value)}
                disabled={disabled}
                className="w-20"
                aria-label="最长有效期（天）"
              />
              <span className="text-muted-foreground">天</span>
            </label>
          </div>
          <section aria-labelledby="api-identities" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="api-identities" className="font-medium">
                API 身份
              </h2>
              <div className="flex items-center gap-2">
                {changed && <Badge variant="outline">未保存</Badge>}
                {!write && <Badge variant="secondary">只读</Badge>}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || policy.identities.length >= 50}
                  onClick={() =>
                    setEditor({
                      id: randomUUID(),
                      name: "",
                      scopes: [],
                      isNew: true,
                    })
                  }
                >
                  <Plus />
                  新增身份
                </Button>
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {policy.identities.map((identity) => {
                const effectiveCount = identity.scopes.filter((scope) =>
                  allowedScopes.has(scope),
                ).length;
                return (
                  <div
                    key={identity.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">
                        {identity.name}
                      </h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            生效 {effectiveCount} / 配置{" "}
                            {identity.scopes.length}
                            <CircleHelp className="size-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          生效权限为身份配置与允许的权限的交集。
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={`编辑${identity.name}`}
                        onClick={() =>
                          setEditor({
                            id: identity.id,
                            name: identity.name,
                            scopes: [...identity.scopes],
                          })
                        }
                      >
                        编辑
                      </Button>
                      <Switch
                        checked={identity.enabled}
                        onCheckedChange={(enabled) =>
                          setPolicy((previous) => ({
                            ...previous,
                            identities: previous.identities.map((entry) =>
                              entry.id === identity.id
                                ? { ...entry, enabled }
                                : entry,
                            ),
                          }))
                        }
                        disabled={disabled}
                        aria-label={`启用${identity.name}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={`删除${identity.name}`}
                        onClick={() => setRemoving(identity)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {policy.identities.length === 0 && <Empty>暂无 API 身份</Empty>}
            </div>
          </section>
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">
              允许的权限{" "}
              <span className="ml-1 tabular-nums">
                {policy.allowed_scopes.length}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                setEditor({
                  id: null,
                  name: "允许的权限",
                  scopes: [...policy.allowed_scopes],
                })
              }
            >
              配置
            </Button>
          </div>
          {(formError || save.error) && (
            <FieldError>{formError ?? save.error?.message}</FieldError>
          )}
        </form>
      </ConfigCard>
      {editor && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
        >
          <DialogContent className="max-w-xl" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {editor.id === null
                  ? "允许的权限"
                  : editor.isNew
                    ? "新增身份"
                    : "编辑身份"}
              </DialogTitle>
            </DialogHeader>
            {editor.id !== null && (
              <Field label="名称">
                <Input
                  autoFocus
                  value={editor.name}
                  onChange={(event) =>
                    setEditor((previous) =>
                      previous
                        ? { ...previous, name: event.target.value }
                        : null,
                    )
                  }
                  maxLength={48}
                  required
                  autoComplete="off"
                  disabled={disabled}
                />
              </Field>
            )}
            <ApiScopePicker
              scopes={data.scopes}
              value={editor.scopes}
              onChange={(scopes) =>
                setEditor((previous) =>
                  previous ? { ...previous, scopes } : null,
                )
              }
              disabled={disabled}
            />
            <DialogFooter>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditor(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={
                    disabled ||
                    (editor.id !== null && !editor.name.trim()) ||
                    (editor.isNew && policy.identities.length >= 50)
                  }
                  onClick={() => {
                    if (disabled) return;
                    const name = editor.name.trim();
                    if (editor.id !== null && !name) return;
                    if (editor.isNew && policy.identities.length >= 50) return;
                    setPolicy((previous) => {
                      if (editor.id === null) {
                        return { ...previous, allowed_scopes: editor.scopes };
                      }
                      const identity = {
                        id: editor.id,
                        name,
                        scopes: editor.scopes,
                        enabled: false,
                      };
                      return {
                        ...previous,
                        identities: editor.isNew
                          ? [...previous.identities, identity]
                          : previous.identities.map((entry) =>
                              entry.id === editor.id
                                ? { ...entry, name, scopes: editor.scopes }
                                : entry,
                            ),
                      };
                    });
                    setEditor(null);
                  }}
                >
                  确定
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmAction
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`删除身份 ${removing?.name ?? ""}？`}
        description="删除后关联密钥失效，保存后生效。"
        confirm="删除"
        pending={disabled}
        onConfirm={() => {
          if (disabled || !removing) return;
          setPolicy((previous) => ({
            ...previous,
            identities: previous.identities.filter(
              (identity) => identity.id !== removing.id,
            ),
          }));
          setRemoving(null);
        }}
      />
    </>
  );
}
