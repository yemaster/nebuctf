import type { ReactNode, ComponentProps } from "react";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

export function TerminalTool({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={label}
            {...props}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export type TerminalFrameProps = {
  title: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  progress?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
};
export function TerminalFrame({
  title,
  actions,
  status,
  progress,
  notice,
  children,
}: TerminalFrameProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            {title}
            {status}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
          </div>
        </header>
        <div className="shrink-0 empty:hidden [&:not(:empty)]:px-4 [&:not(:empty)]:py-2">
          {progress}
        </div>
        {notice && <div className="shrink-0 px-4 pb-2">{notice}</div>}
        {children}
      </div>
    </TooltipProvider>
  );
}
