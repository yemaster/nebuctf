import { useDeferredValue, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import type { Contest } from "@/lib/types";
import { api, useAPI } from "@/lib/api";
import { Field, Pagination, QueryState } from "../shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

type Team = { id: string; name: string; captain: string; members: number };
export function ContestAccessSettings({
  contest,
  teams,
  onTeamsChange,
}: {
  contest: Contest | null;
  teams: string[];
  onTeamsChange: (ids: string[]) => void;
}) {
  const [visibility, setVisibility] = useState(contest?.visibility ?? "public");
  const [mode, setMode] = useState(contest?.registration_mode ?? "public");
  return (
    <div className="space-y-7">
      <section className="space-y-4" aria-labelledby="contest-visibility">
        <h2 id="contest-visibility" className="font-medium">
          比赛可见性
        </h2>
        <RadioGroup
          name="visibility"
          value={visibility}
          onValueChange={(value) => {
            setVisibility(value as typeof visibility);
            if (value === "private") setMode("teams");
          }}
          className="flex gap-6"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="public" />
            公开
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="private" />
            私密
          </label>
        </RadioGroup>
        {visibility === "private" && (
          <p className="text-xs text-muted-foreground">
            仅指定战队、已报名成员和管理员可见
          </p>
        )}
      </section>
      <section className="space-y-4" aria-labelledby="spectator-settings">
        <h2 id="spectator-settings" className="font-medium">
          观战页面
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              name: "spectator_scoreboard",
              label: "排行榜",
              checked: contest?.spectator_scoreboard !== false,
            },
            {
              name: "spectator_enabled",
              label: "3D 动态大屏",
              checked: contest?.spectator_enabled !== false,
            },
          ].map((item) => (
            <label
              key={item.name}
              className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 px-4 py-3 text-sm"
            >
              {item.label}
              <Switch name={item.name} defaultChecked={item.checked} />
            </label>
          ))}
        </div>
      </section>
      <section className="space-y-4" aria-labelledby="registration-scope">
        <h2 id="registration-scope" className="font-medium">
          参赛范围
        </h2>
        <RadioGroup
          name="registration_mode"
          value={mode}
          onValueChange={(v) => setMode(v as typeof mode)}
          className="flex flex-wrap gap-5"
        >
          {[
            ["public", "不限"],
            ["invite", "邀请码"],
            ["teams", "指定战队"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem
                value={value!}
                disabled={visibility === "private" && value !== "teams"}
              />
              {label}
            </label>
          ))}
        </RadioGroup>
        <div hidden={mode !== "invite"}>
          <Field
            label={contest?.registration_code_set ? "更换邀请码" : "报名邀请码"}
          >
            <Input
              type="password"
              autoComplete="new-password"
              name="registration_code"
              minLength={6}
              maxLength={128}
              disabled={mode !== "invite"}
              required={mode === "invite" && !contest?.registration_code_set}
              placeholder={
                contest?.registration_code_set
                  ? "已设置，留空保留"
                  : "至少 6 位"
              }
              className="max-w-sm"
            />
          </Field>
        </div>
        {mode === "teams" && (
          <TeamPicker value={teams} onChange={onTeamsChange} />
        )}
      </section>
      <section className="space-y-4" aria-labelledby="participation-settings">
        <h2 id="participation-settings" className="font-medium">
          报名与练习
        </h2>
        <div className="divide-y rounded-lg bg-muted/40 px-4">
          <label className="flex items-center justify-between gap-4 py-4 text-sm">
            所有报名均需审核
            <Switch
              name="require_review"
              defaultChecked={contest?.require_review}
            />
          </label>
          <label className="flex items-center justify-between gap-4 py-4 text-sm">
            <span className="space-y-1">
              <span className="block">赛后开放练习</span>
              <span className="block text-xs text-muted-foreground">
                允许继续报名和答题，不计入正式排名
              </span>
            </span>
            <Switch
              name="practice_mode"
              defaultChecked={contest?.practice_mode}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
function TeamPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const q = useDeferredValue(search);
  const list = useAPI<{ items: Team[]; total: number }>(
    `/admin/teams?q=${encodeURIComponent(q)}&page=${page}`,
  );
  // Keep lookup URLs below proxy header limits even with 500 selected teams.
  const selected = useQueries({
    queries: Array.from({ length: Math.ceil(value.length / 100) }, (_, i) => {
      const path = `/admin/teams?ids=${value.slice(i * 100, (i + 1) * 100).join(",")}`;
      return {
        queryKey: [path],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          api<{ items: Team[] }>(path, "GET", undefined, signal),
      };
    }),
  });
  const selectedTeams = selected.flatMap((q) => q.data?.items ?? []);
  const selectedError = selected.find((q) => q.error)?.error ?? null;
  return (
    <div className="space-y-4">
      {!!value.length && (
        <div className="flex flex-wrap gap-2" aria-label="已指定战队">
          {value.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onChange(value.filter((v) => v !== id))}
              aria-label={`移除 ${selectedTeams.find((t) => t.id === id)?.name ?? id}`}
            >
              {selectedTeams.find((t) => t.id === id)?.name ?? "读取战队"}
              <X className="size-3.5" />
            </Button>
          ))}
        </div>
      )}
      <Input
        aria-label="搜索可报名战队"
        placeholder="搜索战队"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="max-w-sm"
      />
      <QueryState
        loading={list.isLoading}
        error={list.error || selectedError}
        retry={() => {
          void list.refetch();
          selected.forEach((q) => void q.refetch());
        }}
      />
      {!list.error && !selectedError && list.data && (
        <>
          <div className="divide-y" aria-label="报名战队选择">
            {list.data.items.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.captain} / {t.members} 人
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!value.includes(t.id) && value.length >= 500}
                  onClick={() =>
                    onChange(
                      value.includes(t.id)
                        ? value.filter((v) => v !== t.id)
                        : [...value, t.id],
                    )
                  }
                >
                  {value.includes(t.id) ? <Check /> : <Plus />}
                  {value.includes(t.id) ? "已选" : "添加"}
                </Button>
              </div>
            ))}
            {!list.data.items.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                没有匹配的战队
              </p>
            )}
          </div>
          <Pagination
            page={page}
            setPage={setPage}
            total={list.data.total}
            pageSize={10}
            hasMore={page * 10 < list.data.total}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        已指定 {value.length} 支战队
      </p>
    </div>
  );
}
