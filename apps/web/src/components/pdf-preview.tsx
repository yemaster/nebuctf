import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { FileWarning } from "lucide-react";
import { Button } from "./ui/button";
import { Loading } from "./shared";

const PdfDocument = lazy(() => import("./pdf-document"));
class PreviewBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PdfFailure retry={this.props.retry} />
    ) : (
      this.props.children
    );
  }
}
export function PdfFailure({
  retry,
  message = "PDF 暂时无法预览",
}: {
  retry: () => void;
  message?: string;
}) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-64 flex-col items-center justify-center gap-4 text-muted-foreground"
    >
      <FileWarning className="size-8" />
      <p className="text-sm">{message}</p>
      <Button variant="secondary" onClick={retry}>
        重新加载
      </Button>
    </div>
  );
}
export function PdfPreview({
  url,
  onRetry,
}: {
  url: string;
  onRetry: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    onRetry();
    setAttempt((n) => n + 1);
  };
  return (
    <PreviewBoundary key={`${url}:${attempt}`} retry={retry}>
      <Suspense fallback={<Loading fullPage />}>
        <PdfDocument url={url} retry={retry} />
      </Suspense>
    </PreviewBoundary>
  );
}
