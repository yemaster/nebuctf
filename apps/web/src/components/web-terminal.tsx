import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Copy, Eraser, RotateCw } from "lucide-react";
import { Button } from "./ui/button";
import { useTheme } from "./theme-provider";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

export function WebTerminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal>(null);
  const { resolved } = useTheme();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<
    "connecting" | "ready" | "closed" | "replaced"
  >("connecting");
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.3,
      cursorBlink: false,
      scrollback: 3000,
      convertEol: false,
      allowProposedApi: false,
      disableStdin: true,
      screenReaderMode: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    setStatus("connecting");
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/terminal/${id}/connect`,
    );
    socket.binaryType = "arraybuffer";
    let ready = false,
      disposed = false,
      frame = 0,
      pendingOutput = 0;
    const send = (value: unknown) => {
      if (ready && socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(value));
    };
    const resize = () => {
      if (!host.current?.clientWidth || !host.current?.clientHeight) return;
      fit.fit();
      // Keep the renderer and remote PTY on the same bounded dimensions.
      if (term.cols > 300 || term.rows > 120)
        term.resize(Math.min(300, term.cols), Math.min(120, term.rows));
      send({
        type: "resize",
        cols: Math.min(300, term.cols),
        rows: Math.min(120, term.rows),
      });
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(host.current);
    socket.onmessage = (event) => {
      if (disposed) return;
      if (typeof event.data === "string") {
        try {
          if (JSON.parse(event.data).type === "ready") {
            ready = true;
            term.options.disableStdin = false;
            setStatus("ready");
            resize();
            term.focus();
          }
        } catch {
          socket.close();
        }
      } else {
        const data = new Uint8Array(event.data as ArrayBuffer);
        pendingOutput += data.byteLength;
        if (pendingOutput > 1024 * 1024) {
          socket.close(1000, "Output too fast");
          return;
        }
        term.write(data, () => {
          pendingOutput -= data.byteLength;
        });
      }
    };
    socket.onclose = (event) => {
      if (!disposed) {
        ready = false;
        term.options.disableStdin = true;
        setStatus(event.code === 4001 ? "replaced" : "closed");
      }
    };
    socket.onerror = () => {
      if (!disposed) setStatus("closed");
    };
    const input = term.onData((data) => {
      // Keep UTF-8 and JSON escape overhead below the socket's 1 KiB frame limit.
      const chars = Array.from(data);
      for (let n = 0; n < chars.length; n += 100) {
        if (socket.bufferedAmount > 65536) {
          socket.close();
          break;
        }
        send({ type: "input", data: chars.slice(n, n + 100).join("") });
      }
    });
    const selection = term.onSelectionChange(() =>
      setSelected(term.hasSelection()),
    );
    return () => {
      disposed = true;
      ready = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      socket.close();
      input.dispose();
      selection.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [id, revision]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme =
        resolved === "dark"
          ? {
              background: "#141414",
              foreground: "#fafafa",
              cursor: "#fafafa",
              selectionBackground: "#525252",
            }
          : {
              background: "#ffffff",
              foreground: "#171717",
              cursor: "#171717",
              selectionBackground: "#d4d4d4",
            };
  }, [resolved, revision, id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="font-mono text-xs">bash</span>
        <span
          role="status"
          className={`text-xs ${status === "ready" ? "text-success" : "text-muted-foreground"}`}
        >
          {status === "ready"
            ? "已连接"
            : status === "connecting"
              ? "连接中"
              : status === "replaced"
                ? "已在其他窗口连接"
                : "连接已断开"}
        </span>
        {(status === "closed" || status === "replaced") && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RotateCw />
            重新连接
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="复制选中内容"
            title="复制选中内容"
            disabled={!selected}
            onClick={() =>
              void copyText(terminal.current?.getSelection() ?? "").catch(
                (e: Error) => toast.error(e.message),
              )
            }
          >
            <Copy className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="清屏"
            title="清屏"
            onClick={() => {
              terminal.current?.clear();
              terminal.current?.focus();
            }}
          >
            <Eraser className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 bg-white p-4 dark:bg-[#141414]"
        onClick={() => terminal.current?.focus()}
      >
        <div ref={host} className="h-full w-full" aria-label="Linux 终端" />
      </div>
    </div>
  );
}
