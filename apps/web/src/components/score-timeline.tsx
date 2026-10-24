import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Brush } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "./ui/chart";
import type { ScoreboardData } from "@/lib/types";
import { scoreTimelineRows } from "@/lib/scoreboard";

const palette = [
  { light: "var(--primary)", dark: "var(--primary)" },
  { light: "var(--color-blue-600)", dark: "var(--color-blue-400)" },
  { light: "var(--color-amber-600)", dark: "var(--color-amber-400)" },
  { light: "var(--color-violet-600)", dark: "var(--color-violet-400)" },
  { light: "var(--color-rose-600)", dark: "var(--color-rose-400)" },
];
const time = (value: number) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export function ScoreTimeline({ board }: { board: ScoreboardData }) {
  const config = useMemo(
    () =>
      Object.fromEntries(
        board.timeline.map((team, i) => [
          `team${i}`,
          { label: team.name, theme: palette[i % palette.length]! },
        ]),
      ),
    [board.timeline],
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
  const multiDay =
    Date.parse(board.cutoff) - Date.parse(board.starts_at!) > 86400000;
  return (
    <ChartContainer
      config={config}
      className="h-72 w-full aspect-auto sm:h-80"
      aria-label="前五名战队积分走势"
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickFormatter={(value) =>
            multiDay
              ? new Date(value).toLocaleDateString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                })
              : time(value)
          }
        />
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                new Date(payload[0]?.payload.time).toLocaleString("zh-CN", {
                  hour12: false,
                })
              }
            />
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
            isAnimationActive={false}
          />
        ))}
        <ChartLegend
          content={<ChartLegendContent className="flex-wrap gap-x-5 gap-y-2" />}
        />
        <Brush
          dataKey="time"
          height={20}
          travellerWidth={8}
          stroke="var(--border)"
          fill="var(--card)"
          tickFormatter={(value) => time(Number(value))}
        />
      </LineChart>
    </ChartContainer>
  );
}
