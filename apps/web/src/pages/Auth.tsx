import {
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  Flag,
  Loader2,
  Trophy,
  CircleAlert,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import {
  Field as FormField,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { TableRow, TableCell } from "@/components/ui/table";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@/App";
import { api, useAction, useAPI, client } from "@/lib/api";
import type { Submission } from "@/lib/types";
import { date, safeLocalPath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  PageTitle,
  LoginPrompt,
  Table,
  Empty,
  QueryState,
  Pagination,
} from "@/components/shared";
import { useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Captcha } from "@/components/captcha";
import { useCaptcha } from "@/lib/use-captcha";
import { toast } from "sonner";
export function Auth({ register = false }: { register?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div className="grid h-full min-h-0 grid-rows-1 lg:grid-cols-2">
      <aside
        data-auth-brand
        className="hidden flex-col justify-center gap-16 bg-card p-12 lg:flex xl:p-20"
      >
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">Capture the Flag</p>
          <p className="text-7xl font-semibold xl:text-8xl">NebuCTF</p>
        </div>
        <nav aria-label="访客入口" className="grid max-w-md gap-2">
          {[
            { to: "/challenges", title: "练习场", icon: Flag },
            { to: "/contests", title: "比赛", icon: Trophy },
            { to: "/library", title: "知识库", icon: BookOpen },
          ].map((item) => (
            <Button
              key={item.to}
              variant="ghost"
              size="lg"
              className="h-14 justify-start px-0 text-base hover:px-4"
              asChild
            >
              <Link to={item.to}>
                <item.icon className="mr-2 text-muted-foreground" />
                {item.title}
                <ArrowRight className="ml-auto" />
              </Link>
            </Button>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-0 flex-col items-center overflow-y-auto px-6 py-12 sm:px-12 lg:py-16">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={register ? "register" : "login"}
            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
            className="my-auto w-full max-w-md shrink-0"
            data-auth-panel={register ? "register" : "login"}
          >
            <AuthForm register={register} />
          </m.div>
        </AnimatePresence>
      </section>
    </div>
  );
}

function AuthForm({ register }: { register: boolean }) {
  const navigate = useNavigate();
  const verification = useCaptcha(register ? "register" : "login");
  const [params] = useSearchParams();
  const next = safeLocalPath(params.get("next"));
  const [showPassword, setShowPassword] = useState(false);
  const action = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      api(`/auth/${register ? "register" : "login"}`, "POST", d),
    onSettled: verification.reset,
    onSuccess: () => {
      void client.resetQueries();
      navigate(next, { replace: true });
    },
  });
  return (
    <div className="w-full max-w-md space-y-10">
      <div className="space-y-5">
        <h1 className="text-4xl font-semibold sm:text-5xl">
          {register ? "创建账户" : "登录"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {register ? "已有账户？" : "还没有账户？"}{" "}
          <Link
            className="text-primary hover:underline underline-offset-4"
            to={`${register ? "/login" : "/register"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            {register ? "登录" : "注册"}
          </Link>
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!verification.proof || action.isPending) return;
          action.mutate({
            ...Object.fromEntries(new FormData(e.currentTarget)),
            captcha: verification.proof,
          });
        }}
      >
        <FieldGroup className="gap-6">
          {register && (
            <FormField>
              <FieldLabel htmlFor="auth-username">用户名</FieldLabel>
              <Input
                id="auth-username"
                className="h-12"
                name="username"
                required
                minLength={2}
                maxLength={32}
                autoComplete="username"
                disabled={action.isPending}
              />
            </FormField>
          )}
          <FormField>
            <FieldLabel htmlFor={register ? "auth-email" : "auth-identifier"}>
              {register ? "邮箱" : "用户名或邮箱"}
            </FieldLabel>
            <Input
              id={register ? "auth-email" : "auth-identifier"}
              className="h-12"
              name={register ? "email" : "identifier"}
              required
              type={register ? "email" : "text"}
              maxLength={254}
              autoComplete={register ? "email" : "username"}
              autoCapitalize="none"
              spellCheck={false}
              disabled={action.isPending}
            />
          </FormField>
          <FormField>
            <FieldLabel htmlFor="auth-password">密码</FieldLabel>
            <InputGroup className="h-12">
              <InputGroupInput
                id="auth-password"
                name="password"
                required
                type={showPassword ? "text" : "password"}
                minLength={register ? 8 : 1}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={register ? "至少 8 位" : undefined}
                disabled={action.isPending}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </FormField>
          <Captcha verification={verification} disabled={action.isPending} />
          {action.error && (
            <Alert variant="destructive" className="border-0 bg-destructive/10">
              <CircleAlert />
              <AlertTitle>{action.error.message}</AlertTitle>
            </Alert>
          )}
          <Button
            className="mt-2 h-12 w-full text-base"
            disabled={action.isPending || !verification.proof}
          >
            {action.isPending ? <Loader2 className="animate-spin" /> : null}
            {action.isPending
              ? register
                ? "注册中"
                : "登录中"
              : register
                ? "注册"
                : "登录"}
            {!action.isPending && <ArrowRight className="ml-auto" />}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
export function Account() {
  const user = useUser(),
    navigate = useNavigate();
  const [page, setPage] = useState(1);
  const submissions = useAPI<{ items: Submission[] }>(
    `/submissions?page=${page}`,
    !!user,
  );
  const change = useAction(
    (d: Record<string, FormDataEntryValue>) => api("/auth/password", "POST", d),
    () => {
      void client.resetQueries();
      toast.success("密码已修改，请重新登录");
      navigate("/login");
    },
  );
  if (!user) return <LoginPrompt />;
  if (submissions.error || submissions.isLoading)
    return (
      <QueryState
        loading={submissions.isLoading}
        error={submissions.error}
        retry={() => void submissions.refetch()}
        fullPage
      />
    );
  return (
    <>
      <PageTitle>我的账户</PageTitle>
      <div className="grid gap-7 xl:grid-cols-[1fr_1.6fr]">
        <section className="rounded-lg bg-card h-fit p-6">
          <h2 className="text-sm font-medium mb-1">{user.username}</h2>
          <p className="text-sm text-muted-foreground mb-7">{user.email}</p>
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }}
          >
            <Field label="当前密码">
              <Input
                type="password"
                name="current"
                required
                autoComplete="current-password"
              />
            </Field>
            <Field label="新密码">
              <Input
                type="password"
                name="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            <Button disabled={change.isPending}>更新密码</Button>
          </form>
        </section>
        <section>
          <h2 className="text-sm font-medium mb-4">提交记录</h2>
          <QueryState
            loading={submissions.isLoading}
            error={submissions.error}
          />
          <Table headers={["题目", "结果", "时间"]}>
            {submissions.data?.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {s.title}
                  {s.part_title && (
                    <span className="ml-3 text-muted-foreground">
                      {s.part_title}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={s.correct ? "text-success" : "text-destructive"}
                >
                  {s.correct ? "正确" : "错误"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {date(s.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </Table>
          {submissions.data?.items.length === 0 && (
            <Empty>还没有提交记录</Empty>
          )}
          <Pagination
            page={page}
            setPage={setPage}
            hasMore={(submissions.data?.items.length ?? 0) === 30}
          />
        </section>
      </div>
    </>
  );
}
