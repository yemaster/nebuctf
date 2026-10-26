import { useEffect, useRef, useState } from "react";
import {
  contestCountdown,
  countdownTone,
  remainingTime,
  type ContestClock,
} from "@/lib/contest-clock";
import { useContestNow } from "./contest-clock";
import { Card } from "./ui/card";

export function ContestCountdown({
  clock,
  receivedAt,
}: {
  clock: ContestClock;
  receivedAt: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [obscured, setObscured] = useState(false);
  useEffect(() => {
    let pointer: { x: number; y: number } | null = null;
    const check = () => {
      const box = ref.current?.getBoundingClientRect();
      setObscured(
        !!(
          box &&
          pointer &&
          pointer.x >= box.left &&
          pointer.x <= box.right &&
          pointer.y >= box.top &&
          pointer.y <= box.bottom
        ),
      );
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      check();
    };
    const leave = () => {
      pointer = null;
      setObscured(false);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", check, { capture: true, passive: true });
    window.addEventListener("resize", check);
    window.addEventListener("blur", leave);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
      window.removeEventListener("blur", leave);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);
  const now = useContestNow(clock, receivedAt);
  const { label, remaining } = contestCountdown(clock, now);
  const tone = countdownTone(clock, now);
  const color = {
    scheduled: "text-primary",
    running: "text-success",
    warning: "text-warning",
    urgent: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <Card
      ref={ref}
      data-obscured={obscured}
      role="timer"
      aria-label="比赛倒计时"
      className="pointer-events-none transition-opacity duration-200 motion-reduce:transition-none data-[obscured=true]:opacity-10 absolute top-full right-0 mt-3 hidden w-60 items-center gap-1 px-5 py-3 text-center shadow-md md:flex"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <time
        className={`text-4xl leading-10 font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${color}`}
      >
        {remainingTime(remaining)}
      </time>
    </Card>
  );
}
