import { lazy, Suspense, useEffect, useRef } from "react";
import { Textarea } from "./ui/input";

const Editor = lazy(() => import("./markdown-editor-impl"));

export interface MarkdownEditorProps {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  label?: string;
  placeholder?: string;
  required?: boolean;
  height?: number;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const validationRef = useRef<HTMLTextAreaElement>(null);
  const label = props.label ?? "Markdown 正文";
  const maxLength = props.maxLength ?? 20000;
  const invalid = props.value.length > maxLength;
  useEffect(() => {
    validationRef.current?.setCustomValidity(
      invalid ? `${label}最多 ${maxLength} 个字符` : "",
    );
  }, [invalid, label, maxLength]);
  return (
    <>
      {/* Preview unmounts the editor input; keep source and validation mounted. */}
      <textarea
        ref={validationRef}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onInvalid={(event) => event.preventDefault()}
        required={props.required}
        maxLength={maxLength}
        disabled={props.disabled}
      />
      <Suspense
        fallback={
          <Textarea
            id={props.id}
            aria-label={label}
            aria-busy="true"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${props.id}-error` : undefined}
            value={props.value}
            disabled
            maxLength={maxLength}
            required={props.required}
            style={{ height: props.height ?? 420 }}
            placeholder={props.placeholder ?? "正在加载 Markdown 编辑器"}
          />
        }
      >
        <Editor {...props} validationRef={validationRef} />
      </Suspense>
      {invalid && (
        <p
          id={`${props.id}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {label}最多 {maxLength} 个字符，当前 {props.value.length} 个。
        </p>
      )}
    </>
  );
}
