import { m, useReducedMotion } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import { Alert, AlertTitle } from "./ui/alert";
export function FlagFeedback({
  correct,
  message,
  animate = true,
}: {
  correct: boolean;
  message: string;
  animate?: boolean;
}) {
  const reduced = useReducedMotion();
  const motion = animate && !reduced;
  if (!correct)
    return (
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    );
  return (
    <m.div
      initial={motion ? { scale: 0.94, y: 12 } : false}
      animate={motion ? { scale: [0.94, 1.025, 1], y: 0 } : { scale: 1, y: 0 }}
      transition={{ duration: motion ? 0.48 : 0, ease: "easeOut" }}
      data-feedback-motion={motion ? "submit" : "none"}
    >
      <Alert
        role="status"
        className="flex items-center gap-4 border-0 bg-success/10 p-5 text-success sm:p-6"
      >
        <m.div
          className="shrink-0"
          initial={motion ? { scale: 0.5 } : false}
          animate={motion ? { scale: [0.5, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: motion ? 0.45 : 0 }}
        >
          <CheckCircle2 className="size-9" />
        </m.div>
        <AlertTitle className="line-clamp-none text-base">{message}</AlertTitle>
      </Alert>
    </m.div>
  );
}
