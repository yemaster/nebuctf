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
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { ConfigCard } from "@/components/admin/config-card";

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
    <FieldSet className="min-w-0">
      <FieldLegend>{title}</FieldLegend>
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </FieldSet>
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
    <label className="flex min-h-9 items-center gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      <span className="min-w-0 space-y-1">
        <span className="block font-medium">{label}</span>
        {children && (
          <span className="block text-xs leading-5 text-muted-foreground">
            {children}
          </span>
        )}
      </span>
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
  const [destroyOnSolve, setDestroyOnSolve] = useState(!!data.destroy_on_solve);
  const [unlimitedOwner, setUnlimitedOwner] = useState(
    data.max_owner_instances === null,
  );
  const [unlimitedGlobal, setUnlimitedGlobal] = useState(
    data.max_instances === null,
  );
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
      <ConfigCard>
        <form
          id="system-settings"
          className="space-y-6"
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
                      destroy_on_solve: destroyOnSolve,
                      max_owner_instances: unlimitedOwner
                        ? null
                        : Number(f.get("max_owner_instances")),
                      max_instances: unlimitedGlobal
                        ? null
                        : Number(f.get("max_instances")),
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
                <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
              <Group title="数量限制">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="单人 / 战队上限">
                    <div className="flex items-center gap-4">
                      <Input
                        name="max_owner_instances"
                        aria-label="单人 / 战队上限"
                        type="number"
                        min={1}
                        max={10000}
                        required={!unlimitedOwner}
                        disabled={unlimitedOwner}
                        defaultValue={data.max_owner_instances ?? 2}
                      />
                      <span className="shrink-0">
                        <ToggleField
                          label="单人不限"
                          checked={unlimitedOwner}
                          onChange={setUnlimitedOwner}
                        />
                      </span>
                    </div>
                  </Field>
                  <Field label="全局上限">
                    <div className="flex items-center gap-4">
                      <Input
                        name="max_instances"
                        aria-label="全局上限"
                        type="number"
                        min={1}
                        max={100000}
                        required={!unlimitedGlobal}
                        disabled={unlimitedGlobal}
                        defaultValue={data.max_instances ?? 64}
                      />
                      <span className="shrink-0">
                        <ToggleField
                          label="全局不限"
                          checked={unlimitedGlobal}
                          onChange={setUnlimitedGlobal}
                        />
                      </span>
                    </div>
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  练习按个人、比赛按战队计算。包含排队任务与附件环境；CPU、内存和比赛配额仍生效。
                </p>
              </Group>
              <Group title="时长与续期">
                <div className="grid gap-5 sm:grid-cols-3">
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
              <Group title="自动回收">
                <ToggleField
                  label="完成解题后销毁靶机"
                  checked={destroyOnSolve}
                  onChange={setDestroyOnSolve}
                >
                  全部小题解答后回收独立靶机。公共环境、AWD 和多轮计分环境除外。
                </ToggleField>
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
                <div className="grid items-start gap-5 sm:grid-cols-3 xl:grid-cols-12">
                  <Field
                    label="SMTP 地址"
                    className="sm:col-span-2 xl:col-span-6"
                  >
                    <Input
                      name="host"
                      defaultValue={data.host}
                      required={verification}
                      maxLength={253}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label="端口" className="xl:col-span-2">
                    <Input
                      name="port"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      defaultValue={data.port}
                    />
                  </Field>
                  <Field
                    label="连接加密"
                    className="sm:col-span-3 xl:col-span-4"
                  >
                    <RadioGroup
                      className="flex min-h-9 flex-wrap items-center gap-x-6 gap-y-3"
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
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
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
                <div className="grid gap-5 sm:grid-cols-2">
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
        {section === "mail" && (
          <>
            <Separator className="my-6" />
            <MailTest />
          </>
        )}
      </ConfigCard>
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
    <section className="space-y-5" aria-label="测试已保存配置">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
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
