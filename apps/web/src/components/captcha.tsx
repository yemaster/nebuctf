import { Check, LoaderCircle, RotateCw, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import type { useCaptcha } from "@/lib/use-captcha";
import { CaptchaLabel } from "./captcha-label";

export function Captcha({
  verification,
  disabled = false,
}: {
  verification: ReturnType<typeof useCaptcha>;
  disabled?: boolean;
}) {
  const { status, message, verify } = verification;
  const working = status === "working",
    verified = status === "verified";
  const Icon = working
    ? LoaderCircle
    : verified
      ? Check
      : status === "error" || status === "expired"
        ? RotateCw
        : ShieldCheck;
  const text = working
    ? "正在验证"
    : verified
      ? "验证通过"
      : status === "expired"
        ? "验证已过期，点击重试"
        : status === "error"
          ? "重新验证"
          : "点击完成安全验证";
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full justify-start gap-3 font-normal disabled:opacity-100"
        disabled={disabled || working || verified}
        onClick={() => void verify()}
        aria-busy={working}
        aria-label={text}
      >
        <Icon
          className={
            working
              ? "animate-spin motion-reduce:animate-none"
              : verified
                ? "text-success"
                : "text-muted-foreground"
          }
        />
        <CaptchaLabel text={text} working={working} verified={verified} />
      </Button>
      {status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
