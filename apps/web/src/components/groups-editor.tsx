import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Challenge, ContestGroup } from "@/lib/types";
import {
  defaultGroupPermissions,
  permissionLabels,
  challengePermissions,
  scoringPermissions,
  type GroupPermissions,
} from "@/lib/group-permissions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import { Field, Pagination, QueryState, Empty } from "./shared";

type DraftGroup = ContestGroup & { key: string };
export function GroupsEditor({
  initial = [],
  challengeIds = [],
  started = false,
  registered = false,
}: {
  initial?: ContestGroup[];
  challengeIds?: string[];
  started?: boolean;
  registered?: boolean;
}) {
  const [groups, setGroups] = useState<DraftGroup[]>(
    initial.map((g) => ({ ...g, key: g.id })),
  );
  const [requested, setRequested] = useState(false);
  // The editor stays open after save. Adopt server IDs for newly saved groups
  // without discarding a draft or remounting its inputs.
  useEffect(() => {
    setGroups((old) => {
      const next = old.map((g) =>
        g.id
          ? g
          : {
              ...g,
              id:
                initial.find((saved) => saved.name === g.name.trim())?.id ?? "",
            },
      );
      return next.some((g, i) => g.id !== old[i]!.id) ? next : old;
    });
  }, [initial]);
  const data = useQuery({
    queryKey: ["group-permission-challenges", challengeIds.join(",")],
    queryFn: async () => {
      const batches = Array.from(
        { length: Math.ceil(challengeIds.length / 100) },
        (_, i) => challengeIds.slice(i * 100, i * 100 + 100),
      );
      const pages = await Promise.all(
        batches.map((ids) =>
          api<{ items: Challenge[] }>("/admin/challenges/search", "POST", {
            ids: ids.join(","),
            page_size: 100,
          }),
        ),
      );
      return pages
        .flatMap((p) => p.items)
        .sort(
          (a, b) => challengeIds.indexOf(a.id) - challengeIds.indexOf(b.id),
        );
    },
    enabled: requested && challengeIds.length > 0 && groups.length > 0,
  });
  const update = (g: DraftGroup) =>
    setGroups((old) => old.map((item) => (item.key === g.key ? g : item)));
  return (
    <section className="min-w-0 space-y-4" aria-label="比赛组别权限">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">比赛组别</h3>
        <Button
          type="button"
          variant="secondary"
          disabled={registered || groups.length >= 20}
          onClick={() =>
            setGroups((old) => [
              ...old,
              {
                id: "",
                key: crypto.randomUUID(),
                name: "",
                description: "",
                permissions: { ...defaultGroupPermissions },
                challenge_permissions: {},
              },
            ])
          }
        >
          <Plus />
          添加组别
        </Button>
      </div>
      {registered && (
        <p className="text-sm text-muted-foreground">
          已有战队报名，组别不能增删。
        </p>
      )}
      {started && (
        <p className="text-sm text-muted-foreground">
          计分、排名、三血和动态分值权限在开赛后锁定。
        </p>
      )}
      {!groups.length && <Empty>未设置组别，所有战队使用相同权限</Empty>}
      <div className="divide-y">
        {groups.map((g, index) => {
          const permissions = { ...defaultGroupPermissions, ...g.permissions };
          return (
            <section
              key={g.key}
              aria-label={`组别 ${g.name || index + 1}`}
              className="min-w-0 space-y-6 py-6 first:pt-0"
            >
              <input type="hidden" name="group_id" value={g.id} />
              <input
                type="hidden"
                name="group_permissions"
                value={JSON.stringify(permissions)}
              />
              <input
                type="hidden"
                name="group_challenge_permissions"
                value={JSON.stringify(g.challenge_permissions ?? {})}
              />
              <div className="flex items-end gap-3">
                <Field label="组别名称" className="min-w-0 flex-1">
                  <Input
                    name="group_name"
                    required
                    maxLength={60}
                    value={g.name}
                    onChange={(e) => update({ ...g, name: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除组别 ${g.name || index + 1}`}
                  disabled={registered}
                  onClick={() =>
                    setGroups((old) => old.filter((v) => v.key !== g.key))
                  }
                >
                  <X />
                </Button>
              </div>
              <Field label="参赛要求（可选）">
                <Input
                  name="group_description"
                  maxLength={500}
                  value={g.description}
                  onChange={(e) =>
                    update({ ...g, description: e.target.value })
                  }
                />
              </Field>
              <fieldset className="min-w-0">
                <legend className="mb-4 text-sm font-medium">默认权限</legend>
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    Object.keys(permissionLabels) as (keyof GroupPermissions)[]
                  ).map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Switch
                        checked={permissions[key]}
                        disabled={started && scoringPermissions.has(key)}
                        onCheckedChange={(yes) =>
                          update({
                            ...g,
                            permissions: { ...permissions, [key]: !!yes },
                          })
                        }
                      />
                      {permissionLabels[key]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Collapsible
                className="space-y-3"
                onOpenChange={(open) => {
                  if (open) setRequested(true);
                }}
              >
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    单题权限
                    {Object.keys(g.challenge_permissions ?? {}).filter((id) =>
                      challengeIds.includes(id),
                    ).length
                      ? `（${Object.keys(g.challenge_permissions ?? {}).filter((id) => challengeIds.includes(id)).length} 项覆盖）`
                      : ""}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="min-w-0 space-y-3">
                  <QueryState
                    loading={data.isLoading}
                    error={data.error}
                    retry={() => void data.refetch()}
                  />
                  {!challengeIds.length && (
                    <Empty>先在赛题设置中选用题目</Empty>
                  )}
                  {!!data.data?.length && (
                    <ChallengePermissionTable
                      items={data.data}
                      defaults={permissions}
                      overrides={g.challenge_permissions ?? {}}
                      started={started}
                      onChange={(challenge_permissions) =>
                        update({ ...g, challenge_permissions })
                      }
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ChallengePermissionTable({
  items,
  defaults,
  overrides,
  started,
  onChange,
}: {
  items: Challenge[];
  defaults: GroupPermissions;
  overrides: NonNullable<ContestGroup["challenge_permissions"]>;
  started: boolean;
  onChange: (value: NonNullable<ContestGroup["challenge_permissions"]>) => void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const filtered = items.filter((c) =>
    c.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  return (
    <>
      <Input
        aria-label="搜索单题权限"
        placeholder="搜索本场赛题"
        className="max-w-sm"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>题目</TableHead>
            <TableHead>沿用组别</TableHead>
            {challengePermissions.map((key) => (
              <TableHead key={key} className="text-center">
                {permissionLabels[key]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice((current - 1) * 10, current * 10).map((c) => {
            const effective = { ...defaults, ...overrides[c.id] },
              inherited = !overrides[c.id];
            return (
              <TableRow key={c.id}>
                <TableCell className="min-w-36 whitespace-normal font-medium">
                  {c.title}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {c.category}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    aria-label={`${c.title}沿用组别权限`}
                    checked={inherited}
                    disabled={
                      started &&
                      challengePermissions.some(
                        (key) =>
                          scoringPermissions.has(key) &&
                          defaults[key] !== effective[key],
                      )
                    }
                    onCheckedChange={(yes) => {
                      const next = { ...overrides };
                      if (yes) delete next[c.id];
                      else
                        next[c.id] = Object.fromEntries(
                          challengePermissions.map((key) => [
                            key,
                            defaults[key],
                          ]),
                        );
                      onChange(next);
                    }}
                  />
                </TableCell>
                {challengePermissions.map((key) => (
                  <TableCell key={key} className="text-center">
                    <Switch
                      aria-label={`${c.title}${permissionLabels[key]}`}
                      checked={effective[key]}
                      disabled={
                        inherited || (started && scoringPermissions.has(key))
                      }
                      onCheckedChange={(yes) =>
                        onChange({
                          ...overrides,
                          [c.id]: { ...overrides[c.id], [key]: !!yes },
                        })
                      }
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!filtered.length && <Empty>没有符合条件的赛题</Empty>}
      <Pagination
        page={current}
        setPage={setPage}
        total={filtered.length}
        pageSize={10}
        hasMore={current * 10 < filtered.length}
        alwaysShow
      />
    </>
  );
}

export function readGroups(f: FormData, challengeIds: string[] = []) {
  return f.getAll("group_name").map((name, i) => ({
    id: f.getAll("group_id")[i] || undefined,
    name,
    description: f.getAll("group_description")[i],
    permissions: JSON.parse(String(f.getAll("group_permissions")[i] ?? "{}")),
    challenge_permissions: Object.fromEntries(
      Object.entries(
        JSON.parse(String(f.getAll("group_challenge_permissions")[i] ?? "{}")),
      ).filter(([id]) => challengeIds.includes(id)),
    ),
  }));
}
