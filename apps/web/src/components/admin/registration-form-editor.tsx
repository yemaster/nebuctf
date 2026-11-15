import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  Eye,
  MoreHorizontal,
} from "lucide-react";
import { randomUUID } from "@/lib/random-uuid";
import { fieldTypes, type RegistrationField } from "@/lib/registration-form";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Switch } from "../ui/switch";
import { ScrollArea } from "../ui/scroll-area";
import { Field } from "../shared";
import { RegistrationFields } from "../registration-fields";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";

export function RegistrationFormEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: RegistrationField[];
  disabled?: boolean;
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
    <section className="space-y-3" aria-label="报名表单编辑">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">报名表单</h2>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-28"
                disabled={!value.length}
              >
                <Eye />
                预览表单
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>报名表单预览</DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[60dvh] [&_[data-slot=scroll-area-viewport]]:max-h-[60dvh]">
                <div className="space-y-6 pr-4">
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
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-28"
                disabled={disabled || value.length >= 20}
              >
                <Plus />
                添加字段
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(
                [
                  ["text", "姓名"],
                  ["email", "邮箱"],
                  ["phone", "手机号"],
                  ["address", "证书寄件地址"],
                ] as const
              ).map(([type, label]) => (
                <DropdownMenuItem
                  key={label}
                  disabled={disabled || value.length >= 20}
                  onSelect={() => add(type, label)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={disabled || value.length >= 20}
                onSelect={() => add("text", "", "team")}
              >
                自定义字段
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="space-y-4">
        {!value.length && (
          <p className="py-2 text-sm text-muted-foreground">
            未设置额外报名资料
          </p>
        )}
        <div className="divide-y">
          {value.map((f, index) => (
            <div
              key={f.id}
              className="space-y-4 py-4 first:pt-0 last:pb-0"
              data-registration-field={f.id}
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_9rem]">
                  <Field
                    label="字段名称"
                    className="min-w-0 sm:col-span-2 lg:col-span-1"
                  >
                    <Input
                      value={f.label}
                      maxLength={80}
                      required
                      onChange={(e) => update(f.id, { label: e.target.value })}
                    />
                  </Field>
                  <Field label="类型">
                    <NativeSelect
                      wrapperClassName="w-full"
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
                      wrapperClassName="w-full"
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
                </div>
                <div className="flex items-center justify-end gap-3">
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <Switch
                      checked={f.required}
                      onCheckedChange={(required) => update(f.id, { required })}
                    />
                    必填
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={`字段 ${index + 1} 操作`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={disabled || index === 0}
                        onSelect={() => move(index, -1)}
                      >
                        <ArrowUp />
                        上移
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={disabled || index === value.length - 1}
                        onSelect={() => move(index, 1)}
                      >
                        <ArrowDown />
                        下移
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={disabled}
                        onSelect={() =>
                          onChange(value.filter((v) => v.id !== f.id))
                        }
                      >
                        <Trash2 />
                        删除字段
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
      </div>
    </section>
  );
}
