import type { Challenge } from "./types";
export type QuestionType = "ctf" | "objective" | "awdp" | "awd";
export const questionTypes: Record<QuestionType, string> = {
  ctf: "CTF 题",
  objective: "客观题",
  awdp: "AWDP 题",
  awd: "AWD 题",
};
export type ResourceProfile = {
  image: string;
  cpu: number;
  memory: number;
  ttl: number;
  use_platform_ttl?: boolean;
  mode?: "private" | "public";
  access_mode?: "port" | "domain";
  port?: number;
};
export type Resources = {
  container: ResourceProfile | null;
  attachment: ResourceProfile | null;
};
export type Objective = {
  type: "single" | "multiple" | "blank";
  options: { id: string; text: string }[];
  correct_options?: string[];
  blanks: { id: string; label: string; answers?: string[] }[];
  case_sensitive: boolean;
  trim: boolean;
};
export type PatchConfig = {
  checker_image: string;
  patch_root: string;
  timeout: number;
  cpu: number;
  memory: number;
};
export type Points = {
  initial_points: number;
  minimum_points: number;
  decay: number;
};
export type Scoring = {
  mode: "inherit" | "fixed" | "dynamic" | "round";
  points?: Points;
  parts: { id: string; points: Points }[];
  round?: {
    dynamic: boolean;
    carry: boolean;
    flag_lifetime: number;
    defense_points: number;
    availability_points: number;
  };
};
export type ContestQuestion = {
  challenge_id: string;
  published: boolean;
  release_at: string | null;
  scoring: Scoring;
};
export type PhaseRule = {
  mode: "inherit" | "fixed" | "flexible";
  opens_at: string | null;
  closes_at: string | null;
  duration_seconds: number | null;
};
export type Phase = PhaseRule & {
  section: "objective" | "practical";
  status: "scheduled" | "ready" | "active" | "ended";
  started_at: string | null;
  deadline_at: string | null;
};
export const defaultResource = (): ResourceProfile => ({
  image: "",
  cpu: 500,
  memory: 256,
  ttl: 1800,
  mode: "private",
  access_mode: "port",
  port: 8080,
});
export function profiles(c: Challenge | null): Resources {
  if (c?.resource_config) return c.resource_config;
  if (
    c?.resources &&
    typeof c.resources.attachment !== "boolean" &&
    (!c.resources.container || "image" in c.resources.container)
  )
    return c.resources as Resources;
  const resource = c
    ? {
        image: c.image,
        cpu: c.cpu,
        memory: c.memory,
        ttl: c.ttl,
        mode:
          c.kind === "static_container"
            ? ("public" as const)
            : ("private" as const),
        access_mode: c.access_mode,
        port: c.port,
      }
    : defaultResource();
  return {
    container: c?.kind.endsWith("_container") ? resource : null,
    attachment: c?.kind === "dynamic_attachment" ? resource : null,
  };
}
export const defaultRound = () => ({
  dynamic: false,
  carry: true,
  flag_lifetime: 1,
  defense_points: 100,
  availability_points: 100,
});
export function questionSetting(c: Challenge): ContestQuestion {
  return {
    challenge_id: c.id,
    published: true,
    release_at: null,
    scoring:
      c.challenge_type === "awd"
        ? {
            mode: "round",
            points: {
              initial_points: c.initial_points,
              minimum_points: c.minimum_points,
              decay: c.decay,
            },
            parts: [],
            round: defaultRound(),
          }
        : { mode: "inherit", parts: [] },
  };
}
