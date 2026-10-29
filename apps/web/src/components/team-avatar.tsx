import { Users } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import { cn } from "@/lib/utils";
export function TeamAvatar({
  logoId,
  className,
}: {
  logoId?: string | null;
  className?: string;
}) {
  return (
    <Avatar aria-hidden="true" className={cn("rounded-lg", className)}>
      {logoId && <AvatarImage src={`/api/team-logos/${logoId}`} alt="" />}
      <AvatarFallback className="rounded-lg">
        <Users className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  );
}
