import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import type { CategoryScore } from "@/lib/types";

export function ScoreRadar({
  categories,
  name,
  maximum,
}: {
  categories: CategoryScore[];
  name: string;
  maximum: number;
}) {
  return (
    <ChartContainer
      config={{ score: { label: "得分", color: "var(--primary)" } }}
      className="mx-auto h-64 w-full max-w-96 aspect-auto"
      aria-label={`${name}方向得分雷达图`}
    >
      <RadarChart data={categories} outerRadius="70%" accessibilityLayer>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fill: "var(--muted-foreground)" }}
        />
        <PolarRadiusAxis
          domain={[0, Math.max(1, maximum)]}
          tick={false}
          axisLine={false}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Radar
          dataKey="score"
          stroke="var(--color-score)"
          fill="var(--color-score)"
          fillOpacity={0.2}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </RadarChart>
    </ChartContainer>
  );
}
