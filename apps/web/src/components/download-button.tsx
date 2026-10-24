import { useEffect, useRef, useState } from "react";
import { Download, FileArchive, Loader2, Check, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemMedia,
  ItemActions,
} from "./ui/item";
import { ActionError } from "./action-error";
export function DownloadButton({
  href,
  name,
  size,
  embedded = false,
  row = false,
  label = "下载附件",
}: {
  href: string;
  name: string;
  size?: number;
  embedded?: boolean;
  row?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const [action, setAction] = useState<{ label: string; href: string } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(reset.current);
    },
    [],
  );
  async function download() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    clearTimeout(reset.current);
    setBusy(true);
    setDone(false);
    setError("");
    setAction(null);
    try {
      const response = await fetch(href, {
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (
          typeof body.action?.label === "string" &&
          typeof body.action.href === "string" &&
          /^\/(?![\/\\])/.test(body.action.href)
        )
          setAction(body.action);
        else if (response.status === 401)
          setAction({ label: "登录后下载", href: "/login" });
        throw Error(
          typeof body.error === "string" ? body.error : "下载失败，请重试",
        );
      }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
      reset.current = setTimeout(() => setDone(false), 1800);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const actions = (
    <ItemActions className="shrink-0">
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? (
          <Loader2 className="motion-safe:animate-spin" />
        ) : done ? (
          <Check className="text-success motion-safe:animate-in motion-safe:zoom-in-50" />
        ) : (
          <Download />
        )}
        {busy ? "下载中" : done ? "已下载" : label}
      </Button>
      {busy && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="取消下载"
          onClick={() => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
          }}
        >
          <X />
        </Button>
      )}
    </ItemActions>
  );
  return (
    <div
      className={embedded ? "min-w-0 space-y-2" : "w-full min-w-0 space-y-3"}
    >
      {embedded ? (
        actions
      ) : (
        <Item
          variant="muted"
          className={
            row
              ? "gap-4 rounded-none border-0 bg-transparent p-5 sm:px-6 sm:py-4"
              : "gap-4 rounded-xl border-0 bg-card p-5 shadow-sm ring-1 ring-border/60"
          }
        >
          <ItemMedia className="size-10 rounded-lg bg-muted text-muted-foreground">
            <FileArchive className="size-5" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="break-all leading-6">{name}</ItemTitle>
            {size !== undefined && (
              <ItemDescription className="text-xs">
                {size < 1048576
                  ? `${Math.max(1, Math.round(size / 1024))} KB`
                  : `${(size / 1048576).toFixed(1)} MB`}
              </ItemDescription>
            )}
          </ItemContent>
          {actions}
        </Item>
      )}
      {error && (
        <div className={row ? "px-5 pb-4 sm:px-6" : undefined}>
          <ActionError error={error} action={action} />
        </div>
      )}
    </div>
  );
}
