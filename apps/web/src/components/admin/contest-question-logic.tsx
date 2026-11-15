import { useId, useState, type ReactNode } from "react";
import { ChevronDown, CircleHelp, X } from "lucide-react";
import type { QuestionLogic } from "@/lib/competition";
import type { Challenge } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Field } from "../shared";
import { Label } from "../ui/label";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "../ui/input-group";

export function ContestRuleHelp({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="规则说明"
        >
          <CircleHelp className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-5" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function QuestionLogicEditor({
  challenge,
  value,
  onChange,
  questions,
  groups,
  locked,
}: {
  challenge: Challenge;
  value: QuestionLogic;
  onChange: (value: QuestionLogic) => void;
  questions: Challenge[];
  groups: string[];
  locked: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const dependency = value.dependency;
  const choices = questions.filter(
    (c) =>
      c.id !== challenge.id &&
      c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const changeIds = (challenge_ids: string[]) => {
    if (dependency)
      onChange({ ...value, dependency: { ...dependency, challenge_ids } });
  };
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-4 border-t pt-4">
      <div className="flex items-center gap-1">
        <h4 className="text-sm font-medium">解锁规则</h4>
        <ContestRuleHelp>
          首次提交选定互斥路线。普通前置须整题完成；AWD 成功攻击一次。
        </ContestRuleHelp>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-group`}>互斥组</Label>
          <InputGroup>
            <InputGroupInput
              id={`${id}-group`}
              aria-label={`${challenge.title}互斥组`}
              maxLength={60}
              placeholder="无互斥组"
              value={value.exclusive_group ?? ""}
              onChange={(e) =>
                onChange({ ...value, exclusive_group: e.target.value || null })
              }
              onBlur={() =>
                onChange({
                  ...value,
                  exclusive_group: value.exclusive_group?.trim() || null,
                })
              }
            />
            {!!groups.length && (
              <InputGroupAddon
                align="inline-end"
                className="pr-1"
                onClick={(event) => event.stopPropagation()}
              >
                <NativeSelect
                  className="h-7 border-0 bg-transparent py-0 text-xs shadow-none focus-visible:ring-0"
                  aria-label={`${challenge.title}复用互斥组`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      onChange({ ...value, exclusive_group: e.target.value });
                  }}
                >
                  <NativeSelectOption value="">复用组名</NativeSelectOption>
                  {groups.map((group) => (
                    <NativeSelectOption key={group} value={group}>
                      {group}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <Field label="前置依赖">
          <NativeSelect
            aria-label={`${challenge.title}依赖范围`}
            value={dependency?.scope ?? "none"}
            onChange={(e) =>
              onChange({
                ...value,
                dependency:
                  e.target.value === "none"
                    ? null
                    : {
                        scope: e.target.value === "global" ? "global" : "team",
                        mode: dependency?.mode ?? "all",
                        challenge_ids: dependency?.challenge_ids ?? [],
                      },
              })
            }
          >
            <NativeSelectOption value="none">无依赖</NativeSelectOption>
            <NativeSelectOption value="team">本队完成</NativeSelectOption>
            <NativeSelectOption value="global">
              全场任一队完成
            </NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
      {dependency && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label={`${challenge.title}依赖完成方式`}
              value={dependency.mode}
              onValueChange={(mode) => {
                if (mode === "all" || mode === "any")
                  onChange({ ...value, dependency: { ...dependency, mode } });
              }}
            >
              <ToggleGroupItem value="all">全部完成</ToggleGroupItem>
              <ToggleGroupItem value="any">任一完成</ToggleGroupItem>
            </ToggleGroup>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  aria-label={`${challenge.title}选择前置赛题`}
                >
                  选择前置赛题
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <Input
                  autoFocus
                  aria-label={`${challenge.title}搜索前置赛题`}
                  placeholder="搜索已选赛题"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {!choices.length && (
                    <p className="py-3 text-sm text-muted-foreground">
                      没有可选赛题
                    </p>
                  )}
                  {choices.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 py-2 text-sm"
                    >
                      <Checkbox
                        disabled={locked}
                        checked={dependency.challenge_ids.includes(c.id)}
                        aria-label={`依赖 ${c.title}`}
                        onCheckedChange={(checked) =>
                          changeIds(
                            checked
                              ? [...dependency.challenge_ids, c.id]
                              : dependency.challenge_ids.filter(
                                  (id) => id !== c.id,
                                ),
                          )
                        }
                      />
                      {c.title}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-wrap gap-2">
            {dependency.challenge_ids.map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                size="sm"
                disabled={locked}
                aria-label={`移除前置 ${questions.find((c) => c.id === id)?.title ?? id}`}
                onClick={() =>
                  changeIds(
                    dependency.challenge_ids.filter(
                      (selected) => selected !== id,
                    ),
                  )
                }
              >
                {questions.find((c) => c.id === id)?.title ?? "题目不可用"}
                <X />
              </Button>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}
