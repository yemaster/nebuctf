import { ContentImport } from "./admin/ContentImport";
import { ContestManagement } from "./ContestManagement";
import { useEffect } from "react";
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
  Timer,
  Mail,
  Waypoints,
} from "lucide-react";
import { useUser } from "@/App";
import { cn } from "@/lib/utils";
import { StatusPage } from "@/components/status-page";
import { PageTitle } from "@/components/shared";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
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
import { ChallengeAdmin, ChallengeEditor } from "./admin/Challenges";
import { ImagesAdmin } from "./admin/Images";
import { ContestAdmin, ContestEditor } from "./admin/Contests";
import {
  AnnouncementAdmin,
  AnnouncementEditor,
  ResourceAdmin,
  UserAdmin,
  LogAdmin,
} from "./admin/Operations";
import { ProblemSetAdmin, ProblemSetEditor } from "./ProblemSets";
import {
  ArticleAdmin,
  ArticleEditor,
  TreeAdmin,
  TreeEditor,
} from "./LearningAdmin";
import { AdminOverview } from "./admin/Overview";
import { SystemSettings } from "./admin/SystemSettings";
import { AIRoutesAdmin, AIRouteEditor } from "./admin/AIRoutes";
const groups = [
  {
    title: "基础",
    items: [
      { path: "overview", title: "概览", icon: LayoutDashboard },
      { path: "settings", title: "系统配置", icon: Settings },
      { path: "containers", title: "容器策略", icon: Timer },
      { path: "mail", title: "邮件策略", icon: Mail },
      { path: "ai", title: "AI 转发", icon: Waypoints },
    ],
  },
  {
    title: "内容",
    items: [
      { path: "challenges", title: "题目", icon: Flag },
      { path: "problemsets", title: "题单", icon: Library },
      { path: "articles", title: "文档", icon: FileText },
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
      { path: "images", title: "Docker 镜像", icon: Layers },
      { path: "users", title: "用户", icon: Users },
      { path: "submissions", title: "提交", icon: ListChecks },
      { path: "audit", title: "审计", icon: ShieldCheck },
    ],
  },
];
export function Admin() {
  const user = useUser();
  if (user?.role !== "admin") return <StatusPage status={user ? 403 : 401} />;
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
        <SidebarHeader className="p-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg">
                <Link to="/admin/overview">
                  <ShieldCheck />
                  <span className="font-semibold">管理中心</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="管理导航">
            {groups.map((group) => (
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
                  <Link to="/admin/overview">管理中心</Link>
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
            <Routes>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<AdminOverview />} />
              <Route
                path="settings"
                element={<SystemSettings section="site" />}
              />
              <Route
                path="containers"
                element={<SystemSettings section="containers" />}
              />
              <Route path="mail" element={<SystemSettings section="mail" />} />
              <Route path="ai" element={<AIRoutesAdmin />} />
              <Route path="ai/new" element={<AIRouteEditor />} />
              <Route path="ai/:id/edit" element={<AIRouteEditor />} />
              <Route path="challenges" element={<ChallengeAdmin />} />
              <Route path="images" element={<ImagesAdmin />} />
              <Route
                path="challenges/import"
                element={<ContentImport kind="challenge" />}
              />
              <Route path="challenges/new" element={<ChallengeEditor />} />
              <Route path="challenges/:id/edit" element={<ChallengeEditor />} />
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
              <Route path="problemsets/new" element={<ProblemSetEditor />} />
              <Route
                path="problemsets/:id/edit"
                element={<ProblemSetEditor />}
              />
              <Route path="articles" element={<ArticleAdmin />} />
              <Route path="articles/new" element={<ArticleEditor />} />
              <Route path="articles/:id/edit" element={<ArticleEditor />} />
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
          </div>
        </div>
      </div>
    </>
  );
}
