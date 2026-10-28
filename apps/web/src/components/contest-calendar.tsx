import { useMemo, useState } from "react";
import { zhCN } from "react-day-picker/locale";
import { useAPI } from "@/lib/api";
import { Calendar, CalendarDayButton } from "./ui/calendar";
import { Card } from "./ui/card";
import { QueryState } from "./shared";
const colors = [
  "bg-sky-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-teal-400",
  "bg-rose-400",
  "bg-indigo-400",
];
type CalendarDay = {
  day: string;
  count: number;
  contests?: { id: string; title: string }[];
};
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
  const data = useAPI<{ days: CalendarDay[] }>(
    `/contests/calendar?from=${dayKey(new Date(month.getFullYear(), month.getMonth(), 1))}&to=${dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0))}&zone=${encodeURIComponent(zone)}`,
  );
  const days = useMemo(
    () => new Map(data.data?.days.map((d) => [d.day, d])),
    [data.data],
  );
  const palette = useMemo(() => {
    const result = new Map<string, string>();
    for (const d of data.data?.days ?? []) {
      const used = new Set(
        d.contests?.map((c) => result.get(c.id)).filter(Boolean),
      );
      for (const c of d.contests ?? [])
        if (!result.has(c.id)) {
          const hash = Array.from(c.id).reduce(
            (n, v) => (n * 31 + v.charCodeAt(0)) >>> 0,
            0,
          );
          const candidates = colors.map(
            (_, n) => colors[(hash + n) % colors.length]!,
          );
          const color = candidates.find((c) => !used.has(c)) ?? candidates[0]!;
          result.set(c.id, color);
          used.add(color);
        }
    }
    return result;
  }, [data.data]);
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
        components={{
          DayButton: (props) => {
            const entry = days.get(dayKey(props.day.date));
            return (
              <CalendarDayButton
                {...props}
                className="relative pb-2"
                title={
                  entry?.count
                    ? `${entry.contests?.map((c) => c.title).join("\n") ?? ""}${entry.count > 3 ? `\n共 ${entry.count} 场比赛` : ""}`
                    : undefined
                }
              >
                {props.children}
                {!!entry?.contests?.length && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-1 bottom-1 flex gap-0.5 !opacity-100"
                  >
                    {entry.contests.map((c) => (
                      <span
                        key={c.id}
                        className={`h-1 min-w-0 flex-1 rounded-full ${palette.get(c.id)}`}
                      />
                    ))}
                  </span>
                )}
              </CalendarDayButton>
            );
          },
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
