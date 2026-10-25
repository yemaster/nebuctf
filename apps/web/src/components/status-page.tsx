import { Component, type ReactNode } from "react";
import {
  ArrowLeft,
  Home,
  LayoutDashboard,
  LogIn,
  RotateCw,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "./ui/empty";

export function StatusPage({
  status = 404,
  message,
  retry,
  compact = false,
  action,
}: {
  status?: number;
  message?: string;
  retry?: () => void;
  compact?: boolean;
  action?: { label: string; href: string };
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const inContest = location.pathname.startsWith("/contests/");
  const fallback = inContest
    ? location.pathname.split("/").slice(0, 3).join("/")
    : "/";
  const goBack = () => {
    // Only traverse history created by this router; direct links stay on site.
    if (window.history.state?.idx > 0) void navigate(-1);
    else void navigate(fallback, { replace: true });
  };
  const title =
    status === 401
      ? "请先登录"
      : status === 403
        ? "暂无访问权限"
        : status === 404
          ? "没有找到这一页"
          : status === 429
            ? "请求过于频繁"
            : "暂时无法加载";
  return (
    <Empty
      role={status === 401 ? "status" : "alert"}
      className={compact ? "gap-5 py-10" : "min-h-[65dvh] gap-8 rounded-none"}
    >
      <EmptyHeader className="max-w-xl gap-5">
        <span
          aria-hidden="true"
          className={
            compact
              ? "text-5xl font-semibold text-muted-foreground"
              : "text-8xl font-semibold text-muted-foreground sm:text-9xl"
          }
        >
          {status || "离线"}
        </span>
        <EmptyTitle>
          <h1 className={compact ? "text-xl" : "text-3xl sm:text-4xl"}>
            {title}
          </h1>
        </EmptyTitle>
        {message && (
          <EmptyDescription className="max-w-lg break-words">
            {message}
          </EmptyDescription>
        )}
      </EmptyHeader>
      <EmptyContent className="max-w-lg flex-row flex-wrap justify-center gap-3">
        {action && (
          <Button variant="secondary" size={compact ? "sm" : "default"} asChild>
            <Link to={action.href}>{action.label}</Link>
          </Button>
        )}
        {status === 401 ? (
          <Button size="lg" asChild>
            <Link
              to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
            >
              <LogIn />
              登录
            </Link>
          </Button>
        ) : (
          retry && (
            <Button size="lg" onClick={retry}>
              <RotateCw />
              重试
            </Button>
          )
        )}
        <Button size="lg" variant="secondary" type="button" onClick={goBack}>
          <ArrowLeft />
          返回上一页
        </Button>
        <Button size="lg" variant="ghost" asChild>
          <Link to={fallback}>
            {inContest ? <LayoutDashboard /> : <Home />}
            {inContest ? "比赛概览" : "返回首页"}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// A route failure keeps the global navigation available and never exposes a stack trace.
class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean; resetKey: string }
> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { resetKey: string },
  ) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <StatusPage
        status={500}
        message="页面载入失败"
        retry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    );
  }
}

export function PageBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary resetKey={location.key}>{children}</RouteErrorBoundary>
  );
}
