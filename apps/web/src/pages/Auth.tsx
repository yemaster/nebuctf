import { useSiteSettings } from "@/lib/site-settings";
import { Eye, EyeOff, Loader2, CircleAlert } from "lucide-react";
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
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, client } from "@/lib/api";
import { safeLocalPath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { QueryState } from "@/components/shared";

import { useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Captcha } from "@/components/captcha";
import { useCaptcha } from "@/lib/use-captcha";
export function Auth({ register = false }: { register?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <section className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6">
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={register ? "register" : "login"}
          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
          className="my-auto w-full max-w-sm shrink-0"
          data-auth-panel={register ? "register" : "login"}
        >
          <AuthForm register={register} />
        </m.div>
      </AnimatePresence>
    </section>
  );
}

function AuthForm({ register }: { register: boolean }) {
  const navigate = useNavigate();
  const site = useSiteSettings();
  const [mailProof, setMailProof] = useState<{
    id: string;
    email: string;
  } | null>(null);
  const verification = useCaptcha(register ? "register" : "login");
  const [params] = useSearchParams();
  const next = safeLocalPath(params.get("next"));
  const [showPassword, setShowPassword] = useState(false);
  const action = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      api<Record<string, any>>(
        register && site.data?.email_verification && !mailProof
          ? "/auth/email-code"
          : `/auth/${register ? "register" : "login"}`,
        "POST",
        d,
      ),
    onSettled: verification.reset,
    onSuccess: (result, submitted) => {
      if (register && result.id && !result.user) {
        setMailProof({ id: result.id, email: String(submitted.email) });
        return;
      }
      void client.resetQueries();
      navigate(next, { replace: true });
    },
  });
  if (register && (site.isLoading || site.error))
    return (
      <QueryState
        variant="auth-register"
        loading={site.isLoading}
        error={site.error}
        retry={() => void site.refetch()}
      />
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl">{register ? "注册" : "登录"}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if ((!mailProof && !verification.proof) || action.isPending) return;
            action.mutate({
              ...Object.fromEntries(new FormData(e.currentTarget)),
              captcha: verification.proof,
              ...(mailProof
                ? {
                    email_verification: {
                      id: mailProof.id,
                      code: new FormData(e.currentTarget).get("email_code"),
                    },
                  }
                : {}),
            });
          }}
        >
          <FieldGroup className="gap-5">
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
                readOnly={!!mailProof}
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
            {mailProof ? (
              <div className="space-y-3">
                <FormField>
                  <FieldLabel htmlFor="email-code">邮箱验证码</FieldLabel>
                  <Input
                    id="email-code"
                    name="email_code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    minLength={6}
                    required
                    autoFocus
                    className="h-12 text-center text-lg tracking-widest"
                  />
                </FormField>
                <p className="text-xs text-muted-foreground">
                  已发送至 {mailProof.email}，10 分钟内有效。
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => {
                    setMailProof(null);
                    action.reset();
                  }}
                >
                  更换邮箱或重新发送
                </Button>
              </div>
            ) : (
              <Captcha
                verification={verification}
                disabled={action.isPending}
              />
            )}
            {action.error && (
              <Alert
                variant="destructive"
                className="border-0 bg-destructive/10"
              >
                <CircleAlert />
                <AlertTitle>{action.error.message}</AlertTitle>
              </Alert>
            )}
            <Button
              className="h-12 w-full"
              disabled={action.isPending || (!mailProof && !verification.proof)}
            >
              {action.isPending ? <Loader2 className="animate-spin" /> : null}
              {action.isPending
                ? register
                  ? "注册中"
                  : "登录中"
                : register
                  ? site.data?.email_verification && !mailProof
                    ? "发送验证码"
                    : "注册"
                  : "登录"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Button variant="link" size="sm" asChild>
          <Link
            to={`${register ? "/login" : "/register"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            {register ? "返回登录" : "注册账户"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
