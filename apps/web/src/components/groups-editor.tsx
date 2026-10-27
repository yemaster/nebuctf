import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { randomUUID } from "@/lib/random-uuid";
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
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
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
type GroupIssue = {
  key: string;
  field: "name" | "description";
  message: string;
};
export type GroupsEditorHandle = { validate: () => boolean };

export function GroupsEditor({
  initial = [],
  challengeIds = [],
  started = false,
  registered = false,
  ref,
}: {
  initial?: ContestGroup[];
  challengeIds?: string[];
  started?: boolean;
  registered?: boolean;
  ref?: Ref<GroupsEditorHandle>;
}) {
  const [groups, setGroups] = useState<DraftGroup[]>(
    initial.map((g) => ({ ...g, key: g.id })),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [issue, setIssue] = useState<GroupIssue | null>(null);
  const [requested, setRequested] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousKey = useRef<string | null>(null);
  const active = groups.find((g) => g.key === activeKey);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(groups.length / 10)),
  );

  // Adopt server IDs after saving without discarding edits or changing card keys.
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
  useEffect(() => {
    if (activeKey) nameRef.current?.focus();
    else if (previousKey.current) {
      const button = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-edit-group]",
        ) ?? [],
      ).find((el) => el.dataset.editGroup === previousKey.current);
      button?.focus();
    }
    previousKey.current = activeKey;
  }, [activeKey]);
  useEffect(() => {
    if (issue)
      (issue.field === "name" ? nameRef : descriptionRef).current?.focus();
  }, [issue]);
  useImperativeHandle(ref, () => ({
    validate() {
      const names = new Set<string>();
      for (const g of groups) {
        const name = g.name.trim();
        const message = !name
          ? "请输入组别名称"
          : name.length > 60
            ? "组别名称最多 60 字"
            : names.has(name)
              ? "组别名称不能重复"
              : "";
        names.add(name);
        if (message || g.description.length > 500) {
          setIssue({
            key: g.key,
            field: message ? "name" : "description",
            message: message || "参赛要求最多 500 字",
          });
          setPage(Math.floor(groups.indexOf(g) / 10) + 1);
          setActiveKey(g.key);
          return false;
        }
      }
      setIssue(null);
      return true;
    },
  }));
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
  const update = (g: DraftGroup) => {
    setGroups((old) => old.map((item) => (item.key === g.key ? g : item)));
    if (issue?.key === g.key) setIssue(null);
  };
  const remove = (g: DraftGroup) => {
    if (registered) return;
    setGroups((old) => old.filter((item) => item.key !== g.key));
    if (activeKey === g.key) setActiveKey(null);
    if (issue?.key === g.key) setIssue(null);
  };
  const overridesCount = (g: DraftGroup) =>
    Object.keys(g.challenge_permissions ?? {}).filter((id) =>
      challengeIds.includes(id),
    ).length;
  const permissions = active
    ? { ...defaultGroupPermissions, ...active.permissions }
    : defaultGroupPermissions;
  return (
    <section className="min-w-0 space-y-5" aria-label="比赛组别权限">
      {/* Serialize every draft, including cards on other pages and closed details. */}
      {groups.map((g) => (
        <div key={g.key} hidden>
          <input type="hidden" name="group_id" value={g.id} />
          <input type="hidden" name="group_name" value={g.name} />
          <input type="hidden" name="group_description" value={g.description} />
          <input
            type="hidden"
            name="group_permissions"
            value={JSON.stringify({
              ...defaultGroupPermissions,
              ...g.permissions,
            })}
          />
          <input
            type="hidden"
            name="group_challenge_permissions"
            value={JSON.stringify(g.challenge_permissions ?? {})}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {active ? (
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveKey(null)}
            >
              <ArrowLeft />
              返回组别
            </Button>
            <h3 className="min-w-0 truncate font-medium" title={active.name}>
              {active.name || "新建组别"}
            </h3>
          </div>
        ) : (
          <h3 className="font-medium">
            比赛组别{" "}
            <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
              {groups.length}
            </span>
          </h3>
        )}
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={`删除组别 ${active.name || "未命名组别"}`}
            title="删除组别"
            disabled={registered}
            onClick={() => remove(active)}
          >
            <Trash2 />
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={registered || groups.length >= 20}
            onClick={() => {
              const g = {
                id: "",
                key: randomUUID(),
                name: "",
                description: "",
                permissions: { ...defaultGroupPermissions },
                challenge_permissions: {},
              };
              setGroups((old) => [...old, g]);
              setPage(Math.ceil((groups.length + 1) / 10));
              setActiveKey(g.key);
            }}
          >
            <Plus />
            添加组别
          </Button>
        )}
      </div>
      {registered && (
        <p className="text-sm text-muted-foreground">
          已有战队报名，组别不能增删。
        </p>
      )}
      {active ? (
        <div
          key={active.key}
          className="min-w-0 space-y-6"
          aria-label={`组别 ${active.name || "未命名组别"}`}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="组别名称">
              <Input
                ref={nameRef}
                required
                maxLength={60}
                value={active.name}
                aria-invalid={
                  issue?.key === active.key && issue.field === "name"
                }
                aria-describedby={
                  issue?.key === active.key && issue.field === "name"
                    ? "group-field-issue"
                    : undefined
                }
                onChange={(e) => update({ ...active, name: e.target.value })}
              />
            </Field>
            <Field label="参赛要求（可选）">
              <Input
                ref={descriptionRef}
                maxLength={500}
                value={active.description}
                aria-invalid={
                  issue?.key === active.key && issue.field === "description"
                }
                aria-describedby={
                  issue?.key === active.key && issue.field === "description"
                    ? "group-field-issue"
                    : undefined
                }
                onChange={(e) =>
                  update({ ...active, description: e.target.value })
                }
              />
            </Field>
          </div>
          {issue?.key === active.key && (
            <p
              id="group-field-issue"
              role="alert"
              className="text-sm text-destructive"
            >
              {issue.message}
            </p>
          )}
          <fieldset className="min-w-0 space-y-4">
            <legend className="mb-4 text-sm font-medium">默认权限</legend>
            {started && (
              <p className="text-sm text-muted-foreground">
                计分、排名、三血和动态分值权限在开赛后锁定。
              </p>
            )}
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {(
                Object.keys(permissionLabels) as (keyof GroupPermissions)[]
              ).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={permissions[key]}
                    disabled={started && scoringPermissions.has(key)}
                    onCheckedChange={(yes) =>
                      update({
                        ...active,
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
              <Button
                type="button"
                variant="ghost"
                className="group h-auto w-full justify-between gap-3 px-0 py-3 text-left hover:bg-transparent dark:hover:bg-transparent"
              >
                <span>
                  单题权限
                  {overridesCount(active)
                    ? `（${overridesCount(active)} 项覆盖）`
                    : ""}
                </span>
                <ChevronDown className="text-muted-foreground motion-safe:transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0 space-y-3">
              <QueryState
                loading={data.isLoading}
                error={data.error}
                retry={() => void data.refetch()}
              />
              {!data.error &&
                !data.isLoading &&
                (!challengeIds.length ? (
                  <Empty>先在赛题设置中选用题目</Empty>
                ) : (
                  !!data.data?.length && (
                    <ChallengePermissionTable
                      items={data.data}
                      defaults={permissions}
                      overrides={active.challenge_permissions ?? {}}
                      started={started}
                      onChange={(challenge_permissions) =>
                        update({ ...active, challenge_permissions })
                      }
                    />
                  )
                ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        <div ref={listRef} className="space-y-4">
          {!groups.length && <Empty>未设置组别，所有战队使用相同权限</Empty>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4">
            {groups.slice((currentPage - 1) * 10, currentPage * 10).map((g) => {
              const p = { ...defaultGroupPermissions, ...g.permissions };
              return (
                <Card
                  key={g.key}
                  className="relative min-w-0 gap-3 py-4 shadow-none transition-shadow hover:shadow-sm motion-reduce:transition-none"
                >
                  <button
                    type="button"
                    data-edit-group={g.key}
                    aria-label={`配置组别 ${g.name || "未命名组别"}`}
                    title={g.name || "未命名组别"}
                    className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setActiveKey(g.key)}
                  />
                  <CardContent className="pointer-events-none space-y-3 px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <h4
                        className="min-w-0 flex-1 truncate font-medium"
                        title={g.name}
                      >
                        {g.name || "未命名组别"}
                      </h4>
                      <Pencil
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="pointer-events-auto relative z-10 size-7 text-destructive hover:text-destructive"
                        aria-label={`删除组别 ${g.name || "未命名组别"}`}
                        title="删除组别"
                        disabled={registered}
                        onClick={() => remove(g)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {g.description && (
                      <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        className={
                          p.join ? "bg-success/10 text-success" : undefined
                        }
                      >
                        {p.join ? "开放报名" : "报名关闭"}
                      </Badge>
                      <Badge>{p.require_review ? "需审核" : "免审核"}</Badge>
                      <Badge>{p.rank_overall ? "全局排名" : "组内排名"}</Badge>
                      {!p.score && <Badge>不计分</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {overridesCount(g)
                        ? `${overridesCount(g)} 道题单独配置权限`
                        : "赛题沿用默认权限"}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {groups.length > 10 && (
            <Pagination
              page={currentPage}
              setPage={setPage}
              pageSize={10}
              total={groups.length}
              hasMore={currentPage * 10 < groups.length}
            />
          )}
        </div>
      )}
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
