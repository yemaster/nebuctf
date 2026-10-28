import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Upload } from "lucide-react";
import type { User } from "@/lib/types";
import { api } from "@/lib/api";
import { UserAvatar } from "./user-avatar";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";

export function AccountAvatar({ user }: { user: User }) {
  const input = useRef<HTMLInputElement>(null),
    label = useId();
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api<{ avatar_id: null }>("/account/avatar", "DELETE");
      const form = new FormData();
      form.set("file", file);
      return api<{ avatar_id: string }>("/account/avatar", "POST", form);
    },
    onSuccess: ({ avatar_id }) => {
      cache.setQueryData<{ user: User | null }>(["/me"], (previous) =>
        previous?.user?.id === user.id
          ? { user: { ...previous.user, avatar_id } }
          : previous,
      );
      void cache.invalidateQueries();
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5" aria-labelledby={label}>
        <UserAvatar
          name={user.username}
          avatarId={user.avatar_id}
          className="size-20 text-2xl"
        />
        <div className="min-w-0 space-y-2">
          <h3 id={label} className="text-sm font-medium">
            头像
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              className="hidden"
              aria-label="选择头像"
              accept="image/jpeg,image/png,image/webp"
              disabled={change.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                change.reset();
                setError("");
                if (file.size > 5 * 1024 * 1024)
                  return setError("头像不能超过 5 MiB");
                if (
                  !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                )
                  return setError("请选择 PNG、JPEG 或 WebP 图片");
                change.mutate(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={change.isPending}
              onClick={() => input.current?.click()}
            >
              {change.isPending ? (
                <Loader2 className="motion-safe:animate-spin" />
              ) : (
                <Upload />
              )}
              {change.isPending ? "处理中" : "上传头像"}
            </Button>
            {user.avatar_id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={change.isPending}
                onClick={() => {
                  setError("");
                  change.mutate(null);
                }}
              >
                恢复默认
              </Button>
            )}
            {change.isSuccess && !error && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-xs text-success"
              >
                <Check className="size-3.5" />
                已更新
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG / JPEG / WebP，最大 5 MiB
          </p>
        </div>
      </div>
      {(error || change.error) && (
        <FieldError>{error || change.error?.message}</FieldError>
      )}
    </div>
  );
}
