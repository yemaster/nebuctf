import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ReferenceDot,
  ReferenceLine,
  useChartHeight,
  useChartWidth,
  usePlotArea,
  useXAxisInverseScale,
} from "recharts";
import { ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { timelineAt, type TimelineRow } from "@/lib/score-timeline";

type Point = { x: number; y: number };

export function TimelineInspector({
  container,
  data,
  config,
  teams,
  hidden,
  formatTime,
}: {
  container: RefObject<HTMLDivElement | null>;
  data: TimelineRow[];
  config: ChartConfig;
  teams: { id: string; name: string }[];
  hidden: ReadonlySet<string>;
  formatTime: (time: number) => string;
}) {
  const plot = usePlotArea();
  const inverse = useXAxisInverseScale();
  const width = useChartWidth() ?? 0,
    height = useChartHeight() ?? 0;
  const [point, setPoint] = useState<Point | null>(null);
  const current = useRef<Point | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 240, height: 120 });

  useEffect(() => {
    const root = container.current;
    if (!root || !plot || !width || !height) return;
    let frame = 0;
    const update = (value: Point | null) => {
      cancelAnimationFrame(frame);
      frame = 0;
      current.current = value;
      setPoint(value);
    };
    const move = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * width) / rect.width;
      const y = ((event.clientY - rect.top) * height) / rect.height;
      const next =
        x >= plot.x &&
        x <= plot.x + plot.width &&
        y >= plot.y &&
        y <= plot.y + plot.height
          ? { x, y }
          : null;
      current.current = next;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setPoint(current.current);
        });
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType !== "touch") update(null);
    };
    const cancel = () => update(null);
    const outside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) update(null);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        update(null);
        return;
      }
      const previous = current.current?.x ?? plot.x;
      const x =
        event.key === "Home"
          ? plot.x
          : event.key === "End"
            ? plot.x + plot.width
            : previous +
              ((event.key === "ArrowRight" ? 1 : -1) * plot.width) / 100;
      update({
        x: Math.max(plot.x, Math.min(x, plot.x + plot.width)),
        y: plot.y + plot.height / 2,
      });
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerdown", move);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("focusout", cancel);
    root.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("focusout", cancel);
      root.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [container, plot?.x, plot?.y, plot?.width, plot?.height, width, height]);

  const time = point && inverse ? Number(inverse(point.x)) : NaN;
  const snapshot = timelineAt(
    data,
    Math.max(data[0]?.time ?? 0, Math.min(time, data.at(-1)?.time ?? 0)),
  );
  const payload = snapshot
    ? teams
        .flatMap((team, i) =>
          hidden.has(team.id)
            ? []
            : [
                {
                  name: `team${i}`,
                  dataKey: `team${i}`,
                  graphicalItemId: team.id,
                  value: snapshot[`team${i}`]!,
                  color: `var(--color-team${i})`,
                  payload: snapshot,
                },
              ],
        )
        .sort((a, b) => b.value - a.value)
    : [];
  const visible = !!point && !!snapshot && payload.length > 0;
  useLayoutEffect(() => {
    if (!visible || !popup.current) return;
    const measure = () => {
      const { width, height } = popup.current!.getBoundingClientRect();
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(popup.current);
    return () => observer.disconnect();
  }, [visible, payload.length]);

  if (!visible || !container.current) return null;
  const left = Math.max(
    4,
    Math.min(
      point.x + 12 + size.width <= width
        ? point.x + 12
        : point.x - size.width - 12,
      width - size.width - 4,
    ),
  );
  const top = Math.max(4, Math.min(point.y + 12, height - size.height - 4));
  return (
    <>
      <ReferenceLine
        x={snapshot.time}
        stroke="var(--muted-foreground)"
        strokeDasharray="3 3"
        pointerEvents="none"
      />
      {payload.map((item) => (
        <ReferenceDot
          key={item.dataKey}
          x={snapshot.time}
          y={item.value}
          r={3}
          fill={item.color}
          stroke="var(--card)"
          pointerEvents="none"
        />
      ))}
      {createPortal(
        <div
          ref={popup}
          role="tooltip"
          aria-label="积分详情"
          data-time={snapshot.time}
          className="pointer-events-none absolute z-30 w-60 max-w-full"
          style={{ left, top }}
        >
          <ChartTooltipContent
            active
            payload={payload}
            className="bg-popover px-3 py-2 shadow-md"
            labelClassName="mb-1 text-muted-foreground tabular-nums"
            labelFormatter={() => formatTime(snapshot.time)}
            formatter={(value, name, item) => (
              <div className="flex w-full items-center gap-3">
                <span
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {config[String(name)]?.label ?? name}
                </span>
                <span className="shrink-0 font-mono font-medium tabular-nums">
                  {Number(value).toLocaleString()}
                </span>
              </div>
            )}
          />
        </div>,
        container.current,
      )}
    </>
  );
}
