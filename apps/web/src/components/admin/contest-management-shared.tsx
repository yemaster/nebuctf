import { useLocation, useParams } from "react-router-dom";
import { Badge } from "../ui/badge";
export const statuses = {
  pending: "待审核",
  accepted: "已通过",
  rejected: "未通过",
  suspended: "已暂停",
};
export const integrityStatuses = {
  open: "待核实",
  confirmed: "已确认",
  dismissed: "已排除",
};
export type ReviewStatus = keyof typeof statuses;
export type Registration = {
  team_id: string;
  name: string;
  captain: string;
  member_count: number;
  group_id: string | null;
  group_name: string | null;
  status: ReviewStatus;
  created_at: string;
  review_note: string;
  accepted_at: string | null;
  members: {
    id: string;
    username: string;
    email: string;
    disabled: boolean;
    created_at: string;
    captain: boolean;
  }[];
};
export type Clue = {
  id: string;
  challenge_title: string;
  part_title: string | null;
  team_id: string;
  team_name: string;
  source_team_id: string;
  source_team_name: string;
  username: string;
  submitted_at: string;
  submission_id: string;
  status: keyof typeof integrityStatuses;
  note: string;
  reviewer: string | null;
  updated_at: string;
};
export type Activity = {
  id: string;
  type: string;
  created_at: string;
  team_id: string | null;
  team_name: string | null;
  username: string | null;
  challenge_title: string | null;
  part_title: string | null;
  correct: boolean | null;
  detail: string | null;
};
export function useBase() {
  const { id } = useParams(),
    location = useLocation();
  return {
    id: id!,
    base: `${location.pathname.startsWith("/admin") ? "/admin" : ""}/contests/${id}/manage`,
    apiBase: `/admin/contests/${id}`,
  };
}
export function ReviewBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={
        status === "accepted" || status === "dismissed"
          ? "text-success bg-success/10"
          : status === "rejected" ||
              status === "suspended" ||
              status === "confirmed"
            ? "text-destructive bg-destructive/10"
            : "text-warning bg-warning/10"
      }
    >
      {({ ...statuses, ...integrityStatuses } as Record<string, string>)[
        status
      ] ?? status}
    </Badge>
  );
}
