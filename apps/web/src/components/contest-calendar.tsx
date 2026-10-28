import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import { Day, type DayProps } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { useAPI } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  calendarDayKey,
  contestCalendarRange,
  layoutContestCalendar,
  type ContestCalendarDay,
} from "@/lib/contest-calendar";
import { Calendar, CalendarDayButton } from "./ui/calendar";
import { Card } from "./ui/card";
import { QueryState } from "./shared";

const EventsContext = createContext<ReturnType<typeof layoutContestCalendar>>(
  layoutContestCalendar([]),
);
function ContestDay(props: DayProps) {
  const { bars } = useContext(EventsContext);
  return (
    <Day {...props}>
      {props.children}
      {bars.get(calendarDayKey(props.day.date))?.map((bar) => (
        <span
          key={bar.id}
          data-contest-bar={bar.id}
          data-lane={bar.lane}
          data-days={bar.length}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-20 h-[3px] saturate-50 brightness-75",
            bar.color,
            bar.starts && "rounded-l-full",
            bar.ends && "rounded-r-full",
          )}
          style={{
            left: bar.starts ? 3 : 0,
            bottom: 4 + (2 - bar.lane) * 5,
            width: `calc(${bar.length * 100}% - ${(bar.starts ? 3 : 0) + (bar.ends ? 3 : 0)}px)`,
          }}
        />
      ))}
    </Day>
  );
}
function ContestDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const { days } = useContext(EventsContext);
  const entry = days.get(calendarDayKey(props.day.date));
  const contests = entry?.lanes.filter((c) => c !== null) ?? [];
  return (
    <CalendarDayButton
      {...props}
      className={cn(props.className, "justify-start pt-1.5 pb-5")}
      aria-label={
        entry?.count
          ? `${props["aria-label"]}，${entry.count} 场比赛`
          : props["aria-label"]
      }
      title={
        entry?.count
          ? `${contests.map((c) => c.title).join("\n")}${entry.count > contests.length ? `\n共 ${entry.count} 场比赛` : ""}`
          : undefined
      }
    />
  );
}
const components = { Day: ContestDay, DayButton: ContestDayButton };
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
  const range = contestCalendarRange(month);
  const data = useAPI<{ days: ContestCalendarDay[] }>(
    `/contests/calendar?from=${range.from}&to=${range.to}&zone=${encodeURIComponent(zone)}`,
  );
  const layout = useMemo(
    () => layoutContestCalendar(data.data?.days ?? []),
    [data.data],
  );
  return (
    <Card className="min-w-0 gap-4 border-0 p-4 dark:shadow-black/20">
      <h2 className="text-lg font-medium">比赛日历</h2>
      <EventsContext.Provider value={layout}>
        <Calendar
          locale={zhCN}
          weekStartsOn={1}
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={day}
          onSelect={onSelect}
          components={components}
          className="w-full min-w-0 bg-transparent p-0 [--cell-size:--spacing(8)]"
        />
      </EventsContext.Provider>
      <QueryState
        loading={data.isLoading}
        error={data.error}
        retry={() => void data.refetch()}
      />
    </Card>
  );
}
