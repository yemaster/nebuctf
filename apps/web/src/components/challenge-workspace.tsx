import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ChallengeHints } from "./challenge-hints";
import { RoundProgress } from "./round-progress";
import { ChallengeBloods } from "./challenge-bloods";
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
import { Markdown } from "./markdown";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableRow, TableCell } from "./ui/table";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";
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
  const [submissionTab, setSubmissionTab] = useState("attack");
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
      ).catch((error) => {
        void detail.refetch();
        throw error;
      });
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
  const hasDefense =
    c?.defense_enabled ?? ["awdp", "awd"].includes(c?.challenge_type ?? "");
  const flagUsage = c?.submission_usage?.flag;
  const completed =
    c?.scoring_mode === "round" && c?.round?.carry === false
      ? false
      : !!(solved || c?.solved || feedback?.completed);
  const attackCompleted =
    completed ||
    (hasDefense &&
      c?.challenge_type !== "awd" &&
      !(c?.round && c.round.carry === false) &&
      !!c?.parts?.length &&
      c.parts.filter((p) => p.role !== "defense").every((p) => p.solved));
  return (
    <ScrollArea className="h-full min-h-0">
      <QueryState
        loading={detail.isLoading}
        error={detail.error}
        retry={() => void detail.refetch()}
        fullPage
      />
      {c && !detail.error && (
        <article
          className={`mx-auto w-full max-w-5xl space-y-9 px-6 py-8 sm:px-10 lg:px-12 lg:py-12 xl:px-16 ${scope !== "practice" ? "md:pt-12" : ""}`}
        >
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
              {c.challenge_type !== "awd" && (
                <span>
                  {c.solves} {scope === "practice" ? "人" : "队"}全部解出
                </span>
              )}
              {scope !== "practice" &&
                !c.parts?.length &&
                c.challenge_type !== "awd" && (
                  <ChallengeBloods title={c.title} bloods={c.bloods} />
                )}
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
            <QuestionResources
              challenge={c}
              scope={scope}
              accessNotice={
                !participating
                  ? {
                      message: contest.isLoading
                        ? "正在读取报名状态"
                        : contest.error
                          ? "报名状态暂不可用"
                          : registration?.status === "pending"
                            ? "报名审核通过后可使用环境"
                            : registration?.status === "suspended"
                              ? "参赛资格已暂停"
                              : registration?.status === "rejected"
                                ? "报名未通过"
                                : "报名比赛后可使用环境",
                      label: registration ? "查看报名" : "前往报名",
                      href: `/contests/${scope}`,
                    }
                  : null
              }
            />
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
          {c.hints.length > 0 && (
            <ChallengeHints
              key={`${scope}:${id}`}
              challenge={c}
              scope={scope}
              refresh={() => void detail.refetch()}
            />
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
            <Tabs
              role="region"
              value={submissionTab}
              onValueChange={setSubmissionTab}
              aria-label={hasDefense ? "攻击与防守" : "提交 flag"}
              className="gap-3 rounded-lg bg-card p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-4">
                {hasDefense ? (
                  <TabsList variant="line" aria-label="作答方式">
                    <TabsTrigger value="attack">攻击</TabsTrigger>
                    <TabsTrigger value="defense">防守</TabsTrigger>
                  </TabsList>
                ) : (
                  <h2 className="font-medium">提交 flag</h2>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {(c.hint_factor ?? 1) < 1 && (
                    <span className="tabular-nums">
                      本题系数 × {Number(c.hint_factor!.toPrecision(5))}
                    </span>
                  )}
                  {c.total_parts > 1 && (
                    <span>
                      {completed ? c.total_parts : c.solved_parts} /{" "}
                      {c.total_parts} 已通过
                    </span>
                  )}
                </div>
              </div>
              <TabsContent
                value="attack"
                forceMount
                hidden={hasDefense && submissionTab !== "attack"}
                className="space-y-3"
              >
                {c.parts?.filter((p) => !hasDefense || p.role !== "defense")
                  .length > 0 && (
                  <Table className="table-fixed" aria-label="小题进度">
                    <colgroup>
                      <col className="w-6" />
                      <col />
                    </colgroup>
                    <TableBody>
                      {c.parts
                        .filter((p) => !hasDefense || p.role !== "defense")
                        .map((part) => (
                          <TableRow
                            key={part.id}
                            className="border-0 hover:bg-transparent"
                          >
                            <TableCell className="py-1.5 pl-0 pr-2">
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
                            <TableCell className="whitespace-normal break-words py-1.5 pl-0 pr-0">
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                                <span className="max-w-full break-words font-medium">
                                  {part.title}
                                </span>
                                <span className="shrink-0 font-medium tabular-nums">
                                  {part.points}
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    分
                                  </span>
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {part.solves}{" "}
                                  {scope === "practice" ? "人" : "队"}解出
                                </span>
                              </div>
                              {part.description && (
                                <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                                  {part.description}
                                </p>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
                {attackCompleted ? (
                  <FlagFeedback
                    key={`solved-${feedback?.key ?? id}`}
                    correct
                    animate={!!feedback?.animate && !!feedback.completed}
                    message={completed ? "该题目已解答" : "攻击部分已解答"}
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
                      if (flagUsage?.remaining !== 0) submit.mutate();
                    }}
                  >
                    <label htmlFor={`flag-${id}`} className="sr-only">
                      Flag
                    </label>
                    <m.div animate={shake}>
                      <InputGroup className="h-12 border-0 bg-background shadow-none">
                        <InputGroupInput
                          className="font-mono"
                          disabled={
                            flagUsage?.remaining === 0 || submit.isPending
                          }
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
                          aria-invalid={
                            feedback ? !feedback.correct : undefined
                          }
                          aria-describedby={
                            feedback ? `feedback-${id}` : undefined
                          }
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            type="submit"
                            size="sm"
                            variant="default"
                            disabled={
                              submit.isPending || flagUsage?.remaining === 0
                            }
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
                    {flagUsage?.limit != null && (
                      <p
                        className={`text-xs tabular-nums ${flagUsage.remaining === 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {flagUsage.remaining === 0
                          ? "Flag 提交次数已用完"
                          : `剩余 ${flagUsage.remaining} / ${flagUsage.limit} 次提交`}
                      </p>
                    )}
                    {submit.error && <ActionError error={submit.error} />}
                  </form>
                ) : (
                  <Button asChild>
                    <Link to={loginHref}>登录后答题</Link>
                  </Button>
                )}
              </TabsContent>
              {hasDefense && (
                <TabsContent
                  value="defense"
                  forceMount
                  hidden={submissionTab !== "defense"}
                >
                  {previewNotice ??
                    (!user ? (
                      <Button asChild>
                        <Link to={loginHref}>登录后答题</Link>
                      </Button>
                    ) : !permissions.submit || !permissions.resources ? (
                      <p className="text-sm text-muted-foreground">
                        本题未开放防守提交
                      </p>
                    ) : (
                      <PatchPanel
                        id={id}
                        scope={scope}
                        active={active && submissionTab === "defense"}
                        completed={
                          c.challenge_type !== "awd" &&
                          !(c.round && c.round.carry === false) &&
                          (completed ||
                            c.parts.some(
                              (p) => p.role === "defense" && p.solved,
                            ))
                        }
                      />
                    ))}
                </TabsContent>
              )}
            </Tabs>
          )}
        </article>
      )}
      {!c && !detail.isLoading && !detail.error && <Empty>选择一道题目</Empty>}
    </ScrollArea>
  );
}
