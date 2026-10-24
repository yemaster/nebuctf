import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { scoreCurve } from "@/lib/scoring";

export default function ScoreCurve({
  initial,
  minimum,
  decay,
}: {
  initial: number;
  minimum: number;
  decay: number;
}) {
  const data = scoreCurve(initial, minimum, decay);
  if (!data.length)
    return (
      <p className="text-sm text-muted-foreground">填写有效分值后显示曲线。</p>
    );
  return (
    <figure className="space-y-2" aria-label="动态分数预览">
      <ChartContainer
        config={{ points: { label: "分值", color: "var(--primary)" } }}
        className="h-52 w-full aspect-auto"
      >
        <LineChart
          data={data}
          accessibilityLayer
          margin={{ top: 8, right: 12, left: -8, bottom: 20 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="solves"
            type="number"
            domain={[0, "dataMax"]}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            label={{ value: "解题数", position: "insideBottom", offset: -12 }}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            domain={[0, initial]}
            allowDecimals={false}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  `${payload[0]?.payload.solves ?? 0} 次解出`
                }
              />
            }
          />
          <Line
            type="monotone"
            dataKey="points"
            stroke="var(--color-points)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>初始 {initial} 分</span>
        <span>最低 {minimum} 分</span>
      </figcaption>
    </figure>
  );
}
