import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { FieldLabel } from "../ui/field";

export function HintsEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [keys, setKeys] = useState(() => value.map(() => crypto.randomUUID()));
  function move(index: number, step: number) {
    const next = [...value],
      ids = [...keys];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    [ids[index], ids[index + step]] = [ids[index + step]!, ids[index]!];
    setKeys(ids);
    onChange(next);
  }
  return (
    <div className="space-y-4" aria-label="题目提示编辑">
      {value.map((hint, index) => (
        <div key={keys[index]} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor={`hint-${keys[index]}`}>
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
                  setKeys(keys.filter((_, i) => i !== index));
                  onChange(value.filter((_, i) => i !== index));
                }}
              >
                <X />
              </Button>
            </div>
          </div>
          <Textarea
            id={`hint-${keys[index]}`}
            aria-label={`提示 ${index + 1}`}
            value={hint}
            onChange={(e) =>
              onChange(value.map((v, i) => (i === index ? e.target.value : v)))
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
          setKeys([...keys, crypto.randomUUID()]);
          onChange([...value, ""]);
        }}
      >
        <Plus />
        添加提示
      </Button>
    </div>
  );
}
