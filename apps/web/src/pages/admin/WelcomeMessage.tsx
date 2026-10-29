import { Link } from "react-router-dom";
import { Plus, Save, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useUser } from "@/App";
import { api, useAPI } from "@/lib/api";
import { useDraft } from "@/lib/use-draft";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Field, PageTitle, QueryState } from "@/components/shared";
import { ConfigCard } from "@/components/admin/config-card";
import { ActionError } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Welcome = {
  enabled: boolean;
  title: string;
  body: string;
  actions: { label: string; href: string }[];
};
export function WelcomeMessage() {
  const query = useAPI<Welcome>("/admin/settings/welcome");
  if (!query.data || query.error)
    return (
      <QueryState
        fullPage
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return <WelcomeForm initial={query.data} />;
}
function WelcomeForm({ initial }: { initial: Welcome }) {
  const user = useUser()!;
  const cache = useQueryClient();
  const [value, set, clear, stored] = useDraft(`welcome:${user.id}`, initial);
  const save = useMutation({
    mutationFn: (submitted: Welcome) =>
      api("/admin/settings/welcome", "PUT", submitted),
    onSuccess: (_, submitted) => {
      cache.setQueryData(["/admin/settings/welcome"], submitted);
      clear();
      toast.success("欢迎消息已保存");
    },
  });
  return (
    <>
      <PageTitle>
        <span className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/admin/messages" aria-label="返回系统消息">
              <ArrowLeft />
            </Link>
          </Button>
          注册欢迎消息
        </span>
      </PageTitle>
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(value);
        }}
      >
        <fieldset disabled={save.isPending} className="min-w-0 space-y-6">
          <ConfigCard>
            <div className="space-y-5">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Switch
                  checked={value.enabled}
                  onCheckedChange={(enabled) => set({ ...value, enabled })}
                />
                注册完成后发送
              </label>
              <Field label="标题">
                <Input
                  required
                  value={value.title}
                  maxLength={120}
                  onChange={(e) => set({ ...value, title: e.target.value })}
                />
              </Field>
              <Field label="内容">
                <Textarea
                  aria-label="内容"
                  required
                  rows={7}
                  value={value.body}
                  maxLength={7000}
                  onChange={(e) => set({ ...value, body: e.target.value })}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                支持 {"{username}"} 和 {"{site_name}"}
              </p>
            </div>
          </ConfigCard>
          <ConfigCard>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="font-medium">引导按钮</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={value.actions.length >= 3}
                  onClick={() =>
                    set({
                      ...value,
                      actions: [
                        ...value.actions,
                        {
                          label: "完善个人资料",
                          href: "/account?section=profile",
                        },
                      ],
                    })
                  }
                >
                  <Plus />
                  添加
                </Button>
              </div>
              {value.actions.map((a, i) => (
                <div key={i} className="flex items-end gap-3">
                  <Field label="按钮文字" className="flex-1">
                    <Input
                      required
                      value={a.label}
                      maxLength={30}
                      onChange={(e) =>
                        set({
                          ...value,
                          actions: value.actions.map((x, j) =>
                            i === j ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="站内链接" className="flex-[2]">
                    <Input
                      required
                      value={a.href}
                      maxLength={500}
                      onChange={(e) =>
                        set({
                          ...value,
                          actions: value.actions.map((x, j) =>
                            i === j ? { ...x, href: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除引导按钮 ${i + 1}`}
                    onClick={() =>
                      set({
                        ...value,
                        actions: value.actions.filter((_, j) => i !== j),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </ConfigCard>
          {save.error && <ActionError error={save.error} />}
          <div className="flex items-center gap-4">
            <Button disabled={save.isPending}>
              <Save />
              {save.isPending ? "保存中" : "保存设置"}
            </Button>
            {stored !== null && (
              <span
                className={`text-xs ${stored ? "text-muted-foreground" : "text-destructive"}`}
              >
                {stored ? "草稿已保存" : "浏览器未能保存草稿，请及时保存设置"}
              </span>
            )}
          </div>
        </fieldset>
      </form>
    </>
  );
}
