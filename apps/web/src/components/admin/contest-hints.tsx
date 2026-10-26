import { ActionError } from "../action-error";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import type { HintPolicy, HintOverride } from "@/lib/hints";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Empty, Pagination, QueryState } from "../shared";

function PolicyEditor({
  value,
  onChange,
  label,
}: {
  value: HintPolicy;
  onChange: (v: HintPolicy) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <RadioGroup
        className="flex flex-wrap gap-4"
        aria-label={label}
        value={value.mode}
        onValueChange={(mode) =>
          onChange(
            mode === "fixed"
              ? { mode, points: 50 }
              : mode === "factor"
                ? { mode, factor: 0.8 }
                : { mode: "free" },
          )
        }
      >
        {(
          [
            ["free", "免费"],
            ["fixed", "直接扣分"],
            ["factor", "得分系数"],
          ] as const
        ).map(([mode, text]) => (
          <label
            key={mode}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <RadioGroupItem value={mode} />
            {text}
          </label>
        ))}
      </RadioGroup>
      {value.mode !== "free" && (
        <div className="flex items-center gap-2">
          <Input
            className="w-24 tabular-nums"
            type="number"
            required
            aria-label={`${label}${value.mode === "fixed" ? "扣分" : "系数"}`}
            min={value.mode === "fixed" ? 1 : 0.01}
            max={value.mode === "fixed" ? 10000 : 0.99}
            step={value.mode === "fixed" ? 1 : 0.01}
            value={value.mode === "fixed" ? value.points : value.factor}
            onChange={(e) =>
              onChange(
                value.mode === "fixed"
                  ? { mode: "fixed", points: Number(e.target.value) }
                  : { mode: "factor", factor: Number(e.target.value) },
              )
            }
          />
          <span className="text-sm text-muted-foreground">
            {value.mode === "fixed" ? "分" : "倍"}
          </span>
        </div>
      )}
    </div>
  );
}
export function ContestHints({
  ids,
  policy,
  onPolicyChange,
  overrides,
  onOverridesChange,
  issue,
}: {
  issue?: { challenge_id?: string; message: string } | null;
  ids: string[];
  policy: HintPolicy;
  onPolicyChange: (v: HintPolicy) => void;
  overrides: HintOverride[];
  onOverridesChange: (v: HintOverride[]) => void;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["contest-hint-settings", ids.join(","), page],
    queryFn: () =>
      api<{ items: Challenge[]; total: number }>(
        "/admin/challenges/search",
        "POST",
        { ids: ids.join(","), page, page_size: 10 },
      ),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
  useEffect(() => setPage(1), [ids.join(",")]);
  useEffect(() => {
    if (issue?.challenge_id)
      setPage(
        Math.max(1, Math.floor(ids.indexOf(issue.challenge_id) / 10) + 1),
      );
  }, [issue]);
  return (
    <div className="space-y-6">
      {issue && <ActionError error={issue.message} />}
      <section className="space-y-4">
        <h3 className="font-medium">统一规则</h3>
        <PolicyEditor
          value={policy}
          onChange={onPolicyChange}
          label="统一提示规则"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          按条解锁，全队共享。直接扣分计入战队总分；系数作用于本题全部小题及轮次，多条系数相乘。赛后练习免费。
        </p>
      </section>
      <section className="space-y-4 border-t pt-5">
        <h3 className="font-medium">单条调整</h3>
        {!ids.length ? (
          <Empty>先选用赛题</Empty>
        ) : (
          <>
            <QueryState
              loading={query.isLoading}
              error={query.error}
              retry={() => void query.refetch()}
            />
            {query.data && !query.error && (
              <div className="divide-y">
                {query.data.items.map((c) => (
                  <div key={c.id} className="space-y-3 py-4 first:pt-0">
                    <h4 className="text-sm font-semibold">{c.title}</h4>
                    {!c.hints?.length && (
                      <p className="text-xs text-muted-foreground">无提示</p>
                    )}
                    {(c.hints ?? []).map((hint, index) => {
                      if (typeof hint === "string") return null;
                      const override = overrides.find(
                        (v) => v.challenge_id === c.id && v.hint_id === hint.id,
                      );
                      const change = (next?: HintPolicy) =>
                        onOverridesChange([
                          ...overrides.filter(
                            (v) =>
                              v.challenge_id !== c.id || v.hint_id !== hint.id,
                          ),
                          ...(next
                            ? [
                                {
                                  challenge_id: c.id,
                                  hint_id: hint.id,
                                  policy: next,
                                },
                              ]
                            : []),
                        ]);
                      return (
                        <div
                          key={hint.id}
                          className="grid items-center gap-3 rounded-lg bg-muted/40 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground">
                              提示 {index + 1}
                            </span>
                            <p
                              className="line-clamp-2 break-words text-sm"
                              title={hint.content}
                            >
                              {hint.content}
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <Switch
                              checked={!!override}
                              onCheckedChange={(v) =>
                                change(v ? policy : undefined)
                              }
                              aria-label={`${c.title} 提示 ${index + 1} 单独调整`}
                            />
                            单独调整
                          </label>
                          {override && (
                            <div className="lg:col-span-2">
                              <PolicyEditor
                                value={override.policy}
                                onChange={change}
                                label={`${c.title} 提示 ${index + 1}`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {ids.length > 0 && (
          <Pagination
            page={page}
            total={query.data?.total ?? 0}
            pageSize={10}
            hasMore={page * 10 < (query.data?.total ?? 0)}
            setPage={setPage}
          />
        )}
      </section>
    </div>
  );
}
