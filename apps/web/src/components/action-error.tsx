import { CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { ApiError } from "@/lib/api";
export function ActionError({
  error,
  action,
}: {
  error: Error | string;
  action?: { label: string; href: string } | null;
}) {
  const target =
    action ?? (error instanceof ApiError ? error.action : undefined);
  return (
    <Alert
      variant="destructive"
      role="alert"
      className="border-0 bg-destructive/10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300"
    >
      <CircleAlert />
      <div className="col-start-2 flex flex-wrap items-center justify-between gap-3">
        <AlertTitle className="min-w-0 flex-1 break-words font-normal leading-6 line-clamp-none">
          {typeof error === "string" ? error : error.message}
        </AlertTitle>
        {target && (
          <Button variant="secondary" size="sm" asChild>
            <Link to={target.href}>{target.label}</Link>
          </Button>
        )}
      </div>
    </Alert>
  );
}
