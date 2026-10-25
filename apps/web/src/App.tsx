const WriteupPage = lazy(() =>
  import("./pages/Writeup").then((m) => ({ default: m.WriteupPage })),
);
const ContestManagement = lazy(() =>
  import("./pages/ContestManagement").then((m) => ({
    default: m.ContestManagement,
  })),
);
import { ContestActivity } from "./components/contest-activity";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import { createContext, useContext, lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { api, useAction, useAPI, client } from "./lib/api";
import { routeTransition } from "./lib/route-transition";
import type { User } from "./lib/types";
import {
  CardTransitionProvider,
  loadContestPages,
  useCardTransition,
} from "./components/card-transition";
import { ThemeProvider, ThemedToaster } from "./components/theme-provider";
import { SiteHeader } from "./components/site-shell";
import { SiteFooter } from "./components/site-footer";

import { Challenges } from "./pages/Challenges";
import { Announcements } from "./pages/Announcements";
const Home = lazy(() =>
  import("./pages/Home").then((m) => ({ default: m.Home })),
);
const Contests = lazy(() =>
  loadContestPages().then((m) => ({ default: m.Contests })),
);
const ContestDetail = lazy(() =>
  loadContestPages().then((m) => ({ default: m.ContestDetail })),
);
const ContestArena = lazy(() =>
  loadContestPages().then((m) => ({ default: m.ContestArena })),
);
const ContestBoard = lazy(() =>
  loadContestPages().then((m) => ({ default: m.ContestBoard })),
);
const ContestAnnouncements = lazy(() =>
  loadContestPages().then((m) => ({ default: m.ContestAnnouncements })),
);
const ContestResources = lazy(() =>
  loadContestPages().then((m) => ({ default: m.ContestResources })),
);
const Scoreboard = lazy(() =>
  loadContestPages().then((m) => ({ default: m.Scoreboard })),
);
import { Auth, Account } from "./pages/Auth";
import { TeamPage, TeamJoin } from "./pages/Team";
import { Instances } from "./pages/Instances";
const ProblemSets = lazy(() =>
  import("./pages/ProblemSets").then((m) => ({ default: m.ProblemSets })),
);
const ProblemSetDetail = lazy(() =>
  import("./pages/ProblemSets").then((m) => ({ default: m.ProblemSetDetail })),
);
const Admin = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Admin })),
);
const Library = lazy(() =>
  import("./pages/Learning").then((m) => ({ default: m.Library })),
);
const ArticlePage = lazy(() =>
  import("./pages/Learning").then((m) => ({ default: m.ArticlePage })),
);
const Learning = lazy(() =>
  import("./pages/Learning").then((m) => ({ default: m.Learning })),
);
const LearningDetail = lazy(() =>
  import("./pages/Learning").then((m) => ({ default: m.LearningDetail })),
);
import { Loading } from "./components/shared";
import { TransitionSurface } from "./components/transition-surface";
import { PageBoundary, StatusPage } from "./components/status-page";
const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);
export function App() {
  return (
    <ThemeProvider>
      <CardTransitionProvider>
        <AppShell />
      </CardTransitionProvider>
    </ThemeProvider>
  );
}
function AppShell() {
  const cardTransition = useCardTransition();
  const { data } = useAPI<{ user: User | null }>("/me");
  const user = data?.user ?? null;
  const location = useLocation();
  const reduced = useReducedMotion();
  const contestId = location.pathname.match(
    /^\/contests\/([^/]+)(?:\/|$)/,
  )?.[1];
  const workbench =
    location.pathname === "/challenges" ||
    /^\/contests\/[^/]+\/challenges$/.test(location.pathname);
  const adminPage =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const authPage = ["/login", "/register"].includes(location.pathname);
  const expanding = cardTransition.native && !cardTransition.pending;
  const transition = routeTransition(location.pathname);
  const instant = reduced || cardTransition.native || transition.duration === 0;
  const logout = useAction(
    () => api("/auth/logout", "POST"),
    () => {
      void client.resetQueries();
    },
  );
  return (
    <UserContext.Provider value={user}>
      <LazyMotion features={domAnimation} strict>
        <div className="flex h-dvh flex-col overflow-hidden">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-card focus:p-4"
          >
            跳转到内容
          </a>
          <SiteHeader
            contestId={contestId}
            user={user}
            onLogout={() => logout.mutate()}
            loggingOut={logout.isPending}
          />
          <main id="main" className="relative min-h-0 flex-1 overflow-hidden">
            <AnimatePresence
              mode={cardTransition.native ? "sync" : "wait"}
              initial={false}
              custom={instant}
            >
              <m.div
                key={
                  adminPage ? "admin" : authPage ? "auth" : location.pathname
                }
                initial={instant ? false : { opacity: 0, y: transition.y }}
                animate={{ opacity: 1, y: 0 }}
                variants={{
                  exit: (skip: boolean) => ({
                    opacity: skip ? 1 : 0,
                    transition: { duration: skip ? 0 : 0.07 },
                  }),
                }}
                exit="exit"
                transition={{
                  duration: instant ? 0 : transition.duration,
                  ease: "easeOut",
                }}
                className={`h-full min-h-0 bg-background ${adminPage ? "overflow-hidden" : workbench || authPage ? "overflow-y-auto lg:overflow-hidden" : "overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-8"}`}
              >
                <m.div
                  initial={false}
                  animate={{
                    opacity: expanding ? 0 : 1,
                    y: expanding ? 10 : 0,
                  }}
                  transition={{
                    duration: expanding || reduced ? 0 : 0.36,
                    ease: "easeOut",
                  }}
                  inert={expanding || undefined}
                  aria-hidden={expanding || undefined}
                  style={{ visibility: expanding ? "hidden" : undefined }}
                  data-card-content={expanding ? "waiting" : "visible"}
                  className={
                    workbench || authPage || adminPage
                      ? "h-full min-h-0"
                      : "mx-auto min-h-full w-full max-w-[1600px]"
                  }
                >
                  <PageBoundary>
                    <Suspense fallback={<Loading fullPage />}>
                      <Routes location={location}>
                        <Route path="/" element={<Home />} />
                        <Route path="/challenges" element={<Challenges />} />
                        <Route path="/problemsets" element={<ProblemSets />} />
                        <Route
                          path="/problemsets/:id"
                          element={<ProblemSetDetail />}
                        />
                        <Route
                          path="/announcements"
                          element={<Announcements />}
                        />
                        <Route path="/contests" element={<Contests />} />
                        <Route
                          path="/contests/:id/challenges"
                          element={<ContestArena />}
                        />
                        <Route
                          path="/contests/:id/scoreboard"
                          element={<ContestBoard />}
                        />
                        <Route
                          path="/contests/:id/announcements"
                          element={<ContestAnnouncements />}
                        />
                        <Route
                          path="/contests/:id/instances"
                          element={<ContestResources />}
                        />
                        <Route
                          path="/contests/:id"
                          element={<ContestDetail />}
                        />
                        <Route path="/scoreboard" element={<Scoreboard />} />
                        <Route path="/library" element={<Library />} />
                        <Route
                          path="/library/:slug"
                          element={<ArticlePage />}
                        />
                        <Route path="/learning" element={<Learning />} />
                        <Route
                          path="/learning/:id"
                          element={<LearningDetail />}
                        />
                        <Route path="/team" element={<TeamPage />} />
                        <Route path="/team/new" element={<TeamJoin />} />
                        <Route path="/instances" element={<Instances />} />
                        <Route
                          path="/contests/:id/manage/*"
                          element={<ContestManagement />}
                        />
                        <Route
                          path="/contests/:id/writeup"
                          element={<WriteupPage />}
                        />
                        <Route path="/admin/*" element={<Admin />} />
                        <Route path="/login" element={<Auth />} />
                        <Route path="/register" element={<Auth register />} />
                        <Route path="/account" element={<Account />} />
                        <Route path="*" element={<StatusPage status={404} />} />
                      </Routes>
                    </Suspense>
                  </PageBoundary>
                </m.div>
              </m.div>
            </AnimatePresence>
            <AnimatePresence>
              {expanding && (
                <TransitionSurface
                  key={cardTransition.selected}
                  card={cardTransition.selected ?? undefined}
                  loading={cardTransition.loading}
                />
              )}
            </AnimatePresence>
          </main>
          <SiteFooter contestId={contestId} user={user} />
          {contestId && (
            <ContestActivity
              scope={contestId}
              user={user}
              hidden={cardTransition.native}
            />
          )}
          <ThemedToaster />
        </div>
      </LazyMotion>
    </UserContext.Provider>
  );
}
