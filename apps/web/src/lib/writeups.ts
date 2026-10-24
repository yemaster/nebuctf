export type WriteupConfig = {
  enabled: boolean;
  required: boolean;
  submitter: "captain" | "members";
  opens_at: string | null;
  deadline: string | null;
  max_size_mb: number;
  formats: ("pdf" | "zip")[];
  allow_resubmit: boolean;
  note: string;
};
export const defaultWriteup: WriteupConfig = {
  enabled: false,
  required: false,
  submitter: "members",
  opens_at: null,
  deadline: null,
  max_size_mb: 20,
  formats: ["pdf"],
  allow_resubmit: true,
  note: "",
};
export type WriteupStatus = "submitted" | "accepted" | "changes_requested";
export const writeupStatuses = {
  missing: "未提交",
  submitted: "待查看",
  accepted: "已确认",
  changes_requested: "需修改",
};
export type WriteupSubmission = {
  team_id: string;
  team_name?: string;
  group_name?: string | null;
  registration_status?: string;
  name: string;
  size: number;
  format: "pdf" | "zip";
  version: number;
  submitted_at: string;
  submitted_by: string;
  status: WriteupStatus;
  review_note: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type OwnWriteup = {
  config: WriteupConfig;
  team: { team_id: string; team_name: string };
  can_submit: boolean;
  submission: WriteupSubmission | null;
  window: "disabled" | "upcoming" | "closed" | "submitted" | "open";
  opens_at: string;
};
export const fileSize = (size: number) =>
  size < 1048576
    ? `${Math.max(1, Math.round(size / 1024))} KiB`
    : `${(size / 1048576).toFixed(1)} MiB`;
