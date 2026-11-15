import { useDeferredValue, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api, useAPI } from "@/lib/api";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "../ui/dialog";
import { Pagination, QueryState } from "../shared";

type Team = { id: string; name: string; captain: string; members: number };

export function ContestTeamPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [onlySelected, setOnlySelected] = useState(false);
  const q = useDeferredValue(search.trim());
  const list = useAPI<{ items: Team[]; total: number }>(
    `/admin/teams?q=${encodeURIComponent(q)}&page=${page}`,
    open && !onlySelected,
  );
  const lookupIds = open ? draft : value.slice(0, 3);
  const selected = useQueries({
    queries: Array.from(
      { length: Math.ceil(lookupIds.length / 100) },
      (_, index) => {
        const path = `/admin/teams?ids=${lookupIds.slice(index * 100, (index + 1) * 100).join(",")}`;
        return {
          queryKey: [path],
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            api<{ items: Team[] }>(path, "GET", undefined, signal),
        };
      },
    ),
  });
  const selectedTeams = selected.flatMap((query) => query.data?.items ?? []);
  const filtered = selectedTeams.filter((team) =>
    `${team.name} ${team.captain}`
      .toLocaleLowerCase()
      .includes(q.toLocaleLowerCase()),
  );
  const total = onlySelected ? filtered.length : (list.data?.total ?? 0);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 10)));
  const rows = onlySelected
    ? filtered.slice((currentPage - 1) * 10, currentPage * 10)
    : (list.data?.items ?? []);
  const error = onlySelected
    ? selected.find((query) => query.error)?.error
    : list.error;
  const loading = onlySelected
    ? selected.some((query) => query.isLoading)
    : list.isLoading;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft([...value]);
          setSearch("");
          setPage(1);
          setOnlySelected(false);
        }
        setOpen(next);
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        aria-label="已指定战队"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">指定战队</span>
          <span className="text-sm tabular-nums text-muted-foreground">
            {value.length} 支
          </span>
          {value.slice(0, 3).map((id) => {
            const team = selectedTeams.find((item) => item.id === id);
            return team ? (
              <Badge key={id} variant="secondary" className="max-w-40 truncate">
                {team.name}
              </Badge>
            ) : null;
          })}
          {value.length > 3 && (
            <span className="text-xs text-muted-foreground">
              +{value.length - 3}
            </span>
          )}
        </div>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-28"
            disabled={disabled}
          >
            选择战队
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>选择报名战队</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            aria-label="搜索可报名战队"
            placeholder="搜索战队"
            value={search}
            disabled={disabled}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Button
            type="button"
            variant={onlySelected ? "secondary" : "outline"}
            aria-pressed={onlySelected}
            disabled={disabled}
            onClick={() => {
              setOnlySelected(!onlySelected);
              setPage(1);
            }}
          >
            已选 {draft.length}
          </Button>
        </div>
        <ScrollArea className="h-[min(55dvh,28rem)] pr-4">
          <QueryState
            loading={loading}
            error={error ?? null}
            retry={() => {
              void list.refetch();
              selected.forEach((query) => void query.refetch());
            }}
          />
          {!loading && !error && (
            <div className="divide-y" aria-label="报名战队选择">
              {rows.map((team) => (
                <label
                  key={team.id}
                  className="flex cursor-pointer items-center gap-3 py-3 text-sm"
                >
                  <Checkbox
                    aria-label={`选择战队 ${team.name}`}
                    checked={draft.includes(team.id)}
                    disabled={
                      disabled ||
                      (!draft.includes(team.id) && draft.length >= 500)
                    }
                    onCheckedChange={(checked) =>
                      setDraft((current) =>
                        checked
                          ? [...current, team.id]
                          : current.filter((id) => id !== team.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {team.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {team.captain}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {team.members} 人
                  </span>
                </label>
              ))}
              {!rows.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {onlySelected && !draft.length
                    ? "尚未选择战队"
                    : "没有匹配的战队"}
                </p>
              )}
            </div>
          )}
        </ScrollArea>
        <Pagination
          page={currentPage}
          setPage={setPage}
          total={total}
          pageSize={10}
          hasMore={currentPage * 10 < total}
        />
        <DialogFooter className="flex-row items-center border-t pt-4">
          <span className="mr-auto whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            已选 {draft.length}
            <span className="hidden sm:inline"> / 500</span>
          </span>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            确认选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
