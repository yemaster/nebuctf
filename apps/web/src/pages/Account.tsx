import { AccountAvatar } from "@/components/account-avatar";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CodeXml, History, KeyRound, UserRound, Loader2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, useAPI } from "@/lib/api";
import type { User } from "@/lib/types";
import { AccountProfile, type Profile } from "@/components/account-profile";
import { AccountSecurity } from "@/components/account-security";
import { AccountApiKeys } from "@/components/account-api-keys";
import {
  AccountSubmissions,
  type AccountSubmissionsData,
} from "@/components/account-submissions";
import { PageTitle, LoginPrompt, QueryState } from "@/components/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLoadingState } from "@/components/loading-transition";

const sections = [
  { value: "profile", label: "账户资料", icon: UserRound },
  { value: "security", label: "账户安全", icon: KeyRound },
  { value: "api-keys", label: "API KEY", icon: CodeXml },
  { value: "submissions", label: "提交记录", icon: History },
] as const;

export function Account() {
  const identity = useAPI<{ user: User | null }>("/me");
  const user = identity.data?.user ?? null;
  const [params, setParams] = useSearchParams();
  const section =
    sections.find((s) => s.value === params.get("section"))?.value ?? "profile";
  const requestedPage = Number(params.get("page") ?? 1);
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= 10000
      ? requestedPage
      : 1;
  const query = (params.get("q") ?? "").slice(0, 100);
  const result = ["correct", "incorrect"].includes(params.get("result") ?? "")
    ? params.get("result")!
    : "all";
  const profile = useAPI<Profile>(
    "/account/profile",
    !!user && section === "profile",
  );
  const submissionsPath = `/submissions?page=${page}&page_size=10&q=${encodeURIComponent(query)}&result=${result}`;
  const submissions = useQuery({
    queryKey: [submissionsPath],
    queryFn: ({ signal }) =>
      api<AccountSubmissionsData>(submissionsPath, "GET", undefined, signal),
    enabled: !!user && section === "submissions",
    placeholderData: keepPreviousData,
  });
  const active = !identity.data
    ? identity
    : !user
      ? null
      : section === "profile"
        ? profile
        : section === "submissions"
          ? submissions
          : null;
  useLoadingState(!!active?.isLoading);
  const update = (values: Record<string, string>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (
          !value ||
          (key === "result" && value === "all") ||
          (key === "page" && value === "1")
        )
          next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  return (
    <>
      {active?.error && (
        <QueryState
          fullPage
          loading={false}
          error={active.error}
          retry={() => void active.refetch()}
        />
      )}
      {identity.data && !user && <LoginPrompt />}
      {user && (
        <div key={user.id} hidden={!!active?.error}>
          <PageTitle>我的账户</PageTitle>
          <Tabs
            orientation="vertical"
            activationMode="manual"
            value={section}
            onValueChange={(value) => update({ section: value })}
            className="flex-col gap-6 md:flex-row md:items-start md:gap-8"
          >
            <TabsList
              variant="line"
              aria-label="账户设置"
              className="w-full shrink-0 items-stretch gap-1 p-0 md:w-48"
            >
              {sections.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-11 flex-none justify-start gap-3 px-3 text-sm"
                >
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Card className="min-w-0 flex-1 gap-0 border-0 p-6 lg:p-7">
              <TabsContent
                value="profile"
                forceMount
                hidden={section !== "profile"}
                className="min-w-0 space-y-6 data-[state=inactive]:hidden"
              >
                <h2 className="text-lg font-semibold">账户资料</h2>
                <AccountAvatar user={user} />
                <dl className="flex flex-wrap gap-x-12 gap-y-4 text-sm">
                  <div className="min-w-0 space-y-2">
                    <dt className="text-muted-foreground">用户名</dt>
                    <dd className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="break-all">{user.username}</span>
                      {user.role === "admin" && (
                        <Badge variant="secondary">管理员</Badge>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <dt className="text-muted-foreground">邮箱</dt>
                    <dd className="break-all font-medium">{user.email}</dd>
                  </div>
                </dl>
                <Separator />
                {profile.data && <AccountProfile profile={profile.data} />}
              </TabsContent>
              <TabsContent
                value="security"
                forceMount
                hidden={section !== "security"}
                className="min-w-0 space-y-6 data-[state=inactive]:hidden"
              >
                <h2 className="text-lg font-semibold">账户安全</h2>
                <AccountSecurity />
              </TabsContent>
              <TabsContent value="api-keys" className="min-w-0 space-y-6">
                {section === "api-keys" && <AccountApiKeys />}
              </TabsContent>
              <TabsContent
                value="submissions"
                forceMount
                hidden={section !== "submissions"}
                className="min-w-0 space-y-5 data-[state=inactive]:hidden"
              >
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-semibold">提交记录</h2>
                  {submissions.isFetching && !submissions.isLoading && (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 motion-safe:animate-spin text-muted-foreground"
                    />
                  )}
                  {submissions.data && (
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {submissions.data.total} 条
                    </span>
                  )}
                </div>
                {submissions.isFetching && !submissions.isLoading && (
                  <span role="status" className="sr-only">
                    正在更新提交记录
                  </span>
                )}
                <AccountSubmissions
                  data={submissions.data}
                  page={page}
                  query={query}
                  result={result}
                  update={update}
                  pending={submissions.isFetching}
                />
              </TabsContent>
            </Card>
          </Tabs>
        </div>
      )}
    </>
  );
}
