import type { Objective, Phase } from "./competition";
export const OBJECTIVE_PAPER = "objective";
export type ObjectiveResponse = {
  choices?: string[];
  blanks?: Record<string, string>;
};
export type ObjectiveSaved = {
  answer: ObjectiveResponse;
  correct: boolean | null;
  finalized_at: string | null;
  revision: string | null;
};
export type PaperQuestion = {
  id: string;
  title: string;
  description: string;
  objective: Objective;
  points: number;
  permissions: { submit: boolean };
  saved: ObjectiveSaved;
};
export type Paper = {
  server_time: string;
  items: PaperQuestion[];
  phase: Phase;
  preview: boolean;
  practice: boolean;
  can_submit: boolean;
};
export function answerComplete(
  definition: Objective,
  answer: ObjectiveResponse,
) {
  return definition.type === "blank"
    ? definition.blanks.every((b) => !!answer.blanks?.[b.id]?.trim())
    : !!answer.choices?.length;
}
export function answerState(
  question: PaperQuestion,
  answer: ObjectiveResponse,
  edited = false,
) {
  if (question.saved.finalized_at && !edited) {
    if (question.saved.correct) return "correct";
    if (
      answer.choices?.length ||
      Object.values(answer.blanks ?? {}).some((v) => v.trim())
    )
      return "incorrect";
    return "empty";
  }
  return answerComplete(question.objective, answer) ? "answered" : "empty";
}
export const answerLabels = {
  empty: "未作答",
  answered: "已填写",
  correct: "正确",
  incorrect: "错误",
};
export const answerColors = {
  empty:
    "bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted",
  answered:
    "bg-blue-100 text-blue-700 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-950 dark:hover:text-blue-300",
  correct:
    "bg-success/15 text-success hover:bg-success/15 hover:text-success dark:hover:bg-success/15",
  incorrect:
    "bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10",
};
