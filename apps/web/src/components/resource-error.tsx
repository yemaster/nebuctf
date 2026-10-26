import { ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

// Keep the recovery action in the resource header; diagnostics stay secondary.
export function ResourceError({ error }: { error: Error | string }) {
  const message = typeof error === "string" ? error : error.message;
  const detailed = message.length > 140 || /[\r\n]/.test(message);
  const action = error instanceof ApiError ? error.action : undefined;
  return (
    <div className="w-full min-w-0 space-y-2 text-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <p role="alert" className="break-words leading-6 text-muted-foreground">
        {detailed ? "本次创建未完成，可重新尝试。" : message}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {action && (
          <Button variant="secondary" size="sm" asChild>
            <Link to={action.href}>{action.label}</Link>
          </Button>
        )}
        {detailed && (
          <Collapsible className="min-w-0 flex-1 basis-full">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="group w-full justify-between text-muted-foreground"
              >
                错误详情
                <ChevronDown className="motion-safe:transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs leading-5 text-muted-foreground">
                {message}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
