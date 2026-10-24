import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Loading } from "./shared";
import { PdfFailure } from "./pdf-preview";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: `/pdfjs/${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `/pdfjs/${pdfjs.version}/standard_fonts/`,
  wasmUrl: `/pdfjs/${pdfjs.version}/wasm/`,
  useWasm: false,
  maxImageSize: 16_000_000,
  canvasMaxAreaInBytes: 64_000_000,
  withCredentials: true,
};
export default function PdfDocument({
  url,
  retry,
}: {
  url: string;
  retry: () => void;
}) {
  const [pages, setPages] = useState(0),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(720);
  const [file, setFile] = useState<{ data: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "PDF 暂时无法预览");
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 20 * 1024 * 1024)
          throw new Error("PDF 超出预览大小限制");
        if (!controller.signal.aborted)
          setFile({ data: new Uint8Array(buffer) });
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "PDF 暂时无法预览");
      }
    })();
    return () => controller.abort();
  }, [url]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () =>
      setWidth(Math.max(240, Math.min(1200, node.clientWidth - 32)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const changePage = (value: number) => {
    setPage(Math.max(1, Math.min(pages || 1, value)));
    container.current?.scrollTo({ top: 0, left: 0 });
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-pdf-preview={url}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="PDF 上一页"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Input
            aria-label="PDF 页码"
            type="number"
            min={1}
            max={pages || 1}
            key={page}
            defaultValue={page}
            className="h-8 w-16 text-center"
            disabled={!pages}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= pages) changePage(n);
              else e.target.value = String(page);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            / {pages || "—"}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="PDF 下一页"
            disabled={!pages || page >= pages}
            onClick={() => changePage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="缩小 PDF"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((v) => v - 0.25)}
          >
            <Minus />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom(1)}
            aria-label="PDF 适应宽度"
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="放大 PDF"
            disabled={zoom >= 2}
            onClick={() => setZoom((v) => v + 0.25)}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div
        ref={container}
        className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4"
      >
        {error ? (
          <PdfFailure retry={retry} message={error} />
        ) : !file ? (
          <Loading fullPage />
        ) : (
          <Document
            file={file}
            options={options}
            suspense={false}
            loading={<Loading fullPage />}
            error={<PdfFailure retry={retry} />}
            noData={<PdfFailure retry={retry} />}
            onLoadSuccess={({ numPages }) => setPages(numPages)}
            className="mx-auto w-fit"
          >
            <Page
              pageNumber={page}
              width={Math.min(1600, width * zoom)}
              devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)}
              renderAnnotationLayer={false}
              loading={<Loading />}
              error={<PdfFailure retry={retry} />}
              className="shadow-sm"
            />
          </Document>
        )}
      </div>
    </div>
  );
}
