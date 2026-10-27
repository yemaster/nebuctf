import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleHelp, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export function FlagTemplate({
  value,
  onChange,
  inherited,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  inherited?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const effective = value || inherited || "";
  const preview = useMutation({
    mutationFn: (template: string) =>
      api<{ samples: string[]; entropy: number; length: number }>(
        "/admin/flag-template/preview",
        "POST",
        { template },
      ),
  });
  const current = preview.variables === effective;
  const error = current ? preview.error : null;
  const result = current ? preview.data : null;
  return (
    <section className="min-w-0 space-y-2" aria-label="Flag 模板配置">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Flag 模板
        </label>
        {inherited === undefined && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Flag 模板语法"
              >
                <CircleHelp className="text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3 text-sm">
              <p className="font-medium">模板语法</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="font-mono">[GUID]</dt>
                <dd>UUID 标识</dd>
                <dt className="font-mono">[TEAM_HASH]</dt>
                <dd>战队专属标识</dd>
                <dt className="font-mono">[LEET]</dt>
                <dd>置于开头，替换括号内字符</dd>
                <dt className="font-mono">[CLEET]</dt>
                <dd>字符替换允许特殊符号</dd>
              </dl>
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">
                NebuCTF&#123;[GUID]&#125;
              </code>
              <p className="text-xs text-muted-foreground">
                不含占位符时自动使用
                Leet；留空保留平台默认格式。特殊符号须按普通文本处理。
              </p>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="font-mono"
          maxLength={256}
          value={value}
          placeholder={
            inherited === undefined ? "flag{[GUID]}" : "沿用题目模板"
          }
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || preview.isPending}
          onClick={() => preview.mutate(effective)}
        >
          <RefreshCw
            className={
              preview.isPending ? "motion-safe:animate-spin" : undefined
            }
          />
          预览
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {result && (
        <div
          className="space-y-2 rounded-md bg-muted/50 p-3"
          aria-label="Flag 生成预览"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>示例 Flag</span>
            <span>{result.length} 字符</span>
          </div>
          <ul className="space-y-1 font-mono text-xs leading-5">
            {result.samples.map((sample, index) => (
              <li key={index} className="break-all select-all">
                {sample}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
