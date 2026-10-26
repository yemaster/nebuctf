import type { HintDefinition } from "@/lib/hints";
import { randomUUID } from "@/lib/random-uuid";
import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { FieldLabel } from "../ui/field";

export function HintsEditor({
  value,
  onChange,
  disabled,
}: {
  value: HintDefinition[];
  onChange: (value: HintDefinition[]) => void;
  disabled?: boolean;
}) {
  function move(index: number, step: number) {
    const next = [...value];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    onChange(next);
  }
  return (
    <div className="space-y-4" aria-label="题目提示编辑">
      {value.map((hint, index) => (
        <div key={hint.id} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor={`hint-${hint.id}`}>
              提示 {index + 1}
            </FieldLabel>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`上移提示 ${index + 1}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`下移提示 ${index + 1}`}
                disabled={disabled || index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`删除提示 ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  onChange(value.filter((_, i) => i !== index));
                }}
              >
                <X />
              </Button>
            </div>
          </div>
          <Textarea
            id={`hint-${hint.id}`}
            aria-label={`提示 ${index + 1}`}
            value={hint.content}
            onChange={(e) =>
              onChange(
                value.map((v, i) =>
                  i === index ? { ...v, content: e.target.value } : v,
                ),
              )
            }
            rows={2}
            maxLength={2000}
            disabled={disabled}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || value.length >= 10}
        onClick={() => {
          onChange([...value, { id: randomUUID(), content: "" }]);
        }}
      >
        <Plus />
        添加提示
      </Button>
    </div>
  );
}
