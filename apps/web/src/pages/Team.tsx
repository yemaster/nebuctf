import { UserAvatar } from "@/components/user-avatar";
import { useEffect, useState } from "react";
import { Captcha } from "@/components/captcha";
import { useCaptcha } from "@/lib/use-captcha";
import {
  Link,
  useSearchParams,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Copy, Plus, ArrowLeft, ArrowRight, Users } from "lucide-react";
import { toast } from "sonner";
import { safeLocalPath } from "@/lib/utils";
import { useUser } from "@/App";
import { api, useAction, useAPI } from "@/lib/api";
import type { Team, TeamSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { ActionError } from "@/components/action-error";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field, PageTitle, LoginPrompt, QueryState } from "@/components/shared";
function TeamDetail() {
  const user = useUser(),
    [params, setParams] = useSearchParams(),
    selected = params.get("team") ?? "";
  const next = safeLocalPath(params.get("next"), "");
  const chooseTeam = (id?: string) =>
    setParams({ ...(id ? { team: id } : {}), ...(next ? { next } : {}) });
  const data = useAPI<{ team: Team | null }>(
      `/team${selected ? `?team=${selected}` : ""}`,
      !!user,
    ),
    team = data.data?.team;
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.invite)
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      });
  }, [location, navigate]);
  const [invite, setInvite] = useState<{ team: string; code: string } | null>(
      location.state?.invite ?? null,
    ),
    [confirm, setConfirm] = useState<{
      action: "invite" | "leave" | "transfer";
      user?: string;
      name?: string;
    } | null>(null);
  const manage = useAction(async () => {
    if (!team || !confirm) return;
    if (confirm.action === "invite") {
      const r = await api<{ invite: string }>("/team/invite", "POST", {
        team_id: team.id,
      });
      setInvite({ team: team.id, code: r.invite });
    }
    if (confirm.action === "leave") {
      await api("/team/leave", "POST", { team_id: team.id });
      chooseTeam();
      setInvite(null);
    }
    if (confirm.action === "transfer")
      await api("/team/captain", "POST", {
        team_id: team.id,
        user_id: confirm.user,
      });
    setConfirm(null);
  });
  if (!user) return <LoginPrompt />;
  if (data.error || data.isLoading)
    return (
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
    );
  return (
    <>
      {next && (
        <Button variant="ghost" className="mb-4" asChild>
          <Link to={next}>
            <ArrowLeft />
            返回比赛
          </Link>
        </Button>
      )}
      <Button variant="ghost" className="mb-4" asChild>
        <Link to={teamPath(undefined, next)}>
          <ArrowLeft />
          全部战队
        </Link>
      </Button>
      <PageTitle>我的战队</PageTitle>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
        fullPage
      />
      {team ? (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg bg-card p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">{team.name}</h2>
              <span className="text-sm text-muted-foreground">
                {team.members.length} 位成员
              </span>
            </div>
            {team.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-4">
                <UserAvatar name={m.username} avatarId={m.avatar_id} />
                <span>{m.username}</span>
                {team.captain_id === m.id && <Badge>队长</Badge>}
                {team.captain_id === user.id && m.id !== user.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() =>
                      setConfirm({
                        action: "transfer",
                        user: m.id,
                        name: m.username,
                      })
                    }
                  >
                    转让队长
                  </Button>
                )}
              </div>
            ))}
          </section>
          <section className="h-fit space-y-6 rounded-lg bg-card p-6">
            <h2 className="font-medium">战队管理</h2>
            {team.captain_id === user.id ? (
              <Button
                variant="secondary"
                onClick={() => setConfirm({ action: "invite" })}
              >
                更新邀请码
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirm({ action: "leave" })}
              >
                退出战队
              </Button>
            )}
            {invite?.team === team.id && (
              <div className="space-y-3">
                <p className="break-all text-sm">{invite.code}</p>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(invite.code)
                      .then(() => toast.success("邀请码已复制"))
                      .catch(() => toast.error("复制失败，请手动复制"))
                  }
                >
                  <Copy />
                  复制邀请码
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : null}
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {confirm?.action === "invite"
              ? "更新战队邀请码"
              : confirm?.action === "leave"
                ? "退出战队"
                : `将队长转让给 ${confirm?.name ?? ""}`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {confirm?.action === "invite"
              ? "原邀请码将立即失效。"
              : confirm?.action === "leave"
                ? "已报名的比赛结束前无法退出。"
                : "转让后将失去该战队的报名和邀请码管理权限。"}
          </p>
          <Button disabled={manage.isPending} onClick={() => manage.mutate()}>
            确认
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function teamPath(id?: string, next = "") {
  const params = new URLSearchParams({
    ...(id ? { team: id } : {}),
    ...(next ? { next } : {}),
  });
  return `/team${params.size ? `?${params}` : ""}`;
}

export function TeamPage() {
  const [params] = useSearchParams();
  return params.get("team") ? (
    <TeamDetail key={params.get("team")} />
  ) : (
    <TeamList />
  );
}
function TeamList() {
  const user = useUser();
  const [params] = useSearchParams();
  const next = safeLocalPath(params.get("next"), "");
  const mine = useAPI<{ items: TeamSummary[] }>("/teams/mine", !!user);
  const createPath = `/team/new${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  if (!user) return <LoginPrompt />;
  if (mine.error || mine.isLoading)
    return (
      <QueryState
        loading={mine.isLoading}
        error={mine.error}
        retry={() => void mine.refetch()}
        fullPage
      />
    );
  return (
    <>
      {next && (
        <Button variant="ghost" className="mb-4" asChild>
          <Link to={next}>
            <ArrowLeft />
            返回比赛
          </Link>
        </Button>
      )}
      <PageTitle
        action={
          <Button asChild>
            <Link to={createPath}>
              <Plus />
              创建 / 加入
            </Link>
          </Button>
        }
      >
        我的战队
      </PageTitle>
      <QueryState
        loading={mine.isLoading}
        error={mine.error}
        retry={() => void mine.refetch()}
        fullPage
      />
      {mine.data &&
        !mine.error &&
        (mine.data.items.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {mine.data.items.map((team) => (
              <Link
                key={team.id}
                to={teamPath(team.id, next)}
                className="group flex min-w-0 items-center gap-5 rounded-xl bg-card p-6 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:p-8"
              >
                <div className="min-w-0 flex-1 space-y-3">
                  <h2 className="truncate text-xl font-semibold">
                    {team.name}
                  </h2>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{team.members} 位成员</span>
                    <Badge variant="secondary">
                      {team.captain_id === user.id ? "队长" : "成员"}
                    </Badge>
                  </div>
                </div>
                <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        ) : (
          <Empty className="min-h-[55dvh] bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>还没有战队</EmptyTitle>
              <EmptyDescription>创建战队，或使用邀请码加入。</EmptyDescription>
            </EmptyHeader>
            <Button asChild>
              <Link to={createPath}>创建 / 加入战队</Link>
            </Button>
          </Empty>
        ))}
    </>
  );
}

export function TeamJoin() {
  const user = useUser();
  const createVerification = useCaptcha("team-create");
  const joinVerification = useCaptcha("team-join");
  const [params] = useSearchParams();
  const next = safeLocalPath(params.get("next"), "");
  const navigate = useNavigate();
  const create = useAction(
    async (name: string) => {
      const result = await api<{ id: string; invite: string }>(
        "/teams",
        "POST",
        { name, captcha: createVerification.proof },
      ).finally(createVerification.reset);
      navigate(teamPath(result.id, next), {
        replace: true,
        state: { invite: { team: result.id, code: result.invite } },
      });
    },
    undefined,
    false,
  );
  const join = useAction(
    async (invite: string) => {
      const result = await api<{ id: string }>("/team/join", "POST", {
        invite,
        captcha: joinVerification.proof,
      }).finally(joinVerification.reset);
      navigate(teamPath(result.id, next), { replace: true });
    },
    undefined,
    false,
  );
  if (!user) return <LoginPrompt />;
  return (
    <>
      <Button variant="ghost" asChild>
        <Link to={teamPath(undefined, next)}>
          <ArrowLeft />
          我的战队
        </Link>
      </Button>
      <div className="flex min-h-[65dvh] items-center justify-center py-8">
        <div className="grid w-full max-w-5xl gap-10 rounded-xl bg-card p-6 sm:p-10 md:grid-cols-[1fr_auto_1fr] md:gap-12 lg:p-14">
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!createVerification.proof || create.isPending) return;
              create.mutate(String(new FormData(e.currentTarget).get("name")));
            }}
          >
            <h1 className="text-2xl font-semibold">创建战队</h1>
            <Field label="战队名称">
              <Input
                name="name"
                minLength={2}
                maxLength={48}
                required
                disabled={create.isPending}
              />
            </Field>
            <Captcha
              verification={createVerification}
              disabled={create.isPending}
            />
            <Button
              className="w-full"
              disabled={create.isPending || !createVerification.proof}
            >
              {create.isPending ? "创建中" : "创建战队"}
            </Button>
            {create.error && <ActionError error={create.error} />}
          </form>
          <div className="relative flex items-center justify-center">
            <Separator className="md:h-full md:w-px" />
            <span className="absolute bg-card px-3 py-3 text-xs text-muted-foreground">
              OR
            </span>
          </div>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!joinVerification.proof || join.isPending) return;
              join.mutate(String(new FormData(e.currentTarget).get("invite")));
            }}
          >
            <h2 className="text-2xl font-semibold">加入战队</h2>
            <Field label="邀请码">
              <Input
                name="invite"
                minLength={20}
                maxLength={100}
                required
                autoComplete="off"
                disabled={join.isPending}
              />
            </Field>
            <Captcha
              verification={joinVerification}
              disabled={join.isPending}
            />
            <Button
              variant="secondary"
              className="w-full"
              disabled={join.isPending || !joinVerification.proof}
            >
              {join.isPending ? "加入中" : "加入战队"}
            </Button>
            {join.error && <ActionError error={join.error} />}
          </form>
        </div>
      </div>
    </>
  );
}
