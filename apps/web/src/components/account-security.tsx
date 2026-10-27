import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Field, FieldLabel, FieldError, FieldGroup } from "./ui/field";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";

export function AccountSecurity() {
  const cache = useQueryClient(),
    navigate = useNavigate();
  const [values, setValues] = useState({
    current: "",
    password: "",
    confirmation: "",
  });
  const [visible, setVisible] = useState({
    current: false,
    password: false,
    confirmation: false,
  });
  const [mismatch, setMismatch] = useState(false);
  const confirmation = useRef<HTMLInputElement>(null);
  const change = useMutation({
    mutationFn: () =>
      api("/auth/password", "POST", {
        current: values.current,
        password: values.password,
      }),
    onSuccess: () => {
      setValues({ current: "", password: "", confirmation: "" });
      void cache.resetQueries();
      toast.success("密码已修改，请重新登录");
      void navigate("/login", { replace: true });
    },
  });
  return (
    <form
      className="space-y-5"
      aria-label="修改密码"
      onSubmit={(event) => {
        event.preventDefault();
        if (change.isPending) return;
        if (values.password !== values.confirmation) {
          setMismatch(true);
          confirmation.current?.focus();
          return;
        }
        change.mutate();
      }}
    >
      <fieldset disabled={change.isPending}>
        <FieldGroup className="grid gap-4 lg:grid-cols-3">
          {(
            [
              ["current", "当前密码"],
              ["password", "新密码"],
              ["confirmation", "确认新密码"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              className="gap-2"
              data-invalid={key === "confirmation" && mismatch}
            >
              <FieldLabel htmlFor={`account-${key}`}>{label}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={`account-${key}`}
                  name={key}
                  type={visible[key] ? "text" : "password"}
                  ref={key === "confirmation" ? confirmation : undefined}
                  required
                  minLength={key === "current" ? undefined : 8}
                  maxLength={128}
                  autoComplete={
                    key === "current" ? "current-password" : "new-password"
                  }
                  aria-invalid={key === "confirmation" && mismatch}
                  aria-describedby={
                    key === "confirmation" && mismatch
                      ? "account-password-mismatch"
                      : key === "password"
                        ? "account-password-length"
                        : undefined
                  }
                  value={values[key]}
                  onChange={(e) => {
                    setValues({ ...values, [key]: e.target.value });
                    setMismatch(false);
                    if (change.error) change.reset();
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`${visible[key] ? "隐藏" : "显示"}${label}`}
                    aria-pressed={visible[key]}
                    onClick={() =>
                      setVisible({ ...visible, [key]: !visible[key] })
                    }
                  >
                    {visible[key] ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {key === "password" && (
                <p
                  id="account-password-length"
                  className="text-xs text-muted-foreground"
                >
                  至少 8 位
                </p>
              )}
              {key === "confirmation" && mismatch && (
                <FieldError id="account-password-mismatch">
                  两次输入的密码不一致
                </FieldError>
              )}
            </Field>
          ))}
        </FieldGroup>
      </fieldset>
      {change.error && <FieldError>{change.error.message}</FieldError>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={change.isPending}>
          {change.isPending && <Loader2 className="motion-safe:animate-spin" />}
          {change.isPending ? "修改中" : "修改密码"}
        </Button>
        <p className="text-xs text-muted-foreground">修改后需重新登录</p>
      </div>
    </form>
  );
}
