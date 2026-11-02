import { useEffect, lazy, Suspense, type CSSProperties } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  FileText,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useUser } from "@/App";
import { can } from "@/lib/access-control";
import { StatusPage, PageBoundary } from "@/components/status-page";
import { useMonitor } from "@/lib/contest-monitor";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { WriteupsAdmin, WriteupAdminDetail } from "./admin/Writeups";
import {
  Registrations,
  RegistrationDetail,
} from "./admin/ContestRegistrations";
import { MonitorList, IntegrityDetail } from "./admin/ContestMonitor";
import { Loading } from "@/components/shared";
import { PageLoadingBoundary } from "@/components/loading-transition";
const ContestEditor = lazy(() =>
  import("./admin/Contests").then((module) => ({
    default: module.ContestEditor,
  })),
);
const ContestTraffic = lazy(() =>
  import("./admin/Traffic").then((m) => ({ default: m.ContestTraffic })),
);
const TrafficDetail = lazy(() =>
  import("./admin/Traffic").then((m) => ({ default: m.TrafficDetail })),
);

const sections = [
  { path: "teams", label: "报名战队", icon: Users },
  { path: "activity", label: "比赛动态", icon: Activity },
  { path: "integrity", label: "作弊线索", icon: ShieldCheck },
  { path: "traffic", label: "流量监测", icon: Activity },
  { path: "writeups", label: "WriteUp 管理", icon: FileText },
  { path: "settings", label: "比赛设置", icon: Settings2 },
];
export function ContestManagement() {
  const user = useUser(),
    { id } = useParams(),
    location = useLocation();
  if (!can(user, "contests.read", id) && !can(user, "traffic.read", id))
    return <StatusPage status={403} />;
  if (location.pathname.startsWith("/admin/"))
    return (
      <Navigate
        replace
        to={location.pathname.slice(6) + location.search + location.hash}
      />
    );
  return (
    <SidebarProvider
      className="relative h-full min-h-0"
      style={{ "--sidebar-width": "12rem" } as CSSProperties}
    >
      <ManagementLayout />
    </SidebarProvider>
  );
}
function ManagementLayout() {
  const user = useUser();
  const { id } = useParams(),
    location = useLocation(),
    { setOpenMobile } = useSidebar();
  const live = useMonitor(id!, can(user, "contests.read", id)),
    base = `/contests/${id}/manage`;
  const visibleSections = sections.filter((s) =>
    can(user, s.path === "traffic" ? "traffic.read" : "contests.read", id),
  );
  const active = location.pathname.slice(base.length + 1).split("/")[0];
  useEffect(() => setOpenMobile(false), [location.pathname, setOpenMobile]);
  return (
    <>
      <Sidebar collapsible="icon" className="absolute h-full border-r-0">
        <SidebarHeader className="h-14 flex-row items-center gap-2 overflow-hidden px-2">
          <SidebarTrigger />
          <span className="whitespace-nowrap text-sm font-medium group-data-[collapsible=icon]:hidden">
            比赛管理
          </span>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <nav aria-label="比赛管理导航">
            <SidebarMenu>
              {visibleSections.map(({ path, label, icon: Icon }) => (
                <SidebarMenuItem key={path}>
                  <SidebarMenuButton
                    asChild
                    isActive={active === path}
                    tooltip={label}
                    className="h-10"
                  >
                    <Link
                      to={`${base}/${path}${path === "settings" && active !== "settings" ? `?return=${encodeURIComponent(location.pathname + location.search)}` : ""}`}
                      aria-current={active === path ? "page" : undefined}
                    >
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="返回比赛">
                <Link
                  to={
                    can(user, "contests.read", id)
                      ? `/contests/${id}`
                      : "/admin/traffic"
                  }
                >
                  <ArrowLeft />
                  <span>
                    {can(user, "contests.read", id)
                      ? "返回比赛"
                      : "返回流量监测"}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium">
            {sections.find((s) => s.path === active)?.label ?? "比赛管理"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px] space-y-6">
            <PageBoundary>
              <PageLoadingBoundary key={location.pathname}>
                <Suspense fallback={<Loading fullPage />}>
                  <Routes>
                    <Route
                      index
                      element={
                        <Navigate
                          replace
                          to={visibleSections[0]?.path ?? "teams"}
                        />
                      }
                    />
                    <Route path="traffic" element={<ContestTraffic />} />
                    <Route
                      path="traffic/:instance"
                      element={<TrafficDetail />}
                    />
                    <Route path="writeups" element={<WriteupsAdmin />} />
                    <Route
                      path="writeups/:team"
                      element={<WriteupAdminDetail />}
                    />
                    <Route path="teams" element={<Registrations />} />
                    <Route
                      path="teams/:team"
                      element={<RegistrationDetail />}
                    />
                    <Route
                      path="activity"
                      element={<MonitorList live={live} />}
                    />
                    <Route
                      path="integrity"
                      element={<MonitorList integrity live={live} />}
                    />
                    <Route
                      path="integrity/:event"
                      element={<IntegrityDetail />}
                    />
                    <Route path="settings" element={<ContestEditor />} />
                    <Route path="*" element={<StatusPage status={404} />} />
                  </Routes>
                </Suspense>
              </PageLoadingBoundary>
            </PageBoundary>
          </div>
        </div>
      </div>
    </>
  );
}
