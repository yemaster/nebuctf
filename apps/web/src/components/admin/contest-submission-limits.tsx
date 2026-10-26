import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import type {
  SubmissionLimits,
  SubmissionOverride,
} from "@/lib/submission-limits";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { QueryState, Empty, Pagination } from "../shared";
import { ActionError } from "../action-error";
function Limit({
  label,
  prefix = "",
  value,
  onChange,
}: {
  label: string;
  prefix?: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value !== null}
          aria-label={`${prefix}限制${label}`}
          onCheckedChange={(v) => onChange(v ? 10 : null)}
        />
        {label}
      </label>
      <Input
        type="number"
        aria-label={`${prefix}${label}`}
        value={value ?? ""}
        min={1}
        max={100000}
        step={1}
        required={value !== null}
        disabled={value === null}
        placeholder="不限"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
export function ContestSubmissionLimits({
  ids,
  value,
  onChange,
  overrides,
  onOverridesChange,
  issue,
}: {
  ids: string[];
  value: SubmissionLimits;
  onChange: (v: SubmissionLimits) => void;
  overrides: SubmissionOverride[];
  onOverridesChange: (v: SubmissionOverride[]) => void;
  issue?: { challenge_id?: string; message: string } | null;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["contest-submission-settings", ids.join(","), page],
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
        <h3 className="font-medium">统一上限</h3>
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Limit
            label="Flag 提交次数"
            value={value.flag}
            onChange={(flag) => onChange({ ...value, flag })}
          />
          <Limit
            label="防御申请次数"
            value={value.defense}
            onChange={(defense) => onChange({ ...value, defense })}
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          每队每题累计。Flag 正误均计次；补丁受理后计次。赛后练习不占正式额度。
        </p>
      </section>
      <section className="space-y-4 border-t pt-5">
        <h3 className="font-medium">单题调整</h3>
        {!ids.length ? (
          <Empty>先选用赛题</Empty>
        ) : (
          <>
            <QueryState
              loading={query.isLoading}
              error={query.error}
              retry={() => void query.refetch()}
            />
            {!query.error &&
              query.data?.items.map((c) => {
                const current = overrides.find((v) => v.challenge_id === c.id),
                  defense =
                    c.challenge_type === "awdp" || c.challenge_type === "awd";
                const update = (next?: SubmissionOverride) =>
                  onOverridesChange([
                    ...overrides.filter((v) => v.challenge_id !== c.id),
                    ...(next ? [next] : []),
                  ]);
                return (
                  <div
                    key={c.id}
                    className="space-y-4 border-b pb-4 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h4 className="min-w-0 break-words text-sm font-medium">
                        {c.title}
                      </h4>
                      {c.challenge_type === "objective" ? (
                        <span className="text-xs text-muted-foreground">
                          客观题
                        </span>
                      ) : (
                        <label className="flex shrink-0 items-center gap-2 text-sm">
                          <Switch
                            checked={!!current}
                            aria-label={`${c.title} 单独限制提交次数`}
                            onCheckedChange={(v) =>
                              update(
                                v
                                  ? { challenge_id: c.id, ...value }
                                  : undefined,
                              )
                            }
                          />
                          单独设置
                        </label>
                      )}
                    </div>
                    {current && c.challenge_type !== "objective" && (
                      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                        <Limit
                          label="Flag 提交次数"
                          prefix={`${c.title} `}
                          value={
                            current.flag === undefined
                              ? value.flag
                              : current.flag
                          }
                          onChange={(flag) => update({ ...current, flag })}
                        />
                        {defense && (
                          <Limit
                            label="防御申请次数"
                            prefix={`${c.title} `}
                            value={
                              current.defense === undefined
                                ? value.defense
                                : current.defense
                            }
                            onChange={(defense) =>
                              update({ ...current, defense })
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            <Pagination
              page={page}
              setPage={setPage}
              total={query.data?.total ?? 0}
              pageSize={10}
              hasMore={page * 10 < (query.data?.total ?? 0)}
            />
          </>
        )}
      </section>
    </div>
  );
}
