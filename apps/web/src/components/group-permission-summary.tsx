import type { ComponentProps } from "react";
import {
  Coins,
  Eye,
  Flame,
  Send,
  Server,
  ShieldCheck,
  Slash,
  TrendingDown,
  Trophy,
  UserRoundPlus,
} from "lucide-react";
import type { ContestGroup } from "@/lib/types";
import {
  defaultGroupPermissions,
  permissionLabels,
  type GroupPermissions,
} from "@/lib/group-permissions";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export const permissionAppearance = {
  join: {
    icon: UserRoundPlus,
    color: "text-red-700 dark:text-red-300",
    background: "bg-red-500/10 hover:bg-red-500/20",
    control:
      "data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500",
  },
  rank_overall: {
    icon: Trophy,
    color: "text-pink-700 dark:text-pink-300",
    background: "bg-pink-500/10 hover:bg-pink-500/20",
    control:
      "data-[state=checked]:bg-pink-600 dark:data-[state=checked]:bg-pink-500",
  },
  require_review: {
    icon: ShieldCheck,
    color: "text-purple-700 dark:text-purple-300",
    background: "bg-purple-500/10 hover:bg-purple-500/20",
    control:
      "data-[state=checked]:bg-purple-600 dark:data-[state=checked]:bg-purple-500",
  },
  view: {
    icon: Eye,
    color: "text-indigo-700 dark:text-indigo-300",
    background: "bg-indigo-500/10 hover:bg-indigo-500/20",
    control:
      "data-[state=checked]:bg-indigo-600 dark:data-[state=checked]:bg-indigo-500",
  },
  submit: {
    icon: Send,
    color: "text-blue-700 dark:text-blue-300",
    background: "bg-blue-500/10 hover:bg-blue-500/20",
    control:
      "data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500",
  },
  resources: {
    icon: Server,
    color: "text-cyan-700 dark:text-cyan-300",
    background: "bg-cyan-500/10 hover:bg-cyan-500/20",
    control:
      "data-[state=checked]:bg-cyan-600 dark:data-[state=checked]:bg-cyan-500",
  },
  score: {
    icon: Coins,
    color: "text-green-700 dark:text-green-300",
    background: "bg-green-500/10 hover:bg-green-500/20",
    control:
      "data-[state=checked]:bg-green-600 dark:data-[state=checked]:bg-green-500",
  },
  blood: {
    icon: Flame,
    color: "text-amber-700 dark:text-amber-300",
    background: "bg-amber-500/10 hover:bg-amber-500/20",
    control:
      "data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500",
  },
  dynamic: {
    icon: TrendingDown,
    color: "text-orange-700 dark:text-orange-300",
    background: "bg-orange-500/10 hover:bg-orange-500/20",
    control:
      "data-[state=checked]:bg-orange-600 dark:data-[state=checked]:bg-orange-500",
  },
} as const;

export function PermissionSwitch({
  permission,
  className,
  ...props
}: ComponentProps<typeof Switch> & { permission: keyof GroupPermissions }) {
  return (
    <Switch
      {...props}
      className={cn(
        permissionAppearance[permission].control,
        "[&_[data-slot=switch-thumb]]:bg-white dark:[&_[data-slot=switch-thumb]]:bg-white",
        className,
      )}
    />
  );
}

export function PermissionLabel({
  permission,
}: {
  permission: keyof GroupPermissions;
}) {
  const { icon: Icon } = permissionAppearance[permission];
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{permissionLabels[permission]}</span>
    </span>
  );
}

export function GroupPermissionSummary({
  group,
  requireReview = false,
  challengeIds = [],
}: {
  group?: ContestGroup;
  requireReview?: boolean;
  challengeIds?: string[];
}) {
  const permissions = { ...defaultGroupPermissions, ...group?.permissions };
  const review =
    group?.review_mode ?? (permissions.require_review ? "required" : "inherit");
  permissions.require_review =
    review === "inherit" ? requireReview : review === "required";
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="relative z-10 flex flex-wrap items-center gap-1"
        role="group"
        aria-label={`${group?.name || "默认组别"}权限`}
      >
        {(Object.keys(permissionAppearance) as (keyof GroupPermissions)[]).map(
          (key) => {
            const { icon: Icon, color, background } = permissionAppearance[key];
            const enabled = permissions[key];
            const mixed = Object.entries(
              group?.challenge_permissions ?? {},
            ).some(
              ([id, overrides]) =>
                challengeIds.includes(id) &&
                overrides[key as keyof typeof overrides] !== undefined &&
                overrides[key as keyof typeof overrides] !== enabled,
            );
            const status = mixed
              ? `部分赛题不同（默认${enabled ? "开启" : "关闭"}）`
              : enabled
                ? "已开启"
                : "已关闭";
            const description = `${permissionLabels[key]}：${status}${key === "require_review" && review === "inherit" ? " · 跟随比赛" : ""}`;
            return (
              <Popover key={key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={description}
                        data-permission={key}
                        data-permission-state={
                          mixed ? "mixed" : enabled ? "on" : "off"
                        }
                        className={cn(
                          "relative size-7 shrink-0 rounded-md border border-transparent [&>svg]:size-3.5",
                          enabled || mixed
                            ? [color, background]
                            : "bg-muted text-muted-foreground",
                          mixed && "border-current border-dashed",
                        )}
                      >
                        <Icon aria-hidden="true" />
                        {!enabled && !mixed && (
                          <Slash className="absolute" aria-hidden="true" />
                        )}
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{description}</TooltipContent>
                </Tooltip>
                <PopoverContent
                  className="w-auto max-w-72 px-3 py-2 text-xs"
                  side="top"
                >
                  {description}
                </PopoverContent>
              </Popover>
            );
          },
        )}
      </div>
    </TooltipProvider>
  );
}
