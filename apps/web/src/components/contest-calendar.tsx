import { useState } from "react";
import { zhCN } from "react-day-picker/locale";
import { useAPI } from "@/lib/api";
import { Calendar } from "./ui/calendar";
import { Card } from "./ui/card";
import { QueryState } from "./shared";
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function contestDayFilter(day?: Date) {
  if (!day) return "";
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()),
    to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return `&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}
export function ContestCalendar({
  day,
  onSelect,
}: {
  day?: Date;
  onSelect: (day: Date | undefined) => void;
}) {
  const [month, setMonth] = useState(day ?? new Date());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const data = useAPI<{ days: { day: string; count: number }[] }>(
    `/contests/calendar?from=${dayKey(new Date(month.getFullYear(), month.getMonth(), 1))}&to=${dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0))}&zone=${encodeURIComponent(zone)}`,
  );
  return (
    <Card className="min-w-0 gap-4 border-0 p-4 dark:shadow-black/20">
      <h2 className="text-lg font-medium">比赛日历</h2>
      <Calendar
        locale={zhCN}
        mode="single"
        month={month}
        onMonthChange={setMonth}
        selected={day}
        onSelect={onSelect}
        modifiers={{
          event: (d) =>
            !!data.data?.days.some((v) => v.day === dayKey(d) && v.count > 0),
        }}
        modifiersClassNames={{
          event: "bg-primary/10 text-primary font-semibold",
        }}
        className="w-full min-w-0 bg-transparent p-0 [--cell-size:--spacing(8)]"
      />
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
    </Card>
  );
}
