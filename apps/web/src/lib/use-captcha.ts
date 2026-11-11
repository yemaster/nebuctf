import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type {
  CaptchaChallenge,
  CaptchaProof,
  CaptchaPurpose,
} from "./captcha-proof";

type State = {
  status: "idle" | "working" | "verified" | "expired" | "error";
  proof?: CaptchaProof;
  message?: string;
};
export function useCaptcha(purpose: CaptchaPurpose) {
  const [state, setState] = useState<State>({ status: "idle" });
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const working = useRef(false);
  const cancel = useCallback(() => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    abort.current?.abort();
    abort.current = null;
    clearTimeout(timer.current);
    working.current = false;
  }, []);
  const reset = useCallback(() => {
    cancel();
    setState({ status: "idle" });
  }, [cancel]);
  useEffect(() => {
    reset();
    return cancel;
  }, [purpose, reset, cancel]);
  const verify = async () => {
    if (working.current) return;
    cancel();
    const run = generation.current;
    working.current = true;
    setState({ status: "working" });
    const controller = new AbortController();
    abort.current = controller;
    const current = () => run === generation.current;
    const error = (message: string) => {
      if (!current()) return;
      cancel();
      setState({ status: "error", message });
    };
    // A failed request or worker cannot leave the form stuck in verification.
    timer.current = setTimeout(() => error("验证超时，请重试"), 10000);
    try {
      if (typeof Worker === "undefined") {
        error("浏览器不支持安全验证，请更新后重试");
        return;
      }
      const started = performance.now();
      const challenge = await api<CaptchaChallenge>(
        "/captcha/challenge",
        "POST",
        { purpose },
        controller.signal,
      );
      if (!current()) return;
      const remaining =
        challenge.expires_in * 1000 - (performance.now() - started);
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 300000) {
        error("验证已过期，请重试");
        return;
      }
      const engine = new Worker(
        new URL("../workers/captcha.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = engine;
      engine.onerror = () => error("验证加载失败，请重试");
      engine.onmessage = (
        event: MessageEvent<{ nonce?: string; error?: string }>,
      ) => {
        if (!current()) return;
        if (
          event.data.error ||
          !/^[a-f0-9]{16}$/.test(event.data.nonce ?? "")
        ) {
          error(event.data.error ?? "验证失败，请重试");
          return;
        }
        engine.terminate();
        worker.current = null;
        clearTimeout(timer.current);
        const complete = () => {
          if (!current()) return;
          const ttl =
            challenge.expires_in * 1000 - (performance.now() - started);
          if (ttl <= 0) {
            error("验证已过期，请重试");
            return;
          }
          working.current = false;
          setState({
            status: "verified",
            proof: { token: challenge.token, nonce: event.data.nonce! },
          });
          timer.current = setTimeout(() => {
            if (current()) setState({ status: "expired" });
          }, ttl);
        };
        timer.current = setTimeout(
          complete,
          Math.max(0, 500 - (performance.now() - started)),
        );
      };
      engine.postMessage({
        salt: challenge.salt,
        target: challenge.target,
        max_nonce: challenge.max_nonce,
        budget: Math.min(750, remaining),
      });
    } catch (cause) {
      error(cause instanceof ApiError ? cause.message : "验证加载失败，请重试");
    }
  };
  return { ...state, verify, reset };
}
