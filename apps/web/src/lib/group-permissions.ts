export const defaultGroupPermissions = {
  join: true,
  rank_overall: true,
  require_review: false,
  view: true,
  submit: true,
  resources: true,
  score: true,
  blood: true,
  dynamic: true,
};
export type GroupPermissions = typeof defaultGroupPermissions;
export type ChallengePermission = Exclude<
  keyof GroupPermissions,
  "join" | "rank_overall" | "require_review"
>;
export const permissionLabels: Record<keyof GroupPermissions, string> = {
  join: "允许报名",
  require_review: "报名需要审核",
  rank_overall: "参与全局排名",
  view: "查看赛题",
  submit: "提交答案",
  resources: "使用靶机与附件",
  score: "获得积分",
  blood: "参与三血",
  dynamic: "影响动态分值",
};
export const challengePermissions: ChallengePermission[] = [
  "view",
  "submit",
  "resources",
  "score",
  "blood",
  "dynamic",
];
export const scoringPermissions = new Set<keyof GroupPermissions>([
  "rank_overall",
  "score",
  "blood",
  "dynamic",
]);
