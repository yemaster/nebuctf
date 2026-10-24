import { lazy, Suspense } from "react";
import { Textarea } from "./ui/input";

const Editor = lazy(() => import("./markdown-editor-impl"));

export interface MarkdownEditorProps {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <>
      {/* The source is submitted in every preview mode, including while loading. */}
      <input type="hidden" name={props.name} value={props.value} />
      <Suspense
        fallback={
          <Textarea
            id={props.id}
            aria-label="题目内容"
            aria-busy="true"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
            maxLength={props.maxLength}
            className="min-h-96"
            placeholder="正在加载 Markdown 编辑器"
          />
        }
      >
        <Editor {...props} />
      </Suspense>
      {props.value.length > (props.maxLength ?? 20000) && (
        <p
          id={`${props.id}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          题面最多 {props.maxLength ?? 20000} 个字符，当前 {props.value.length}{" "}
          个。
        </p>
      )}
    </>
  );
}
