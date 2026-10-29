import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { randomUUID } from "@/lib/random-uuid";
import { fieldTypes, type RegistrationField } from "@/lib/registration-form";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Switch } from "../ui/switch";
import { Field } from "../shared";
import { RegistrationFields } from "../registration-fields";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";

export function RegistrationFormEditor({
  value,
  onChange,
}: {
  value: RegistrationField[];
  onChange: (value: RegistrationField[]) => void;
}) {
  const update = (id: string, patch: Partial<RegistrationField>) =>
    onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const add = (
    type: RegistrationField["type"],
    label: string,
    scope: RegistrationField["scope"] = "member",
  ) =>
    onChange([
      ...value,
      { id: randomUUID(), label, type, scope, required: true, options: [] },
    ]);
  const move = (index: number, offset: number) => {
    const fields = [...value];
    [fields[index], fields[index + offset]] = [
      fields[index + offset]!,
      fields[index]!,
    ];
    onChange(fields);
  };
  return (
    <Tabs defaultValue="edit" className="gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="mr-auto font-medium">报名表单</h2>
        <TabsList variant="line">
          <TabsTrigger value="edit">编辑</TabsTrigger>
          <TabsTrigger value="preview">预览</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="edit" className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["email", "邮箱"],
              ["phone", "手机号"],
              ["address", "证书寄件地址"],
              ["text", "姓名"],
            ] as const
          ).map(([type, label]) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant="outline"
              disabled={value.length >= 20}
              onClick={() => add(type, label)}
            >
              <Plus />
              {label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            disabled={value.length >= 20}
            onClick={() => add("text", "", "team")}
          >
            <Plus />
            自定义字段
          </Button>
        </div>
        {!value.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            未设置额外报名资料
          </p>
        )}
        <div className="divide-y">
          {value.map((f, index) => (
            <div
              key={f.id}
              className="space-y-4 py-5"
              data-registration-field={f.id}
            >
              <div className="flex flex-wrap items-end gap-3">
                <Field label="字段名称" className="min-w-48 flex-1">
                  <Input
                    value={f.label}
                    maxLength={80}
                    required
                    onChange={(e) => update(f.id, { label: e.target.value })}
                  />
                </Field>
                <Field label="类型">
                  <NativeSelect
                    aria-label="类型"
                    value={f.type}
                    onChange={(e) =>
                      update(f.id, {
                        type: e.target.value as RegistrationField["type"],
                      })
                    }
                  >
                    {Object.entries(fieldTypes).map(([v, l]) => (
                      <NativeSelectOption key={v} value={v}>
                        {l}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="填写范围">
                  <NativeSelect
                    aria-label="填写范围"
                    value={f.scope}
                    onChange={(e) =>
                      update(f.id, {
                        scope: e.target.value as "team" | "member",
                      })
                    }
                  >
                    <NativeSelectOption value="team">
                      整队一份
                    </NativeSelectOption>
                    <NativeSelectOption value="member">
                      每位队员
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <label className="flex h-9 items-center gap-2 px-2 text-sm">
                  <Switch
                    checked={f.required}
                    onCheckedChange={(required) => update(f.id, { required })}
                  />
                  必填
                </label>
                <div className="flex h-9 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`上移字段 ${index + 1}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`下移字段 ${index + 1}`}
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除字段 ${index + 1}`}
                    onClick={() => onChange(value.filter((v) => v.id !== f.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {["select", "multi"].includes(f.type) && (
                <Field label="选项（每行一个）">
                  <Textarea
                    value={f.options.join("\n")}
                    rows={3}
                    onChange={(e) =>
                      update(f.id, { options: e.target.value.split("\n") })
                    }
                    maxLength={3000}
                  />
                </Field>
              )}
            </div>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="preview" className="space-y-6">
        {(["team", "member"] as const)
          .filter((scope) => value.some((f) => f.scope === scope))
          .map((scope) => (
            <section key={scope} className="space-y-4">
              <h3 className="text-sm font-medium">
                {scope === "team" ? "战队资料" : "队员资料"}
              </h3>
              <RegistrationFields
                fields={value.filter((f) => f.scope === scope)}
                values={{}}
                onChange={() => {}}
                disabled
              />
            </section>
          ))}
      </TabsContent>
    </Tabs>
  );
}
