import { RoundProgress } from "./round-progress";
import { QuestionResources } from "./question-resources";
import { ObjectiveAnswer } from "./objective-answer";
import { PatchPanel } from "./patch-panel";
import { AwdArena } from "./awd-arena";
import { m, useAnimationControls, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2, Circle, Eye } from "lucide-react";
import { useUser } from "@/App";
import { api, useAction, useAPI } from "@/lib/api";
import type { Challenge, Contest } from "@/lib/types";
import { defaultGroupPermissions } from "@/lib/group-permissions";
import { Button } from "./ui/button";
import { Alert, AlertTitle } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { ActionError } from "./action-error";
import { FlagFeedback } from "./flag-feedback";
import { Table, TableBody, TableRow, TableCell } from "./ui/table";
import { Markdown } from "./markdown";
import { ScrollArea } from "./ui/scroll-area";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";
import { Empty, QueryState } from "./shared";

export function ChallengeWorkspace({
  id,
  scope,
  active,
  solved = false,
}: {
  id: string;
  scope: string;
  active: boolean;
  solved?: boolean;
}) {
  const user = useUser();
  const location = useLocation();
  const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const detail = useAPI<Challenge>(`/challenges/${id}?scope=${scope}`, active);
  const contest = useAPI<Contest>(
    `/contests/${scope}`,
    active && scope !== "practice",
  );
  const participating = scope === "practice" || !!contest.data?.registered;
  const registration = contest.data?.registration;
  const previewNotice =
    scope === "practice" || participating ? null : contest.isLoading ? (
      <Skeleton className="h-14 w-full" aria-label="正在读取报名状态" />
    ) : contest.error ? (
      <div className="space-y-3">
        <ActionError error={contest.error} />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void contest.refetch()}
        >
          重试
        </Button>
      </div>
    ) : (
      <Alert
        role="status"
        className="items-center border-0 bg-muted/50 [&>svg]:translate-y-0"
      >
        <Eye />
        <div className="col-start-2 flex flex-wrap items-center justify-between gap-3">
          <AlertTitle className="line-clamp-none font-normal leading-6">
            {registration?.status === "pending"
              ? "报名待审核，通过后即可作答。"
              : registration?.status === "rejected"
                ? "报名未通过，暂不能作答。"
                : registration?.status === "suspended"
                  ? "参赛资格已暂停，暂不能作答。"
                  : "报名比赛后即可作答"}
          </AlertTitle>
          <Button asChild variant="secondary" size="sm">
            <Link to={`/contests/${scope}`}>
              {registration ? "查看报名" : "前往报名"}
            </Link>
          </Button>
        </div>
      </Alert>
    );
  const c = detail.data;
  const permissions = { ...defaultGroupPermissions, ...c?.permissions };
  const [flag, setFlag] = useState("");
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    message: string;
    completed: boolean;
    animate: boolean;
    key: number;
  } | null>(null);
  const shake = useAnimationControls();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (feedback && !feedback.correct && !reduced)
      void shake.start({
        x: [0, -8, 8, -5, 5, 0],
        transition: { duration: 0.38 },
      });
    else shake.set({ x: 0 });
  }, [feedback, reduced, shake]);
  const submit = useAction(
    async () => {
      if (!participating) return;
      const result = await api<{
        correct: boolean;
        already_solved: boolean;
        completed: boolean;
        part_title?: string;
      }>(
        `/challenges/${id}/${c?.challenge_type === "awd" ? "attack" : "submit"}`,
        "POST",
        { flag, scope },
      );
      setFeedback({
        correct: result.correct,
        completed: result.completed,
        animate: result.correct && !result.already_solved,
        key: Date.now(),
        message: result.correct
          ? result.already_solved
            ? `${result.part_title ?? "此题"} 已通过`
            : result.part_title
              ? `${result.part_title} 通过`
              : "Flag 正确"
          : "Flag 不正确",
      });
      if (result.correct) setFlag("");
    },
    undefined,
    false,
  );
  const completed =
    c?.scoring_mode === "round" && c?.round?.carry === false
      ? false
      : !!(solved || c?.solved || feedback?.completed);
  return (
    <ScrollArea className="h-full min-h-0">
      <QueryState
        loading={detail.isLoading}
        error={detail.error}
        retry={() => void detail.refetch()}
        fullPage
      />
      {c && !detail.error && (
        <article className="mx-auto w-full max-w-5xl space-y-9 px-6 py-8 sm:px-10 lg:px-12 lg:py-12 xl:px-16">
          <header
            data-card-detail={
              scope === "practice" ? `practice:${id}` : undefined
            }
            className="space-y-4"
          >
            <h1 className="break-words text-3xl font-semibold">{c.title}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span>{c.category}</span>
              <span>{c.difficulty}</span>
              <span>{c.points} 分</span>
              <span>{c.solves} 人全部解出</span>
              {!permissions.score && (
                <span>
                  {c.contest_practice ? "赛后练习" : "本组作答不计分"}
                </span>
              )}
              {completed && (
                <span className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="size-4" />
                  已完成
                </span>
              )}
            </div>
          </header>
          <section
            aria-label="题面"
            className="min-w-0 [&_.markdown]:text-base [&_.markdown]:leading-8"
          >
            <Markdown>{c.description || "暂无题面"}</Markdown>
          </section>
          {c.scoring_mode === "round" &&
            (c.challenge_type !== "awd" || c.contest_practice) &&
            user &&
            participating && (
              <RoundProgress
                id={id}
                scope={scope}
                carry={c.round?.carry !== false}
              />
            )}
          {permissions.resources && (
            <QuestionResources challenge={c} scope={scope} />
          )}
          {c.contest_practice && c.challenge_type === "awd" && (
            <p className="text-sm text-muted-foreground">
              对抗已结束，可查看题面和历史轮次。
            </p>
          )}
          {c.challenge_type === "awd" &&
            user &&
            participating &&
            permissions.resources && <AwdArena id={id} scope={scope} />}
          {(c.challenge_type === "awdp" || c.challenge_type === "awd") &&
            user &&
            participating &&
            permissions.submit &&
            permissions.resources && <PatchPanel id={id} scope={scope} />}
          {c.hints.length > 0 && (
            <section aria-label="题目提示">
              <Accordion type="multiple">
                {c.hints.map((hint, i) => (
                  <AccordionItem key={i} value={String(i)} className="border-0">
                    <AccordionTrigger>提示 {i + 1}</AccordionTrigger>
                    <AccordionContent className="whitespace-pre-wrap break-words text-muted-foreground">
                      {hint}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          )}
          {c.challenge_type === "objective" && c.objective ? (
            previewNotice ? (
              previewNotice
            ) : user ? (
              <ObjectiveAnswer
                key={id}
                id={id}
                scope={scope}
                definition={c.objective}
                readOnly={!permissions.submit}
              />
            ) : (
              <Button asChild>
                <Link to={loginHref}>登录后答题</Link>
              </Button>
            )
          ) : (
            <section
              aria-label={completed ? "解答状态" : "提交 Flag"}
              className="space-y-5 rounded-lg bg-card p-5 sm:p-7"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-medium">
                  {c.total_parts > 1
                    ? "小题"
                    : completed
                      ? "解答状态"
                      : "提交 Flag"}
                </h2>
                {c.total_parts > 1 && (
                  <span className="text-sm text-muted-foreground">
                    {completed ? c.total_parts : c.solved_parts} /{" "}
                    {c.total_parts} 已通过
                  </span>
                )}
              </div>
              {c.parts?.length > 0 && (
                <Table>
                  <TableBody>
                    {c.parts.map((part) => (
                      <TableRow key={part.id} className="border-0">
                        <TableCell className="w-8 pl-0">
                          {completed || part.solved ? (
                            <CheckCircle2
                              className="size-4 text-success"
                              aria-label="已通过"
                            />
                          ) : (
                            <Circle
                              className="size-4 text-muted-foreground"
                              aria-label="未通过"
                            />
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="font-medium">{part.title}</span>
                          {part.description && (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                              {part.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                          {part.points} 分
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-xs text-muted-foreground sm:table-cell">
                          {part.solves} 人通过
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {completed ? (
                <FlagFeedback
                  key={`solved-${feedback?.key ?? id}`}
                  correct
                  animate={!!feedback?.animate && !!feedback.completed}
                  message="该题目已解答"
                />
              ) : previewNotice ? (
                previewNotice
              ) : !permissions.submit ? (
                <p className="text-sm text-muted-foreground">
                  {c.contest_practice && c.challenge_type === "awd"
                    ? ""
                    : "本组可查看此题，暂不开放作答。"}
                </p>
              ) : user ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit.mutate();
                  }}
                >
                  <label htmlFor={`flag-${id}`} className="sr-only">
                    Flag
                  </label>
                  <m.div animate={shake}>
                    <InputGroup className="h-12 border-0 bg-background shadow-none">
                      <InputGroupInput
                        id={`flag-${id}`}
                        value={flag}
                        onChange={(e) => {
                          setFlag(e.target.value);
                          setFeedback(null);
                        }}
                        placeholder={
                          c.total_parts > 1
                            ? "提交任意小题的 Flag"
                            : "flag{...}"
                        }
                        required
                        maxLength={256}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={feedback ? !feedback.correct : undefined}
                        aria-describedby={
                          feedback ? `feedback-${id}` : undefined
                        }
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          type="submit"
                          size="sm"
                          variant="default"
                          disabled={submit.isPending}
                        >
                          {submit.isPending ? "提交中" : "提交"}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  </m.div>
                  {feedback && (
                    <div id={`feedback-${id}`}>
                      <FlagFeedback
                        key={feedback.key}
                        correct={feedback.correct}
                        message={feedback.message}
                        animate={feedback.animate}
                      />
                    </div>
                  )}
                  {submit.error && <ActionError error={submit.error} />}
                </form>
              ) : (
                <Button asChild>
                  <Link to={loginHref}>登录后答题</Link>
                </Button>
              )}
            </section>
          )}
        </article>
      )}
      {!c && !detail.isLoading && !detail.error && <Empty>选择一道题目</Empty>}
    </ScrollArea>
  );
}
