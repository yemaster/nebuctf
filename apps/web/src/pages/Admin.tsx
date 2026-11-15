import { lazy, Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Routes,
  Route,
  NavLink,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";
import {
  Flag,
  ArrowLeft,
  Library,
  FileText,
  BookOpen,
  Network,
  Trophy,
  Megaphone,
  Box,
  Users,
  ListChecks,
  ShieldCheck,
  Layers,
  LayoutDashboard,
  Settings,
  KeyRound,
  Timer,
  Mail,
  Bell,
  Waypoints,
} from "lucide-react";
import { useUser } from "@/App";
import { isStaff, anyAccess, adminSection } from "@/lib/access-control";
import { cn } from "@/lib/utils";
import { StatusPage } from "@/components/status-page";
import { Loading, PageTitle } from "@/components/shared";
import { PageLoadingBoundary } from "@/components/loading-transition";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
const WelcomeMessage = lazy(() =>
  import("./admin/WelcomeMessage").then((m) => ({ default: m.WelcomeMessage })),
);
const Roles = lazy(() =>
  import("./admin/Roles").then((m) => ({ default: m.Roles })),
);
const TrafficOverview = lazy(() =>
  import("./admin/Traffic").then((m) => ({ default: m.TrafficOverview })),
);
const RoleEditor = lazy(() =>
  import("./admin/Roles").then((m) => ({ default: m.RoleEditor })),
);
const UserAccessEditor = lazy(() =>
  import("./admin/Roles").then((m) => ({ default: m.UserAccessEditor })),
);

const ContentImport = lazy(() =>
  import("./admin/ContentImport").then((m) => ({ default: m.ContentImport })),
);
const ContestManagement = lazy(() =>
  import("./ContestManagement").then((m) => ({ default: m.ContestManagement })),
);
const ChallengeAdmin = lazy(() =>
  import("./admin/Challenges").then((m) => ({ default: m.ChallengeAdmin })),
);
const ChallengeEditor = lazy(() =>
  import("./admin/Challenges").then((m) => ({ default: m.ChallengeEditor })),
);
const ImagesAdmin = lazy(() =>
  import("./admin/Images").then((m) => ({ default: m.ImagesAdmin })),
);
const ContestAdmin = lazy(() =>
  import("./admin/Contests").then((m) => ({ default: m.ContestAdmin })),
);
const ContestEditor = lazy(() =>
  import("./admin/Contests").then((m) => ({ default: m.ContestEditor })),
);
const AnnouncementAdmin = lazy(() =>
  import("./admin/Operations").then((m) => ({ default: m.AnnouncementAdmin })),
);
const AnnouncementEditor = lazy(() =>
  import("./admin/Operations").then((m) => ({ default: m.AnnouncementEditor })),
);
const ResourceAdmin = lazy(() =>
  import("./admin/Operations").then((m) => ({ default: m.ResourceAdmin })),
);
const UserAdmin = lazy(() =>
  import("./admin/Operations").then((m) => ({ default: m.UserAdmin })),
);
const LogAdmin = lazy(() =>
  import("./admin/Operations").then((m) => ({ default: m.LogAdmin })),
);
const ProblemSetAdmin = lazy(() =>
  import("./ProblemSets").then((m) => ({ default: m.ProblemSetAdmin })),
);
const ProblemSetEditor = lazy(() =>
  import("./ProblemSets").then((m) => ({ default: m.ProblemSetEditor })),
);
const ArticleAdmin = lazy(() =>
  import("./LearningAdmin").then((m) => ({ default: m.ArticleAdmin })),
);
const ArticleEditor = lazy(() =>
  import("./LearningAdmin").then((m) => ({ default: m.ArticleEditor })),
);
const HelpAdmin = lazy(() =>
  import("./admin/Help").then((m) => ({ default: m.HelpAdmin })),
);
const HelpEditor = lazy(() =>
  import("./admin/Help").then((m) => ({ default: m.HelpEditor })),
);
const TreeAdmin = lazy(() =>
  import("./LearningAdmin").then((m) => ({ default: m.TreeAdmin })),
);
const TreeEditor = lazy(() =>
  import("./LearningAdmin").then((m) => ({ default: m.TreeEditor })),
);
const AdminOverview = lazy(() =>
  import("./admin/Overview").then((m) => ({ default: m.AdminOverview })),
);
const SystemSettings = lazy(() =>
  import("./admin/SystemSettings").then((m) => ({ default: m.SystemSettings })),
);
const ApiKeysAdmin = lazy(() =>
  import("./admin/ApiKeys").then((m) => ({ default: m.ApiKeysAdmin })),
);
const AIRoutesAdmin = lazy(() =>
  import("./admin/AIRoutes").then((m) => ({ default: m.AIRoutesAdmin })),
);
const AIRouteEditor = lazy(() =>
  import("./admin/AIRoutes").then((m) => ({ default: m.AIRouteEditor })),
);
const MessagesAdmin = lazy(() =>
  import("./admin/Messages").then((m) => ({ default: m.MessagesAdmin })),
);
const MessageComposer = lazy(() =>
  import("./admin/Messages").then((m) => ({ default: m.MessageComposer })),
);
const groups = [
  {
    title: "基础",
    items: [
      { path: "overview", title: "概览", icon: LayoutDashboard },
      { path: "settings", title: "系统配置", icon: Settings },
      { path: "api-keys", title: "API KEY", icon: KeyRound },
      { path: "containers", title: "容器策略", icon: Timer },
      { path: "mail", title: "邮件策略", icon: Mail },
      { path: "messages", title: "系统消息", icon: Bell },
      { path: "ai", title: "AI 转发", icon: Waypoints },
    ],
  },
  {
    title: "内容",
    items: [
      { path: "challenges", title: "题目", icon: Flag },
      { path: "problemsets", title: "题单", icon: Library },
      { path: "articles", title: "文档", icon: FileText },
      { path: "help", title: "帮助文档", icon: BookOpen },
      { path: "learning", title: "技能树", icon: Network },
    ],
  },
  {
    title: "赛事",
    items: [
      { path: "contests", title: "比赛", icon: Trophy },
      { path: "announcements", title: "公告", icon: Megaphone },
    ],
  },
  {
    title: "运维",
    items: [
      { path: "resources", title: "资源", icon: Box },
      { path: "traffic", title: "流量监测", icon: Network },
      { path: "images", title: "Docker 镜像", icon: Layers },
      { path: "users", title: "用户", icon: Users },
      { path: "roles", title: "角色与权限", icon: ShieldCheck },
      { path: "submissions", title: "提交", icon: ListChecks },
      { path: "audit", title: "审计", icon: ShieldCheck },
    ],
  },
];
export function Admin() {
  const user = useUser();
  if (!isStaff(user)) return <StatusPage status={user ? 403 : 401} />;
  return (
    <SidebarProvider
      className="relative h-full min-h-0"
      style={{ "--sidebar-width": "14rem" } as React.CSSProperties}
    >
      <AdminLayout />
    </SidebarProvider>
  );
}
function AdminLayout() {
  const user = useUser();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.path === "roles"
          ? user?.role === "admin"
          : anyAccess(user, `${adminSection(item.path)}.read`),
      ),
    }))
    .filter((group) => group.items.length);
  const location = useLocation(),
    { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [location.pathname, setOpenMobile]);
  const segment = location.pathname.split("/")[2];
  const contestId = location.pathname.match(
    /^\/admin\/contests\/([^/]+)\/(?:edit|manage)(?:\/|$)/,
  )?.[1];
  const section = groups
    .flatMap((g) => g.items)
    .find((item) => item.path === segment);
  const editing = location.pathname.endsWith("/edit"),
    creating = location.pathname.endsWith("/new"),
    importing = location.pathname.endsWith("/import");
  return (
    <>
      <Sidebar collapsible="icon" className="absolute h-full">
        <SidebarContent>
          <nav aria-label="管理导航">
            {visibleGroups.map((group) => (
              <SidebarGroup key={group.title}>
                <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          asChild
                          isActive={section?.path === item.path}
                          tooltip={item.title}
                        >
                          <NavLink to={`/admin/${item.path}`}>
                            <item.icon />
                            <span>{item.title}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </nav>
        </SidebarContent>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-3 bg-card px-4 sm:px-6">
          <SidebarTrigger />
          <Breadcrumb aria-label="管理路径">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/admin">管理中心</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {section && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {editing || creating ? (
                      <BreadcrumbLink asChild>
                        <Link to={`/admin/${section.path}`}>
                          {section.title}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{section.title}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </>
              )}
              {(editing || creating || importing) && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>
                      {importing ? "导入" : creating ? "新建" : "编辑"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {contestId && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="ml-auto shrink-0"
            >
              <Link to={`/contests/${contestId}`}>
                <ArrowLeft />
                返回比赛
              </Link>
            </Button>
          )}
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            editing || creating
              ? "px-4 pb-4 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8"
              : "p-4 sm:p-6 lg:p-8",
          )}
        >
          <div
            key={location.pathname}
            className="mx-auto w-full max-w-[1600px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
          >
            <PageLoadingBoundary>
              <Suspense fallback={<Loading fullPage />}>
                <Routes>
                  <Route
                    index
                    element={
                      <Navigate
                        to={visibleGroups[0]?.items[0]?.path ?? "overview"}
                        replace
                      />
                    }
                  />
                  <Route path="roles" element={<Roles />} />
                  <Route path="traffic" element={<TrafficOverview />} />
                  <Route path="roles/new" element={<RoleEditor />} />
                  <Route path="roles/:id/edit" element={<RoleEditor />} />
                  <Route
                    path="users/:id/access"
                    element={<UserAccessEditor />}
                  />
                  <Route path="overview" element={<AdminOverview />} />
                  <Route
                    path="settings"
                    element={<SystemSettings section="site" />}
                  />
                  <Route
                    path="containers"
                    element={<SystemSettings section="containers" />}
                  />
                  <Route
                    path="mail"
                    element={<SystemSettings section="mail" />}
                  />
                  <Route path="messages" element={<MessagesAdmin />} />
                  <Route path="messages/new" element={<MessageComposer />} />
                  <Route path="messages/welcome" element={<WelcomeMessage />} />
                  <Route path="ai" element={<AIRoutesAdmin />} />
                  <Route path="api-keys" element={<ApiKeysAdmin />} />
                  <Route path="ai/new" element={<AIRouteEditor />} />
                  <Route path="ai/:id/edit" element={<AIRouteEditor />} />
                  <Route path="challenges" element={<ChallengeAdmin />} />
                  <Route path="images" element={<ImagesAdmin />} />
                  <Route
                    path="challenges/import"
                    element={<ContentImport kind="challenge" />}
                  />
                  <Route path="challenges/new" element={<ChallengeEditor />} />
                  <Route
                    path="challenges/:id/edit"
                    element={<ChallengeEditor />}
                  />
                  <Route path="contests" element={<ContestAdmin />} />
                  <Route
                    path="contests/:id/manage/*"
                    element={<ContestManagement />}
                  />
                  <Route
                    path="contests/import"
                    element={<ContentImport kind="contest" />}
                  />
                  <Route path="contests/new" element={<ContestEditor />} />
                  <Route path="contests/:id/edit" element={<ContestEditor />} />
                  <Route path="problemsets" element={<ProblemSetAdmin />} />
                  <Route
                    path="problemsets/new"
                    element={<ProblemSetEditor />}
                  />
                  <Route
                    path="problemsets/:id/edit"
                    element={<ProblemSetEditor />}
                  />
                  <Route path="articles" element={<ArticleAdmin />} />
                  <Route path="articles/new" element={<ArticleEditor />} />
                  <Route path="articles/:id/edit" element={<ArticleEditor />} />
                  <Route path="help" element={<HelpAdmin />} />
                  <Route path="help/new" element={<HelpEditor />} />
                  <Route path="help/:id/edit" element={<HelpEditor />} />
                  <Route path="learning" element={<TreeAdmin />} />
                  <Route path="learning/new" element={<TreeEditor />} />
                  <Route path="learning/:id/edit" element={<TreeEditor />} />
                  <Route path="announcements" element={<AnnouncementAdmin />} />
                  <Route
                    path="announcements/new"
                    element={<AnnouncementEditor />}
                  />
                  <Route
                    path="announcements/:id/edit"
                    element={<AnnouncementEditor />}
                  />
                  <Route
                    path="resources"
                    element={
                      <>
                        <PageTitle>资源</PageTitle>
                        <ResourceAdmin />
                      </>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <>
                        <PageTitle>用户</PageTitle>
                        <UserAdmin />
                      </>
                    }
                  />
                  <Route path="submissions" element={<LogAdmin />} />
                  <Route path="audit" element={<LogAdmin audit />} />
                  <Route path="*" element={<StatusPage status={404} />} />
                </Routes>
              </Suspense>
            </PageLoadingBoundary>
          </div>
        </div>
      </div>
    </>
  );
}
