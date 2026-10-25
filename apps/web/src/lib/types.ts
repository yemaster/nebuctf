import type {
  QuestionType,
  Resources,
  ResourceProfile,
  Objective,
  PatchConfig,
  ContestQuestion,
  PhaseRule,
  Phase,
} from "./competition";
export interface User {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
}
export interface ChallengePart {
  flag_env?: string | null;
  role?: "flag" | "attack" | "defense";
  id: string;
  title: string;
  description: string;
  initial_points: number;
  minimum_points: number;
  points: number;
  solves: number;
  solved: boolean;
}
export interface Challenge {
  contest_practice?: boolean;
  permissions?: import("./group-permissions").GroupPermissions;
  challenge_type?: QuestionType;
  flag_mode?: "static" | "dynamic";
  flag_env?: string;
  resources?: {
    container:
      (Partial<ResourceProfile> & { mode?: "private" | "public" }) | null;
    attachment: ResourceProfile | boolean | null;
  };
  resource_config?: Resources;
  objective?: Objective | null;
  patch_config?: PatchConfig | null;
  awd_config?: { checker_image: string; timeout: number } | null;
  scoring_mode?: string;
  round?: import("./competition").Scoring["round"];
  phase?: Phase;
  id: string;
  parts: ChallengePart[];
  total_parts: number;
  solved_parts: number;
  earned_points: number;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  kind: string;
  access_mode: "port" | "domain";
  points: number;
  solves: number;
  solved: boolean;
  hints: string[];
  attachments: { id: string; name: string; size: number }[];
  initial_points: number;
  minimum_points: number;
  decay: number;
  dynamic_score: boolean;
  published: boolean;
  practice: boolean;
  publish_at: string | null;
  contests?: { id: string; title: string }[];
  attachment_count?: number;
  image: string;
  port: number;
  cpu: number;
  memory: number;
  ttl: number;
}
export interface ContestGroup {
  id: string;
  name: string;
  description: string;
  permissions?: Partial<import("./group-permissions").GroupPermissions>;
  challenge_permissions?: Record<
    string,
    Partial<
      Pick<
        import("./group-permissions").GroupPermissions,
        import("./group-permissions").ChallengePermission
      >
    >
  >;
  joinable?: boolean;
  require_review?: boolean;
  rank_overall?: boolean;
}
export interface Contest {
  practice_mode?: boolean;
  practice_active?: boolean;
  spectator_enabled?: boolean;
  spectator_scoreboard?: boolean;
  viewer_role?: "spectator" | "participant" | "staff";
  registration_mode?: "public" | "invite" | "teams";
  registration_team_ids?: string[];
  registration_code_set?: boolean;
  eligible_team_ids?: string[] | null;
  writeup?: Partial<import("./writeups").WriteupConfig>;
  writeup_access?: boolean;
  require_review?: boolean;
  challenge_settings?: ContestQuestion[];
  timing?: { objective?: PhaseRule; practical?: PhaseRule };
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  freeze_at: string | null;
  team_limit: number;
  published: boolean;
  teams: number;
  registered: boolean;
  poster_id: string | null;
  groups: ContestGroup[];
  registration: {
    team_id: string;
    practice_only?: boolean;
    group_id: string | null;
    status?: "pending" | "accepted" | "rejected" | "suspended";
    review_note?: string;
    is_captain?: boolean;
    reviewed_at?: string | null;
    team_name: string;
    group_name: string | null;
  } | null;
  challenge_ids: string[];
}
export interface Instance {
  resource_type?: "container" | "attachment";
  created_at: string;
  ttl?: number;
  next_operation_at?: string | null;
  id: string;
  challenge_id: string;
  title: string;
  kind: string;
  status: string;
  endpoint: string | null;
  expires_at: string;
  shared: boolean;
  error: string | null;
  owner_key: string;
  scope: string;
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}
export interface Submission {
  contest_practice?: boolean;
  part_title?: string | null;
  id: string;
  username?: string;
  title: string;
  correct: boolean;
  created_at: string;
  scope: string;
}
export interface Team {
  id: string;
  name: string;
  captain_id: string;
  members: { id: string; username: string }[];
}
export interface Score {
  id: string;
  rank: number;
  overall_rank: number | null;
  group_rank: number | null;
  name: string;
  group_id: string | null;
  group_name: string | null;
  score: number;
  solves: number;
  flags: number;
  last_solve: string | null;
  cells: ScoreCell[];
}
export interface ScoreCell {
  round_number?: number | null;
  round_details?: {
    members?: { user_id: string; points: number }[];
    team_points?: number;
  };
  unit_id: string;
  score: number;
  solved_at: string;
  blood_rank: number | null;
}
export interface CategoryScore {
  category: string;
  score: number;
  flags: number;
}
export interface MemberScore {
  id: string;
  name: string;
  current_member: boolean;
  score: number;
  flags: number;
  categories: CategoryScore[];
}
export interface ScoreDetail extends Score {
  details_limited?: boolean;
  team_points?: number;
  cells: (ScoreCell & { solver_id: string; solver_name: string })[];
  columns: ScoreColumn[];
  categories: CategoryScore[];
  members: MemberScore[];
  scope: string;
  frozen: boolean;
  started: boolean;
  cutoff: string;
  ends_at: string | null;
}
export interface ScoreColumn {
  scoring_mode?: string;
  id: string;
  challenge_id: string;
  title: string;
  part_title: string | null;
  category: string;
  points: number;
  solves: number;
}
export interface ScoreTimeline {
  id: string;
  name: string;
  score: number;
  points: { time: string; score: number }[];
}
export interface ScoreboardData {
  items: Score[];
  columns: ScoreColumn[];
  timeline: ScoreTimeline[];
  total: number;
  participants: number;
  challenge_count: number;
  flag_count: number;
  page: number;
  page_size: number;
  scope: string;
  frozen: boolean;
  started: boolean;
  cutoff: string;
  starts_at: string | null;
  ends_at: string | null;
}
export interface Audit {
  id: string;
  username: string;
  action: string;
  target: string;
  created_at: string;
}
export interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  kind: "document" | "tutorial";
  body: string;
  published: boolean;
  completed: boolean;
  updated_at: string;
}
export interface LearningNode {
  id: string;
  title: string;
  article_id: string | null;
  challenge_id: string | null;
  prerequisites: string[];
  position?: { x: number; y: number } | null;
  completed?: boolean;
  unlocked?: boolean;
  level?: number;
  slug?: string | null;
  article_title?: string | null;
  challenge_title?: string | null;
}
export interface LearningTree {
  id: string;
  title: string;
  description: string;
  published: boolean;
  nodes: LearningNode[];
  completed: number;
}

export interface ProblemSet {
  id: string;
  title: string;
  description: string;
  published: boolean;
  total: number;
  completed: number;
  challenges: { id: string; title: string }[];
}
export interface TeamSummary {
  id: string;
  name: string;
  captain_id: string;
  members: number;
}
