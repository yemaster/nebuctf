import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { questionTypes } from "@/lib/competition";
import { categories } from "@/pages/Challenges";
import { ChallengePicker } from "../challenge-picker";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Empty, QueryState } from "../shared";

export function ContestQuestionPicker({
  value,
  onChange,
  onPick,
  disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  onPick: (challenge: Challenge) => void;
  disabled: boolean;
}) {
  const [known, setKnown] = useState<Record<string, Challenge>>({});
  const missing = value.filter((id) => !known[id]).sort();
  const details = useQuery({
    queryKey: ["contest-picked-details", missing.join(",")],
    queryFn: async () => {
      // Contest selections can exceed the API's 100-row page limit.
      const batches = Array.from(
        { length: Math.ceil(missing.length / 100) },
        (_, i) => missing.slice(i * 100, (i + 1) * 100),
      );
      const result = await Promise.all(
        batches.map((ids) =>
          api<{ items: Challenge[] }>("/admin/challenges/search", "POST", {
            ids: ids.join(","),
            page_size: 100,
          }),
        ),
      );
      return result.flatMap((page) => page.items);
    },
    enabled: missing.length > 0,
  });
  useEffect(() => {
    if (details.data?.length)
      setKnown((old) => ({
        ...old,
        ...Object.fromEntries(details.data.map((c) => [c.id, c])),
      }));
  }, [details.data]);
  const groups = new Map<string, Challenge[]>();
  for (const id of value) {
    const challenge = known[id];
    if (!challenge) continue;
    const group = groups.get(challenge.category) ?? [];
    group.push(challenge);
    groups.set(challenge.category, group);
  }
  const orderedGroups = [...groups].sort(([a], [b]) => {
    const first = categories.indexOf(a),
      second = categories.indexOf(b);
    return (
      (first === -1 ? categories.length : first) -
        (second === -1 ? categories.length : second) || a.localeCompare(b)
    );
  });
  return (
    <div className="grid min-w-0 divide-y rounded-lg border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <section aria-label="全部题库" className="min-w-0 space-y-4 p-4 sm:p-5">
        <h4 className="text-sm font-medium">全部题目</h4>
        <ChallengePicker
          value={value}
          onChange={onChange}
          onPick={(c) => {
            setKnown((old) => ({ ...old, [c.id]: c }));
            onPick(c);
          }}
          limit={200}
          disabled={disabled}
          showSelectedFilter={false}
        />
      </section>
      <section aria-label="已选赛题" className="min-w-0 space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium">已选题目</h4>
          <span
            role="status"
            className="text-sm tabular-nums text-muted-foreground"
          >
            {value.length} / 200
          </span>
        </div>
        <ScrollArea className="h-96 lg:h-[38rem]">
          <div className="space-y-6 pr-3">
            {!value.length && <Empty>从左侧选择题目</Empty>}
            {orderedGroups.map(([category, items]) => (
              <section
                key={category}
                aria-label={`${category} 已选赛题`}
                className="space-y-2"
              >
                <h5 className="flex items-center gap-2 text-sm font-medium">
                  {category}
                  <Badge variant="secondary">{items.length}</Badge>
                </h5>
                <ul className="divide-y">
                  {items.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 py-3"
                      data-selected-question={c.id}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words text-sm font-medium">
                          {c.title}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {questionTypes[c.challenge_type ?? "ctf"]}
                          </span>
                          {!!c.parts.length && (
                            <span>{c.parts.length} 个小题</span>
                          )}
                          {!c.published && <span>题库未启用</span>}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={`移除已选 ${c.title}`}
                        onClick={() =>
                          onChange(value.filter((id) => id !== c.id))
                        }
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <QueryState
              loading={details.isLoading}
              variant="rows"
              error={details.error}
              retry={() => void details.refetch()}
            />
            {details.isSuccess &&
              missing.length > 0 &&
              missing
                .filter((id) => !details.data.some((c) => c.id === id))
                .map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>题目不可用</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onChange(value.filter((selected) => selected !== id))
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
