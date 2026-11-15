import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
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

import {
  GroupPermissionSummary,
  PermissionSwitch,
  PermissionLabel,
  permissionAppearance,
} from "./group-permission-summary";

type DraftGroup = ContestGroup & { key: string };
type GroupIssue = {
  key: string;
  field: "name" | "description" | "invite_code";
  message: string;
};
export type GroupsEditorHandle = { validate: () => boolean };

export function GroupsEditor({
  initial = [],
  challengeIds = [],
  started = false,
  requireReview = false,
  disabled = false,
  ref,
}: {
  initial?: ContestGroup[];
  challengeIds?: string[];
  started?: boolean;
  requireReview?: boolean;
  disabled?: boolean;
  ref?: Ref<GroupsEditorHandle>;
}) {
  const [groups, setGroups] = useState<DraftGroup[]>(() =>
    initial
      .filter((g) => !g.is_default)
      .map((g) => ({ ...g, id: g.id || "", key: g.id || randomUUID() })),
  );
  const [active, setActive] = useState<DraftGroup | null>(null);
  const activeKey = active?.key ?? null;
  const [page, setPage] = useState(1);
  const [issue, setIssue] = useState<GroupIssue | null>(null);
  const [requested, setRequested] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

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
    if (issue)
      (issue.field === "name"
        ? nameRef
        : issue.field === "invite_code"
          ? inviteRef
          : descriptionRef
      ).current?.focus();
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
        const inviteIssue =
          g.invite_code?.trim() &&
          (g.invite_code.trim().length < 6 || g.invite_code.trim().length > 128)
            ? "组别邀请码为 6–128 位"
            : "";
        if (message || g.description.length > 500 || inviteIssue) {
          setIssue({
            key: g.key,
            field: message
              ? "name"
              : inviteIssue
                ? "invite_code"
                : "description",
            message: message || inviteIssue || "参赛要求最多 500 字",
          });
          setPage(Math.floor(groups.indexOf(g) / 10) + 1);
          returnFocus.current = document.activeElement as HTMLElement;
          setActive(structuredClone(g));
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
    enabled: requested && challengeIds.length > 0 && !!active,
  });
  const update = (g: DraftGroup) => {
    setActive(g);
    if (issue?.key === g.key) setIssue(null);
  };
  const remove = (g: DraftGroup) => {
    if (disabled) return;
    setGroups((old) => old.filter((item) => item.key !== g.key));
    if (activeKey === g.key) setActive(null);
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
    <section className="min-w-0 space-y-3" aria-label="比赛组别权限">
      {/* Serialize confirmed groups, including entries on other pages. */}
      {groups.map((g) => (
        <div key={g.key} hidden>
          <input type="hidden" name="group_id" value={g.id} />
          <input type="hidden" name="group_name" value={g.name} />
          <input type="hidden" name="group_description" value={g.description} />
          <input
            type="hidden"
            name="group_invite_code"
            value={JSON.stringify(g.invite_code ?? null)}
          />
          <input
            type="hidden"
            name="group_review_mode"
            value={
              g.review_mode ??
              (g.permissions?.require_review ? "required" : "inherit")
            }
          />
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
        <h3 className="font-medium">
          比赛组别{" "}
          <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
            {groups.length + 1}
          </span>
        </h3>
        <Button
          ref={addButtonRef}
          type="button"
          size="sm"
          variant="outline"
          className="w-28"
          disabled={disabled || groups.length >= 20}
          onClick={(e) => {
            returnFocus.current = e.currentTarget;
            setIssue(null);
            setActive({
              id: "",
              key: randomUUID(),
              name: "",
              description: "",
              permissions: { ...defaultGroupPermissions },
              challenge_permissions: {},
            });
          }}
        >
          <Plus />
          添加组别
        </Button>
      </div>
      <Dialog
        open={!!active}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            setIssue(null);
          }
        }}
      >
        <DialogContent
          className="max-w-4xl"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            (returnFocus.current?.isConnected
              ? returnFocus.current
              : addButtonRef.current
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {groups.some((g) => g.key === activeKey)
                ? "编辑组别"
                : "添加组别"}
            </DialogTitle>
          </DialogHeader>
          {active && (
            <>
              <ScrollArea className="h-[min(60dvh,34rem)] pr-4">
                <fieldset disabled={disabled}>
                  <div
                    key={active.key}
                    className="min-w-0 space-y-6"
                    aria-label={`组别 ${active.name || "未命名组别"}`}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
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
                          onChange={(e) =>
                            update({ ...active, name: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="组别邀请码（可选）">
                        <InputGroup>
                          <InputGroupInput
                            ref={inviteRef}
                            value={active.invite_code ?? ""}
                            autoComplete="off"
                            maxLength={128}
                            placeholder="留空沿用比赛设置"
                            aria-invalid={
                              issue?.key === active.key &&
                              issue.field === "invite_code"
                            }
                            aria-describedby={
                              issue?.key === active.key &&
                              issue.field === "invite_code"
                                ? "group-field-issue"
                                : undefined
                            }
                            onChange={(e) =>
                              update({ ...active, invite_code: e.target.value })
                            }
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              type="button"
                              size="icon-xs"
                              aria-label="随机生成组别邀请码"
                              title="随机生成"
                              onClick={() =>
                                update({
                                  ...active,
                                  invite_code: randomUUID()
                                    .replaceAll("-", "")
                                    .slice(0, 12),
                                })
                              }
                            >
                              <Shuffle />
                            </InputGroupButton>
                            <InputGroupButton
                              type="button"
                              size="icon-xs"
                              disabled={!active.invite_code?.trim()}
                              aria-label="复制组别邀请码"
                              title="复制"
                              onClick={() =>
                                copyText(active.invite_code!.trim())
                                  .then(() => toast.success("已复制"))
                                  .catch(() =>
                                    toast.error("复制失败，请手动复制"),
                                  )
                              }
                            >
                              <Copy />
                            </InputGroupButton>
                            <InputGroupButton
                              type="button"
                              size="icon-xs"
                              disabled={!active.invite_code}
                              aria-label="清除组别邀请码"
                              title="清除"
                              onClick={() =>
                                update({ ...active, invite_code: "" })
                              }
                            >
                              <X />
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                      <Field label="参赛要求（可选）" className="sm:col-span-2">
                        <Input
                          ref={descriptionRef}
                          maxLength={500}
                          value={active.description}
                          aria-invalid={
                            issue?.key === active.key &&
                            issue.field === "description"
                          }
                          aria-describedby={
                            issue?.key === active.key &&
                            issue.field === "description"
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
                    <fieldset className="space-y-3">
                      <legend className="text-sm font-medium">报名审核</legend>
                      <RadioGroup
                        className="flex flex-wrap gap-5"
                        value={
                          active.review_mode ??
                          (permissions.require_review ? "required" : "inherit")
                        }
                        onValueChange={(v) =>
                          update({
                            ...active,
                            review_mode: v as "inherit" | "auto" | "required",
                            permissions: {
                              ...permissions,
                              require_review: false,
                            },
                          })
                        }
                      >
                        {[
                          ["inherit", "跟随比赛"],
                          ["auto", "免审核"],
                          ["required", "需要审核"],
                        ].map(([v, l]) => (
                          <label
                            key={v}
                            className="flex items-center gap-2 text-sm"
                          >
                            <RadioGroupItem
                              value={v!}
                              className={
                                v === "required"
                                  ? "text-purple-700 dark:text-purple-300 data-[state=checked]:border-purple-600 [&_svg]:fill-current"
                                  : undefined
                              }
                            />
                            {v === "required" ? (
                              <span className="inline-flex items-center gap-2">
                                <permissionAppearance.require_review.icon
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                {l}
                              </span>
                            ) : (
                              l
                            )}
                          </label>
                        ))}
                      </RadioGroup>
                    </fieldset>
                    <fieldset className="min-w-0 space-y-4">
                      <legend className="text-sm font-medium">默认权限</legend>
                      {started && (
                        <p className="text-sm text-muted-foreground">
                          计分、排名、三血和动态分值权限在开赛后锁定。
                        </p>
                      )}
                      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                        {(
                          Object.keys(
                            permissionLabels,
                          ) as (keyof GroupPermissions)[]
                        )
                          .filter((key) => key !== "require_review")
                          .map((key) => (
                            <label
                              key={key}
                              className="flex items-center gap-2 text-sm"
                            >
                              <PermissionSwitch
                                permission={key}
                                checked={permissions[key]}
                                disabled={
                                  started && scoringPermissions.has(key)
                                }
                                onCheckedChange={(yes) =>
                                  update({
                                    ...active,
                                    permissions: {
                                      ...permissions,
                                      [key]: !!yes,
                                    },
                                  })
                                }
                              />
                              <PermissionLabel permission={key} />
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
                      <CollapsibleContent className="min-w-0 space-y-3 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:duration-150">
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
                </fieldset>
              </ScrollArea>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setActive(null);
                    setIssue(null);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const name = active.name.trim();
                    const message = !name
                      ? "请输入组别名称"
                      : name.length > 60
                        ? "组别名称最多 60 字"
                        : groups.some(
                              (g) =>
                                g.key !== active.key && g.name.trim() === name,
                            )
                          ? "组别名称不能重复"
                          : "";
                    const inviteIssue =
                      active.invite_code?.trim() &&
                      (active.invite_code.trim().length < 6 ||
                        active.invite_code.trim().length > 128)
                        ? "组别邀请码为 6–128 位"
                        : "";
                    if (
                      message ||
                      active.description.length > 500 ||
                      inviteIssue
                    ) {
                      setIssue({
                        key: active.key,
                        field: message
                          ? "name"
                          : inviteIssue
                            ? "invite_code"
                            : "description",
                        message:
                          message || inviteIssue || "参赛要求最多 500 字",
                      });
                      return;
                    }
                    const next = {
                      ...active,
                      name,
                      invite_code: active.invite_code?.trim(),
                    };
                    setGroups((old) =>
                      old.some((g) => g.key === next.key)
                        ? old.map((g) => (g.key === next.key ? next : g))
                        : [...old, next],
                    );
                    if (!groups.some((g) => g.key === next.key))
                      setPage(Math.ceil((groups.length + 1) / 10));
                    setIssue(null);
                    setActive(null);
                  }}
                >
                  确认组别
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <div className="space-y-4">
        <div className="divide-y">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-1 pb-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="min-w-0 space-y-1">
              <h4 className="text-sm font-medium">默认组别</h4>
              <span className="text-xs text-muted-foreground">
                沿用比赛设置
              </span>
            </div>
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <GroupPermissionSummary requireReview={requireReview} />
            </div>
            <div
              className="col-start-2 row-start-1 flex w-16 justify-end sm:col-start-3"
              title="默认组别不可删除"
            >
              <span
                className="flex size-7 items-center justify-center text-muted-foreground"
                aria-label="默认组别不可删除"
              >
                <LockKeyhole className="size-3.5" />
              </span>
            </div>
          </div>
          {groups.slice((currentPage - 1) * 10, currentPage * 10).map((g) => (
            <div
              key={g.key}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-1 py-3 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <div className="min-w-0 space-y-1">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto max-w-full justify-start p-0 text-left text-sm text-foreground"
                  data-edit-group={g.key}
                  aria-label={`配置组别 ${g.name || "未命名组别"}`}
                  title={g.name || "未命名组别"}
                  disabled={disabled}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setIssue(null);
                    setActive(structuredClone(g));
                  }}
                >
                  <span className="truncate">{g.name || "未命名组别"}</span>
                  {(g.invite_code?.trim() ||
                    (g.invite_code === undefined && g.invite_code_set)) && (
                    <KeyRound
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="需要组别邀请码"
                    />
                  )}
                </Button>
                {g.description && (
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {g.description}
                  </p>
                )}
              </div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <GroupPermissionSummary
                  group={g}
                  requireReview={requireReview}
                  challengeIds={challengeIds}
                />
              </div>
              <div className="col-start-2 row-start-1 flex w-16 justify-end gap-2 sm:col-start-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`编辑组别 ${g.name || "未命名组别"}`}
                  disabled={disabled}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setIssue(null);
                    setActive(structuredClone(g));
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  aria-label={`删除组别 ${g.name || "未命名组别"}`}
                  title="删除后，战队回到默认组别"
                  disabled={disabled}
                  onClick={() => remove(g)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
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
                <PermissionLabel permission={key} />
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
                    <PermissionSwitch
                      permission={key}
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
    invite_code:
      JSON.parse(String(f.getAll("group_invite_code")[i] ?? "null")) ??
      undefined,
    review_mode: f.getAll("group_review_mode")[i] || "inherit",
    description: f.getAll("group_description")[i],
    permissions: JSON.parse(String(f.getAll("group_permissions")[i] ?? "{}")),
    challenge_permissions: Object.fromEntries(
      Object.entries(
        JSON.parse(String(f.getAll("group_challenge_permissions")[i] ?? "{}")),
      ).filter(([id]) => challengeIds.includes(id)),
    ),
  }));
}
