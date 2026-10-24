import { contextualActionPath } from "./utils";
import { createElement } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  QueryClient,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
export const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false },
  },
});
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly action?: { label: string; href: string },
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "x-csrf-protection": "1" } : {}),
      ...(body instanceof FormData
        ? {}
        : body
          ? { "content-type": "application/json" }
          : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      typeof data?.error === "string" ? data.error : "请求失败，请稍后重试",
      res.status,
      data?.action &&
        typeof data.action.label === "string" &&
        /^\/(?![\/\\])/.test(data.action.href)
        ? {
            label: data.action.label,
            href: contextualActionPath(data.action.href),
          }
        : undefined,
      typeof data?.retry_after === "number" &&
        Number.isFinite(data.retry_after) &&
        data.retry_after > 0
        ? data.retry_after
        : undefined,
    );
  if (data === null) throw new ApiError("服务器返回了无效数据", 502);
  return data;
}
export function useAPI<T>(path: string, enabled = true, poll?: number) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled,
    refetchInterval: poll,
  });
}
export function useAction<T = unknown>(
  fn: (value: T) => Promise<unknown>,
  success?: () => void,
  notifyError = true,
) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void cache.invalidateQueries();
      success?.();
    },
    onError: (e: Error) =>
      notifyError &&
      toast.error(e.message, {
        action:
          e instanceof ApiError && e.action
            ? createElement(
                Button,
                {
                  variant: "secondary",
                  size: "sm",
                  onClick: () => navigate(e.action!.href),
                },
                e.action.label,
              )
            : undefined,
      }),
  });
}
