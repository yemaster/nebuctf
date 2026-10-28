import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { cn } from "@/lib/utils";

export function userInitials(name: string) {
  const words = name
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean);
  if (words.length > 1)
    return (
      Array.from(words[0]!)[0]! + Array.from(words.at(-1)!)[0]!
    ).toLocaleUpperCase();
  return Array.from(words[0] ?? "")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase();
}
export function UserAvatar({
  name,
  avatarId,
  className,
}: {
  name?: string | null;
  avatarId?: string | null;
  className?: string;
}) {
  return (
    <Avatar aria-hidden="true" className={cn("text-xs", className)}>
      {avatarId && <AvatarImage src={`/api/avatars/${avatarId}`} alt="" />}
      <AvatarFallback className="text-[length:inherit]">
        {name ? userInitials(name) : <UserRound className="size-1/2" />}
      </AvatarFallback>
    </Avatar>
  );
}
export function UserIdentity({
  name,
  avatarId,
  className,
}: {
  name?: string | null;
  avatarId?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2 align-middle",
        className,
      )}
    >
      <UserAvatar name={name} avatarId={avatarId} className="size-6" />
      <span className="min-w-0 truncate">{name || "未记录"}</span>
    </span>
  );
}
