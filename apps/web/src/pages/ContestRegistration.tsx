import { ContestInviteCodeField } from "@/components/contest-invite-code-field";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Send } from "lucide-react";
import { useUser } from "@/App";
import { api, useAPI } from "@/lib/api";
import { useDraft } from "@/lib/use-draft";
import type { Contest, TeamSummary } from "@/lib/types";
import type {
  RegistrationAnswers,
  RegistrationField,
} from "@/lib/registration-form";
import { RegistrationFields } from "@/components/registration-fields";
import { UserAvatar } from "@/components/user-avatar";
import { TeamAvatar } from "@/components/team-avatar";
import { PageTitle, QueryState, LoginPrompt } from "@/components/shared";
import { ActionError } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";

type Member = {
  id: string;
  username: string;
  avatar_id?: string;
  email: string;
  phone: string;
};
type Form = {
  fields: RegistrationField[];
  revision: string;
  members: Member[];
  saved: {
    status: string;
    form_answers: RegistrationAnswers;
    form_snapshot: RegistrationField[];
    submitted_members: Member[];
  } | null;
};
export function ContestRegistration() {
  const { id } = useParams(),
    user = useUser();
  const contest = useAPI<Contest>(`/contests/${id}`),
    teams = useAPI<{ items: TeamSummary[] }>("/teams/mine", !!user);
  const session = useAPI("/me", false);
  if (session.isLoading) return <QueryState fullPage loading error={null} />;
  if (!user) return <LoginPrompt />;
  if (!contest.data || !teams.data || contest.error || teams.error)
    return (
      <QueryState
        fullPage
        loading={contest.isLoading || teams.isLoading}
        error={contest.error || teams.error}
        retry={() => {
          void contest.refetch();
          void teams.refetch();
        }}
      />
    );
  const eligible = teams.data.items.filter(
    (t) =>
      t.captain_id === user.id &&
      (!contest.data.registration ||
        contest.data.registration.status === "rejected" ||
        t.id === contest.data.registration.team_id) &&
      (contest.data.registration_mode !== "teams" ||
        contest.data.eligible_team_ids?.includes(t.id)),
  );
  return (
    <RegistrationPage
      key={`${user.id}:${id}`}
      contest={contest.data}
      teams={eligible}
      user={user.id}
    />
  );
}
function RegistrationPage({
  contest: c,
  teams,
  user,
}: {
  contest: Contest;
  teams: TeamSummary[];
  user: string;
}) {
  const [draftSelection, setSelection, clear] = useDraft(
    `registration-choice:${user}:${c.id}`,
    {
      team: c.registration?.team_id ?? teams[0]?.id ?? "",
      group:
        c.registration?.group_id ??
        c.groups.find((g) => g.joinable !== false)?.id ??
        "",
      invite: "",
    },
  );
  const groupId =
    c.registration && c.registration.status !== "rejected"
      ? c.registration.group_id
      : draftSelection.group;
  const selection = {
    ...draftSelection,
    group:
      (
        c.groups.find((g) => g.id === groupId) ??
        c.groups.find((g) => g.is_default)
      )?.id ?? "",
  };
  const selected = teams.find((t) => t.id === selection.team);
  return (
    <>
      <PageTitle>
        <span className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to={`/contests/${c.id}`} aria-label="返回比赛">
              <ArrowLeft />
            </Link>
          </Button>
          比赛报名
        </span>
      </PageTitle>
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-5">
            <h2 className="font-semibold">{c.title}</h2>
            {!teams.length ? (
              <div className="flex items-center gap-4 text-sm">
                <span>请由队长报名</span>
                <Button asChild variant="outline">
                  <Link to="/team">我的战队</Link>
                </Button>
              </div>
            ) : (
              <div className="grid items-start gap-6 lg:grid-cols-2">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">参赛战队</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {teams.map((t) => (
                      <Button
                        key={t.id}
                        type="button"
                        variant={
                          t.id === selected?.id ? "secondary" : "outline"
                        }
                        className="h-auto justify-start gap-3 py-3"
                        onClick={() =>
                          setSelection({ ...selection, team: t.id })
                        }
                      >
                        <TeamAvatar logoId={t.logo_id} className="size-9" />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate">{t.name}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {t.members} 人
                          </span>
                        </span>
                        {t.id === selected?.id && <Check />}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                {c.groups.length > 0 && (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">参赛组别</legend>
                    <RadioGroup
                      value={selection.group}
                      onValueChange={(group) =>
                        setSelection({ ...selection, group, invite: "" })
                      }
                      className="grid gap-3"
                    >
                      {c.groups.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
                        >
                          <RadioGroupItem
                            className="mt-0.5"
                            value={g.id}
                            disabled={
                              g.joinable === false ||
                              (!!c.registration &&
                                c.registration.status !== "rejected")
                            }
                          />
                          <span className="space-y-1">
                            <span className="block text-sm font-medium">
                              {g.name}
                              {g.joinable === false && (
                                <Badge className="ml-2">报名已关闭</Badge>
                              )}
                            </span>
                            {g.description && (
                              <span className="block text-sm text-muted-foreground">
                                {g.description}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </fieldset>
                )}
                <ContestInviteCodeField
                  contest={c}
                  formId={`contest-registration-${c.id}`}
                  groupId={selection.group}
                  value={selection.invite}
                  onChange={(invite) => setSelection({ ...selection, invite })}
                />
              </div>
            )}
          </CardContent>
        </Card>
        {selected && (
          <TeamForm
            key={selected.id}
            user={user}
            contest={c}
            selection={selection}
            clearSelection={clear}
          />
        )}
      </div>
    </>
  );
}
function TeamForm({
  user,
  contest,
  selection,
  clearSelection,
}: {
  user: string;
  contest: Contest;
  selection: { team: string; group: string; invite: string };
  clearSelection: () => void;
}) {
  const query = useAPI<Form>(
    `/contests/${contest.id}/registration-form?team=${selection.team}`,
  );
  if (!query.data || query.error)
    return (
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  return (
    <AnswersForm
      key={query.data.revision}
      form={query.data}
      user={user}
      contest={contest}
      selection={selection}
      clearSelection={clearSelection}
    />
  );
}
function AnswersForm({
  form,
  user,
  contest,
  selection,
  clearSelection,
}: {
  form: Form;
  user: string;
  contest: Contest;
  selection: { team: string; group: string; invite: string };
  clearSelection: () => void;
}) {
  const initial: RegistrationAnswers = form.saved?.form_answers ?? {
    team: {},
    members: Object.fromEntries(
      form.members.map((m) => [
        m.id,
        Object.fromEntries(
          form.fields
            .filter(
              (f) =>
                f.scope === "member" && ["email", "phone"].includes(f.type),
            )
            .map((f) => [f.id, f.type === "email" ? m.email : m.phone]),
        ),
      ]),
    ),
  };
  const [answers, setAnswers, clear, stored] = useDraft(
    `registration:${user}:${contest.id}:${selection.team}`,
    initial,
  );
  const navigate = useNavigate(),
    cache = useQueryClient();
  const submitted = !!form.saved && form.saved.status !== "rejected";
  const fields = submitted ? form.saved!.form_snapshot : form.fields;
  const values = submitted ? form.saved!.form_answers : answers;
  const members =
    submitted && form.saved!.submitted_members.length
      ? form.saved!.submitted_members
      : form.members;
  const send = useMutation({
    mutationFn: () => {
      const pick = (
        scope: "team" | "member",
        values: RegistrationAnswers["team"],
      ) =>
        Object.fromEntries(
          fields
            .filter((f) => f.scope === scope && values[f.id] !== undefined)
            .map((f) => [f.id, values[f.id]]),
        );
      return api(`/contests/${contest.id}/register`, "POST", {
        team_id: selection.team,
        group_id: selection.group || null,
        invite_code: selection.invite,
        form_revision: form.revision,
        form_answers: {
          team: pick("team", answers.team),
          members: Object.fromEntries(
            form.members.map((m) => [
              m.id,
              pick("member", answers.members[m.id] ?? {}),
            ]),
          ),
        },
      });
    },
    onSuccess: async () => {
      clear();
      clearSelection();
      await cache.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).includes(contest.id),
      });
      navigate(`/contests/${contest.id}`);
    },
  });
  const teamFields = fields.filter((f) => f.scope === "team"),
    memberFields = fields.filter((f) => f.scope === "member");
  return (
    <form
      id={`contest-registration-${contest.id}`}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      {teamFields.length > 0 && (
        <Card>
          <CardContent className="space-y-5">
            <h2 className="font-semibold">战队资料</h2>
            <RegistrationFields
              fields={teamFields}
              values={values.team}
              onChange={(team) => setAnswers({ ...answers, team })}
              disabled={submitted}
            />
          </CardContent>
        </Card>
      )}
      {memberFields.length > 0 && (
        <Card>
          <CardContent className="divide-y">
            {members.map((m) => (
              <section
                key={m.id}
                className="grid items-start gap-5 py-5 first:pt-0 last:pb-0 lg:grid-cols-[200px_minmax(0,1fr)]"
              >
                <h2 className="flex items-center gap-2 font-semibold">
                  <UserAvatar
                    name={m.username}
                    avatarId={m.avatar_id}
                    className="size-7"
                  />
                  {m.username}
                </h2>
                <RegistrationFields
                  fields={memberFields}
                  values={values.members[m.id] ?? {}}
                  onChange={(v) =>
                    setAnswers({
                      ...answers,
                      members: { ...answers.members, [m.id]: v },
                    })
                  }
                  disabled={submitted}
                />
              </section>
            ))}
          </CardContent>
        </Card>
      )}
      {send.error && <ActionError error={send.error} />}
      <div className="flex flex-wrap items-center gap-4">
        {submitted ? (
          <>
            <Badge variant="secondary">
              {form.saved!.status === "pending" ? "等待审核" : "报名已提交"}
            </Badge>
            <Button asChild>
              <Link to={`/contests/${contest.id}`}>返回比赛</Link>
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={
                send.isPending ||
                (contest.groups.length > 0 &&
                  !contest.groups.some(
                    (g) => g.id === selection.group && g.joinable !== false,
                  ))
              }
            >
              <Send />
              {send.isPending ? "提交中" : "确认报名"}
            </Button>
            <span
              className={`text-xs ${stored === false ? "text-destructive" : "text-muted-foreground"}`}
            >
              {stored === false
                ? "浏览器未能保存草稿，请勿刷新"
                : "填写内容自动保存，提交后供赛事审核使用"}
            </span>
          </>
        )}
      </div>
    </form>
  );
}
