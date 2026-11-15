import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { apiKeyScopeMatches, type ApiKeyScope } from "@/lib/api-keys";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

function ScopeHelp({ name, scopes }: { name: string; scopes: ApiKeyScope[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${name}权限说明`}
          onClick={() => setOpen(true)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        variant="surface"
        sideOffset={6}
        className="max-w-[min(20rem,calc(100vw-3rem))] space-y-2"
      >
        {scopes.map((scope) => (
          <p key={scope.id}>
            <span className="font-medium">
              {scope.id.endsWith(":read") ? "读取" : "写入"}：
            </span>
            {scope.description}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export function ApiScopePicker({
  scopes,
  value,
  onChange,
  disabled = false,
}: {
  scopes: ApiKeyScope[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const groups = new Map<string, { name: string; scopes: ApiKeyScope[] }>();
  for (const scope of scopes) {
    const id = scope.id.slice(0, scope.id.lastIndexOf(":"));
    const group = groups.get(id) ?? {
      name: scope.name.split("：")[0],
      scopes: [],
    };
    group.scopes.push(scope);
    groups.set(id, group);
  }
  const visible = [...groups.entries()].filter(([, group]) =>
    group.scopes.some((scope) => apiKeyScopeMatches(scope, search)),
  );
  const ids = visible.flatMap(([, group]) =>
    group.scopes.map((scope) => scope.id),
  );
  const reads = ids.filter((id) => id.endsWith(":read"));
  const writes = ids.filter((id) => !id.endsWith(":read"));
  function toggle(selected: string[], checked: boolean) {
    onChange(
      checked
        ? [...new Set([...value, ...selected])]
        : value.filter((id) => !selected.includes(id)),
    );
  }
  function selection(selected: string[]): boolean | "indeterminate" {
    const count = selected.filter((id) => value.includes(id)).length;
    return count === 0
      ? false
      : count === selected.length
        ? true
        : "indeterminate";
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索权限"
            aria-label="搜索 API 权限"
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !ids.length}
            onClick={() => toggle(ids, true)}
          >
            全选
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !ids.length}
            onClick={() => toggle(ids, false)}
          >
            清空
          </Button>
        </div>
        <div className="max-h-[min(52dvh,28rem)] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="border-b">
                <th className="px-3 py-3 text-left font-medium">权限</th>
                {[
                  { name: "读取", ids: reads },
                  { name: "写入", ids: writes },
                ].map((column) => (
                  <th key={column.name} className="w-20 px-2 py-3 font-normal">
                    <label className="flex cursor-pointer items-center justify-center gap-2">
                      <Checkbox
                        checked={selection(column.ids)}
                        disabled={disabled || !column.ids.length}
                        onCheckedChange={(checked) =>
                          toggle(column.ids, checked === true)
                        }
                        aria-label={`全选${column.name}权限`}
                      />
                      {column.name}
                    </label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map(([id, group]) => (
                <tr key={id}>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      {group.name}
                      <ScopeHelp name={group.name} scopes={group.scopes} />
                    </span>
                  </td>
                  {[true, false].map((read) => {
                    const selected = group.scopes
                      .filter((scope) => scope.id.endsWith(":read") === read)
                      .map((scope) => scope.id);
                    return (
                      <td
                        key={String(read)}
                        className="px-2 py-2.5 text-center"
                      >
                        {selected.length ? (
                          <Checkbox
                            checked={selection(selected)}
                            disabled={disabled}
                            onCheckedChange={(checked) =>
                              toggle(selected, checked === true)
                            }
                            aria-label={`${group.name}：${read ? "读取" : "写入"}`}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    没有匹配的权限
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}
