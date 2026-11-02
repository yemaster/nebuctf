import { copyText } from "@/lib/clipboard";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SubmittedFlag({ value }: { value?: string | null }) {
  if (value == null)
    return <span className="text-xs text-muted-foreground">未记录</span>;
  return (
    <div className="flex max-w-96 items-center gap-2">
      <code className="min-w-0 whitespace-pre-wrap break-all text-xs [unicode-bidi:plaintext]">
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label="复制提交内容"
        onClick={() =>
          copyText(value)
            .then(() => toast.success("已复制"))
            .catch(() => toast.error("复制失败"))
        }
      >
        <Copy />
      </Button>
    </div>
  );
}
