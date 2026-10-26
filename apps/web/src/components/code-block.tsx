import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Download, WrapText } from "lucide-react";
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import c from "refractor/c";
import cpp from "refractor/cpp";
import css from "refractor/css";
import javascript from "refractor/javascript";
import json from "refractor/json";
import markup from "refractor/markup";
import python from "refractor/python";
import sql from "refractor/sql";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";
for (const language of [
  markup,
  css,
  javascript,
  typescript,
  c,
  cpp,
  bash,
  python,
  json,
  sql,
  yaml,
])
  refractor.register(language);

type Token = {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: Token[];
};
function tokens(nodes: Token[]): ReactNode {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      node.value
    ) : (
      <span
        key={i}
        className={
          Array.isArray(node.properties?.className)
            ? node.properties.className.join(" ")
            : undefined
        }
      >
        {tokens(node.children ?? [])}
      </span>
    ),
  );
}
async function copyCode(value: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(value);
  const selection = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = value;
  field.className = "sr-only";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw Error("copy failed");
  } finally {
    field.remove();
    selection?.focus({ preventScroll: true });
  }
}
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [wrap, setWrap] = useState(false),
    [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => {
    if (!language || code.length > 30000 || !refractor.registered(language))
      return code;
    try {
      return tokens(refractor.highlight(code, language).children);
    } catch {
      return code;
    }
  }, [code, language]);
  const action = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    pressed?: boolean,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="my-5 min-w-0 overflow-hidden rounded-lg bg-muted/70"
        data-code-block
      >
        <div className="flex items-center justify-between gap-3 border-b px-3 py-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            {language || "text"}
          </span>
          <div className="flex gap-1">
            {action("自动换行", <WrapText />, () => setWrap(!wrap), wrap)}
            {action("下载代码", <Download />, () => {
              const blob = new Blob([code], {
                  type: "text/plain;charset=utf-8",
                }),
                url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `code.${({ python: "py", javascript: "js", typescript: "ts", bash: "sh", markup: "html" } as Record<string, string>)[language] ?? (/^[a-z0-9]+$/.test(language) ? language : "txt")}`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })}
            {action(
              copied ? "已复制" : "复制代码",
              copied ? <Check /> : <Copy />,
              () => {
                void copyCode(code)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => toast.error("复制失败，请手动选择代码"));
              },
            )}
          </div>
        </div>
        <pre
          tabIndex={0}
          className="max-h-[32rem]"
          style={{
            margin: 0,
            background: "transparent",
            padding: "1rem",
            whiteSpace: wrap ? "pre-wrap" : "pre",
            overflowWrap: wrap ? "anywhere" : undefined,
          }}
        >
          <code>{highlighted}</code>
        </pre>
      </div>
    </TooltipProvider>
  );
}
