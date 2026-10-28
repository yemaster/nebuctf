import { questionTypes } from "@/lib/competition";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { categories } from "@/pages/Challenges";
import { Empty, Pagination, QueryState } from "./shared";

export function ChallengePicker({
  value,
  onChange,
  practice,
  limit = 500,
  single = false,
  onPick,
  disabled = false,
  showSelectedFilter = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  practice?: boolean;
  limit?: number;
  single?: boolean;
  onPick?: (challenge: Challenge) => void;
  disabled?: boolean;
  showSelectedFilter?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [type, setType] = useState(""),
    [page, setPage] = useState(1),
    [selectedOnly, setSelectedOnly] = useState(false);
  const params = new URLSearchParams({
    q,
    page: String(page),
    page_size: "10",
    category,
    challenge_type: type,
  });
  if (practice !== undefined) params.set("practice", String(practice));
  if (selectedOnly && value.length) params.set("ids", value.join(","));
  const data = useQuery({
    queryKey: ["challenge-picker", params.toString()],
    queryFn: () =>
      api<{ items: Challenge[]; total: number }>(
        selectedOnly
          ? "/admin/challenges/search"
          : `/admin/challenges?${params}`,
        selectedOnly ? "POST" : "GET",
        selectedOnly ? Object.fromEntries(params) : undefined,
      ),
    enabled: !selectedOnly || value.length > 0,
  });
  const items = selectedOnly && !value.length ? [] : data.data?.items;
  const total = selectedOnly && !value.length ? 0 : data.data?.total;
  useEffect(() => {
    if (total !== undefined && !data.isFetching) {
      setPage((current) =>
        Math.min(current, Math.max(1, Math.ceil(total / 10))),
      );
    }
  }, [total, data.isFetching]);
  const find = () => {
    setQ(search);
    setPage(1);
  };
  return (
    <section aria-label="选择题目" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label="搜索可添加题目"
          placeholder="搜索题目"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="搜索题目"
          onClick={find}
        >
          <Search />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="筛选题目分类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="筛选题型"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">全部题型</NativeSelectOption>
          {Object.entries(questionTypes).map(([key, label]) => (
            <NativeSelectOption key={key} value={key}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {!single && showSelectedFilter && (
          <Button
            type="button"
            variant={selectedOnly ? "secondary" : "ghost"}
            aria-pressed={selectedOnly}
            onClick={() => {
              setSelectedOnly(!selectedOnly);
              setPage(1);
            }}
          >
            已选 {value.length}
          </Button>
        )}
      </div>
      <QueryState
        loading={data.isLoading && (!selectedOnly || !!value.length)}
        variant="rows"
        error={data.error}
        retry={() => void data.refetch()}
      />
      <div className="divide-y">
        {items?.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-3 px-2 py-3 hover:bg-muted/50 has-[[data-state=checked]]:bg-muted/30"
          >
            <Checkbox
              aria-label={`选择 ${c.title}`}
              checked={value.includes(c.id)}
              disabled={
                disabled ||
                (!value.includes(c.id) && value.length >= limit && !single)
              }
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? single
                      ? [c.id]
                      : [...value, c.id]
                    : value.filter((id) => id !== c.id),
                );
                if (checked) onPick?.(c);
              }}
            />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block break-words text-sm font-medium">
                {c.title}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{c.category}</span>
                <span>{questionTypes[c.challenge_type ?? "ctf"]}</span>
                <span>
                  {c.parts.length
                    ? c.parts.reduce((n, p) => n + p.initial_points, 0)
                    : c.initial_points}{" "}
                  分
                </span>
                {!c.published && <span>题库未启用</span>}
                {c.practice && (
                  <span>{c.published ? "练习场已开放" : "练习题"}</span>
                )}
              </span>
            </span>
            {value.includes(c.id) && <Badge variant="secondary">已选</Badge>}
          </label>
        ))}
      </div>
      {items?.length === 0 && <Empty>没有符合条件的题目</Empty>}
      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        pageSize={10}
        hasMore={page * 10 < (total ?? 0)}
        disabled={data.isFetching}
        alwaysShow
      />
    </section>
  );
}
