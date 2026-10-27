import { Check, Search, X } from "lucide-react";
import type { Submission } from "@/lib/types";
import { Button } from "./ui/button";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import { Empty, Pagination } from "./shared";

const submissionTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
  hour12: false,
});

export type AccountSubmissionsData = { items: Submission[]; total: number };
export function AccountSubmissions({
  data,
  page,
  query,
  result,
  update,
  pending = false,
}: {
  data?: AccountSubmissionsData;
  page: number;
  query: string;
  result: string;
  pending?: boolean;
  update: (values: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-5" aria-busy={pending}>
      <form
        className="flex flex-wrap items-center gap-3"
        role="search"
        aria-label="搜索提交记录"
        onSubmit={(e) => {
          e.preventDefault();
          update({
            q: String(new FormData(e.currentTarget).get("q") ?? "").trim(),
            page: "1",
          });
        }}
      >
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            key={query}
            name="q"
            aria-label="搜索题目"
            placeholder="搜索题目"
            defaultValue={query}
            maxLength={100}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="清除搜索"
                onClick={() => update({ q: "", page: "1" })}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Button variant="secondary" type="submit">
          搜索
        </Button>
        <NativeSelect
          aria-label="提交结果"
          value={result}
          onChange={(e) => update({ result: e.target.value, page: "1" })}
        >
          <NativeSelectOption value="all">全部结果</NativeSelectOption>
          <NativeSelectOption value="correct">正确</NativeSelectOption>
          <NativeSelectOption value="incorrect">错误</NativeSelectOption>
        </NativeSelect>
      </form>
      {data?.items.length ? (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>题目</TableHead>
              <TableHead className="w-28">来源</TableHead>
              <TableHead className="w-24">结果</TableHead>
              <TableHead className="w-44">提交时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((s) => (
              <TableRow key={s.id} className="hover:bg-transparent">
                <TableCell className="whitespace-normal py-3">
                  <span className="block break-words font-medium [overflow-wrap:anywhere]">
                    {s.title}
                  </span>
                  {s.part_title && (
                    <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                      {s.part_title}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.scope === "practice"
                    ? "练习"
                    : s.contest_practice
                      ? "赛后练习"
                      : "比赛"}
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center gap-1.5 text-sm ${s.correct ? "text-success" : "text-destructive"}`}
                  >
                    {s.correct ? (
                      <Check className="size-4" />
                    ) : (
                      <X className="size-4" />
                    )}
                    {s.correct ? "正确" : "错误"}
                  </span>
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  <time dateTime={s.created_at}>
                    {submissionTime.format(new Date(s.created_at))}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Empty>
          {query || result !== "all"
            ? "没有符合条件的提交记录"
            : "还没有提交记录"}
        </Empty>
      )}
      <Pagination
        page={page}
        setPage={(value) => update({ page: String(value) })}
        total={data?.total ?? 0}
        pageSize={10}
        hasMore={page * 10 < (data?.total ?? 0)}
        alwaysShow
        disabled={pending}
      />
    </div>
  );
}
