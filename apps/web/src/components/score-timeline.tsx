import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { RotateCcw } from "lucide-react";
import { ChartContainer, type ChartConfig } from "./ui/chart";
import { Button } from "./ui/button";
import { TimelineInspector } from "./timeline-inspector";
import { Slider } from "./ui/slider";
import type { ScoreboardData } from "@/lib/types";
import { scoreTimelineRows } from "@/lib/scoreboard";
import {
  timelineWindow,
  timelineActivityRange,
  timelineTicks,
  timelineColors,
  type TimeRange,
} from "@/lib/score-timeline";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const palette = [
  { light: "var(--color-teal-600)", dark: "var(--color-teal-400)" },
  { light: "var(--color-blue-600)", dark: "var(--color-blue-400)" },
  { light: "var(--color-amber-600)", dark: "var(--color-amber-400)" },
  { light: "var(--color-violet-600)", dark: "var(--color-violet-400)" },
  { light: "var(--color-rose-600)", dark: "var(--color-rose-400)" },
];
const time = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const seconds = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fullTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const compact = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function ScoreTimeline({ board }: { board: ScoreboardData }) {
  const mobile = useIsMobile();
  const chart = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"all" | "activity" | "custom">("all");
  const [selection, setSelection] = useState<TimeRange | null>(null);
  const [hidden, setHidden] = useState(new Set<string>());
  const previousColors = useRef<Record<string, number>>({});
  const ids = board.timeline.map((team) => team.id).join(",");
  const colors = useMemo(
    () =>
      timelineColors(ids.split(",").filter(Boolean), previousColors.current),
    [ids],
  );
  useEffect(() => {
    previousColors.current = colors;
  }, [colors]);
  const config = useMemo(
    () =>
      Object.fromEntries(
        board.timeline.map((team, i) => [
          `team${i}`,
          { label: team.name, theme: palette[colors[team.id]!]! },
        ]),
      ),
    [board.timeline, colors],
  ) satisfies ChartConfig;
  const cutoff = new Date(
    Math.min(
      Date.parse(board.cutoff),
      Date.parse(board.ends_at ?? board.cutoff),
    ),
  ).toISOString();
  const data = useMemo(
    () => scoreTimelineRows(board.timeline, board.starts_at!, cutoff),
    [board.timeline, board.starts_at, cutoff],
  );
  const bounds: TimeRange = [data[0]?.time ?? 0, data.at(-1)?.time ?? 0];
  const activity = useMemo(() => timelineActivityRange(data), [data]);
  const requested =
    mode === "activity" ? activity : mode === "custom" ? selection : null;
  const range: TimeRange = requested
    ? [
        Math.max(bounds[0], Math.min(requested[0], bounds[1])),
        Math.max(bounds[0], Math.min(requested[1], bounds[1])),
      ]
    : bounds;
  if (range[0] >= range[1]) [range[0], range[1]] = bounds;
  const visible = useMemo(
    () => timelineWindow(data, range),
    [data, range[0], range[1]],
  );
  const ticks = timelineTicks(range, mobile ? 3 : 7);
  const multiDay =
    new Date(range[0]).toDateString() !== new Date(range[1]).toDateString();
  const tickFormat = multiDay
    ? dateTime
    : range[1] - range[0] < 60_000
      ? seconds
      : time;
  const all = range[0] === bounds[0] && range[1] === bounds[1];
  if (bounds[0] >= bounds[1])
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        暂无积分变化
      </div>
    );

  return (
    <div className="space-y-3" aria-label="积分走势图控制">
      <ChartContainer
        config={config}
        ref={chart}
        className="relative h-56 w-full aspect-auto touch-pan-y sm:h-64"
        aria-label="前五名战队积分走势"
      >
        <LineChart
          accessibilityLayer
          aria-label="积分走势图，左右方向键查看时间"
          data={visible}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={range}
            ticks={ticks}
            allowDataOverflow
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            interval="preserveStartEnd"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(value) => tickFormat.format(value)}
          />
          <YAxis
            width={mobile ? 40 : 48}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickCount={5}
            domain={[
              (min: number) => Math.min(0, min * 1.1),
              (max: number) => Math.max(10, Math.ceil((max * 11) / 10)),
            ]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(value) =>
              Math.abs(value) >= 10_000 ? compact.format(value) : String(value)
            }
          />
          {board.timeline.map((team, index) => (
            <Line
              key={team.id}
              dataKey={`team${index}`}
              type="stepAfter"
              stroke={`var(--color-team${index})`}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              hide={hidden.has(team.id)}
              isAnimationActive={false}
            />
          ))}
          <TimelineInspector
            container={chart}
            data={visible}
            config={config}
            teams={board.timeline}
            hidden={hidden}
            formatTime={(value) => fullTime.format(value)}
          />
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        <div className="min-w-40 flex-1 px-2">
          <Slider
            min={bounds[0]}
            max={bounds[1]}
            step={Math.min(1000, bounds[1] - bounds[0])}
            minStepsBetweenThumbs={1}
            value={range}
            thumbLabels={["时间范围开始", "时间范围结束"]}
            formatValue={(value) => fullTime.format(value)}
            className="h-8 [&_[data-slot=slider-range]]:bg-muted-foreground/40 [&_[data-slot=slider-thumb]]:border-border"
            onValueChange={(value) => {
              setSelection(value as TimeRange);
              setMode("custom");
            }}
          />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
            <time dateTime={new Date(range[0]).toISOString()}>
              {dateTime.format(range[0])}
            </time>
            <time dateTime={new Date(range[1]).toISOString()}>
              {dateTime.format(range[1])}
            </time>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={mode === "activity" ? "secondary" : "ghost"}
            disabled={!activity}
            onClick={() => setMode("activity")}
          >
            得分时段
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="重置时间范围"
            title="重置时间范围"
            disabled={all}
            onClick={() => setMode("all")}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      <div
        className="flex flex-wrap justify-center gap-x-5 gap-y-1"
        role="group"
        aria-label="走势图战队"
      >
        {board.timeline.map((team) => (
          <button
            key={team.id}
            type="button"
            aria-pressed={!hidden.has(team.id)}
            aria-label={`${hidden.has(team.id) ? "显示" : "隐藏"}${team.name}的积分走势`}
            className={cn(
              "flex max-w-full items-center gap-2 rounded-sm py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hidden.has(team.id) && "opacity-40",
            )}
            onClick={() =>
              setHidden((previous) => {
                const next = new Set(previous);
                if (next.has(team.id)) next.delete(team.id);
                else next.add(team.id);
                return next;
              })
            }
          >
            <span
              aria-hidden
              className="h-0.5 w-4 shrink-0 rounded-full bg-(--team-color) dark:bg-(--team-color-dark)"
              style={
                {
                  "--team-color": palette[colors[team.id]!]!.light,
                  "--team-color-dark": palette[colors[team.id]!]!.dark,
                } as CSSProperties
              }
            />
            <span className="truncate">{team.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
