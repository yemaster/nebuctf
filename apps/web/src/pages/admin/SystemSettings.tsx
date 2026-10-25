import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Save, Loader2, Send, PlugZap } from "lucide-react";
import { api, useAPI, useAction } from "@/lib/api";
import { Field, PageTitle, QueryState } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertTitle } from "@/components/ui/alert";

type Section = "site" | "containers" | "mail";
const titles = { site: "系统配置", containers: "容器策略", mail: "邮件策略" };
export function SystemSettings({ section }: { section: Section }) {
  const query = useAPI<Record<string, any>>(`/admin/settings/${section}`);
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
    <SettingsForm
      key={section + JSON.stringify(query.data)}
      section={section}
      data={query.data}
    />
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}
export function ToggleField({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-6 py-2 text-sm">
      <span className="space-y-1">
        <span className="block font-medium">{label}</span>
        {children && (
          <span className="block text-xs leading-5 text-muted-foreground">
            {children}
          </span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
function SettingsForm({
  section,
  data,
}: {
  section: Section;
  data: Record<string, any>;
}) {
  const [autoDestroy, setAutoDestroy] = useState(!!data.auto_destroy),
    [verification, setVerification] = useState(!!data.require_verification),
    [security, setSecurity] = useState(data.security ?? "starttls"),
    [clearPassword, setClearPassword] = useState(false);
  const save = useAction(
    (value: unknown) => api(`/admin/settings/${section}`, "PUT", value),
    () => toast.success("已保存"),
    false,
  );
  return (
    <>
      <PageTitle
        action={
          <Button form="system-settings" disabled={save.isPending}>
            <Save />
            {save.isPending ? "保存中" : "保存"}
          </Button>
        }
      >
        {titles[section]}
      </PageTitle>
      <div className="max-w-4xl space-y-8">
        <form
          id="system-settings"
          className="space-y-8 rounded-xl bg-card p-5 shadow-sm sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              text = (key: string) => String(f.get(key) ?? "");
            save.mutate(
              section === "site"
                ? Object.fromEntries(f)
                : section === "containers"
                  ? {
                      default_ttl: Number(f.get("default_ttl")) * 60,
                      renew_limit: Number(f.get("renew_limit")),
                      renew_seconds: Number(f.get("renew_seconds")) * 60,
                      auto_destroy: autoDestroy,
                    }
                  : {
                      require_verification: verification,
                      allowed_emails: text("allowed_emails")
                        .split(/[\s,，]+/)
                        .filter(Boolean),
                      host: text("host"),
                      port: Number(f.get("port")),
                      security,
                      username: text("username"),
                      password: text("password"),
                      clear_password: clearPassword,
                      from_address: text("from_address"),
                      from_name: text("from_name"),
                    },
            );
          }}
        >
          {section === "site" ? (
            <>
              <Field label="系统名称">
                <Input
                  name="name"
                  defaultValue={data.name}
                  maxLength={48}
                  required
                  className="max-w-lg"
                />
              </Field>
              <Group title="底部信息">
                <Field label="页脚文本">
                  <Input
                    name="footer_text"
                    defaultValue={data.footer_text}
                    maxLength={160}
                    placeholder="留空显示系统名称与年份"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                  <Field label="链接名称">
                    <Input
                      name="footer_link_label"
                      defaultValue={data.footer_link_label}
                      maxLength={40}
                    />
                  </Field>
                  <Field label="链接地址">
                    <Input
                      name="footer_link_url"
                      defaultValue={data.footer_link_url}
                      type="url"
                      maxLength={500}
                      placeholder="https://"
                    />
                  </Field>
                </div>
              </Group>
            </>
          ) : section === "containers" ? (
            <>
              <Group title="时长与续期">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="默认时长（分钟）">
                    <Input
                      name="default_ttl"
                      type="number"
                      min={1}
                      max={1440}
                      required
                      defaultValue={data.default_ttl / 60}
                    />
                  </Field>
                  <Field label="续期次数">
                    <Input
                      name="renew_limit"
                      type="number"
                      min={0}
                      max={100}
                      required
                      defaultValue={data.renew_limit}
                    />
                  </Field>
                  <Field label="每次增加（分钟）">
                    <Input
                      name="renew_seconds"
                      type="number"
                      min={1}
                      max={1440}
                      required
                      defaultValue={data.renew_seconds / 60}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  新建独立靶机生效。题目可覆盖默认时长，续期不超过比赛截止时间。
                </p>
              </Group>
              <Group title="数量达到上限时">
                <ToggleField
                  label="自动销毁旧实例"
                  checked={autoDestroy}
                  onChange={setAutoDestroy}
                >
                  启动前确认待销毁靶机，只替换同一范围内自己的普通靶机。
                </ToggleField>
              </Group>
            </>
          ) : (
            <>
              <Group title="注册验证">
                <ToggleField
                  label="注册时验证邮箱"
                  checked={verification}
                  onChange={setVerification}
                />
                <Field label="邮箱白名单">
                  <Textarea
                    name="allowed_emails"
                    defaultValue={data.allowed_emails.join("\n")}
                    rows={3}
                    placeholder={"example.com\n*.example.edu\nuser@example.net"}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  每行一个邮箱或域名，留空不限。子域名使用 *.example.com。
                </p>
              </Group>
              <Group title="发件服务器">
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                  <Field label="SMTP 地址">
                    <Input
                      name="host"
                      defaultValue={data.host}
                      required={verification}
                      maxLength={253}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label="端口">
                    <Input
                      name="port"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      defaultValue={data.port}
                    />
                  </Field>
                </div>
                <Field label="连接加密">
                  <RadioGroup
                    className="flex flex-wrap gap-6"
                    value={security}
                    onValueChange={setSecurity}
                  >
                    {[
                      ["starttls", "STARTTLS"],
                      ["tls", "TLS"],
                      ["none", "无加密"],
                    ].map(([value, label]) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 text-sm"
                      >
                        <RadioGroupItem value={value!} />
                        {label}
                      </label>
                    ))}
                  </RadioGroup>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="用户名">
                    <Input
                      name="username"
                      defaultValue={data.username}
                      autoComplete="off"
                      maxLength={254}
                    />
                  </Field>
                  <Field label="密码 / 授权码">
                    <Input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      maxLength={2048}
                      placeholder={data.password_set ? "已设置，留空保留" : ""}
                    />
                  </Field>
                </div>
                {data.password_set && (
                  <ToggleField
                    label="清除已保存密码"
                    checked={clearPassword}
                    onChange={setClearPassword}
                  />
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="发件邮箱">
                    <Input
                      name="from_address"
                      type="email"
                      defaultValue={data.from_address}
                      required={verification}
                      maxLength={254}
                    />
                  </Field>
                  <Field label="发件名称">
                    <Input
                      name="from_name"
                      defaultValue={data.from_name}
                      maxLength={80}
                    />
                  </Field>
                </div>
              </Group>
            </>
          )}
          {save.error && (
            <Alert variant="destructive">
              <AlertTitle>{save.error.message}</AlertTitle>
            </Alert>
          )}
        </form>
        {section === "mail" && <MailTest />}
      </div>
    </>
  );
}
function MailTest() {
  const test = useAction(
    (recipient?: string) =>
      api("/admin/settings/mail/test", "POST", recipient ? { recipient } : {}),
    () => toast.success("测试成功"),
    false,
  );
  return (
    <section className="space-y-4 rounded-xl bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">测试已保存配置</h2>
        <Button
          variant="secondary"
          disabled={test.isPending}
          onClick={() => test.mutate(undefined)}
        >
          <PlugZap />
          测试连接
        </Button>
      </div>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          test.mutate(String(new FormData(e.currentTarget).get("recipient")));
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label="测试收件邮箱">
            <Input name="recipient" type="email" required maxLength={254} />
          </Field>
        </div>
        <Button variant="secondary" disabled={test.isPending}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          发送测试邮件
        </Button>
      </form>
      {test.error && (
        <Alert variant="destructive">
          <AlertTitle>{test.error.message}</AlertTitle>
        </Alert>
      )}
    </section>
  );
}
