import { Plus, Trash2 } from "lucide-react";
import type { Objective } from "@/lib/competition";
import { randomUUID } from "@/lib/random-uuid";
import { Field } from "../shared";
import { Input, Textarea } from "../ui/input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
export const newObjective = (): Objective => ({
  type: "single",
  options: [
    { id: "A", text: "" },
    { id: "B", text: "" },
  ],
  correct_options: ["A"],
  blanks: [],
  case_sensitive: true,
  trim: true,
});
export function ObjectiveEditor({
  value: v,
  onChange: set,
}: {
  value: Objective;
  onChange: (v: Objective) => void;
}) {
  const correct = v.correct_options ?? [];
  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <Field label="客观题类型">
          <NativeSelect
            value={v.type}
            onChange={(e) => {
              const type = e.target.value as Objective["type"];
              set({
                ...v,
                type,
                options:
                  type === "blank"
                    ? []
                    : v.options.length
                      ? v.options
                      : newObjective().options,
                correct_options:
                  type === "blank"
                    ? []
                    : type === "single"
                      ? [correct[0] ?? "A"]
                      : correct.length
                        ? correct
                        : ["A"],
                blanks:
                  type === "blank"
                    ? v.blanks.length
                      ? v.blanks
                      : [{ id: "blank1", label: "填空 1", answers: [""] }]
                    : [],
              });
            }}
          >
            <NativeSelectOption value="single">单选题</NativeSelectOption>
            <NativeSelectOption value="multiple">多选题</NativeSelectOption>
            <NativeSelectOption value="blank">填空题</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
      {v.type === "blank" ? (
        <div className="space-y-5">
          {v.blanks.map((b, i) => (
            <div
              key={b.id}
              className="grid items-start gap-3 md:grid-cols-[12rem_1fr_auto]"
            >
              <Field label={`空位 ${i + 1}`}>
                <Input
                  required
                  maxLength={100}
                  value={b.label}
                  onChange={(e) =>
                    set({
                      ...v,
                      blanks: v.blanks.map((x) =>
                        x.id === b.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="可接受答案（每行一个）">
                <Textarea
                  required
                  rows={2}
                  value={(b.answers ?? []).join("\n")}
                  onChange={(e) =>
                    set({
                      ...v,
                      blanks: v.blanks.map((x) =>
                        x.id === b.id
                          ? { ...x, answers: e.target.value.split("\n") }
                          : x,
                      ),
                    })
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={`删除空位 ${i + 1}`}
                disabled={v.blanks.length === 1}
                onClick={() =>
                  set({ ...v, blanks: v.blanks.filter((x) => x.id !== b.id) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={v.blanks.length >= 10}
            onClick={() =>
              set({
                ...v,
                blanks: [
                  ...v.blanks,
                  {
                    id: randomUUID(),
                    label: `填空 ${v.blanks.length + 1}`,
                    answers: [""],
                  },
                ],
              })
            }
          >
            <Plus />
            添加空位
          </Button>
          <div className="flex flex-wrap gap-4">
            {(["case_sensitive", "trim"] as const).map((key, i) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Switch
                  checked={v[key]}
                  onCheckedChange={(yes) => set({ ...v, [key]: !!yes })}
                />
                {["区分大小写", "忽略首尾空格"][i]}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {v.options.map((o) => (
            <div
              key={o.id}
              className="flex items-start gap-3 rounded-lg bg-muted/40 p-4"
            >
              <Checkbox
                className="mt-2"
                aria-label={`${o.id} 为正确答案`}
                checked={correct.includes(o.id)}
                onCheckedChange={(yes) =>
                  set({
                    ...v,
                    correct_options:
                      v.type === "single"
                        ? [o.id]
                        : yes
                          ? [...correct, o.id]
                          : correct.filter((id) => id !== o.id),
                  })
                }
              />
              <span className="pt-1.5 text-sm font-medium">{o.id}</span>
              <Textarea
                aria-label={`选项 ${o.id}`}
                required
                maxLength={2000}
                rows={2}
                value={o.text}
                onChange={(e) =>
                  set({
                    ...v,
                    options: v.options.map((x) =>
                      x.id === o.id ? { ...x, text: e.target.value } : x,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`删除选项 ${o.id}`}
                disabled={v.options.length <= 2}
                onClick={() =>
                  set({
                    ...v,
                    options: v.options.filter((x) => x.id !== o.id),
                    correct_options: correct.filter((id) => id !== o.id),
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              disabled={v.options.length >= 12}
              onClick={() => {
                const id = Array.from({ length: 12 }, (_, i) =>
                  String.fromCharCode(65 + i),
                ).find((id) => !v.options.some((o) => o.id === id))!;
                set({ ...v, options: [...v.options, { id, text: "" }] });
              }}
            >
              <Plus />
              添加选项
            </Button>
            <span className="text-sm text-muted-foreground">勾选正确答案</span>
          </div>
        </div>
      )}
    </div>
  );
}
