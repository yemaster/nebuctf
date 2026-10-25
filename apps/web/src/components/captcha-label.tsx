import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";

const alphabet = "0123456789ABCDEF";
// Decorative characters only; they never participate in the proof calculation.
const randomCharacter = (previous?: string) => {
  const index = Math.floor(Math.random() * alphabet.length);
  return alphabet[
    (index + (alphabet[index] === previous ? 1 : 0)) % alphabet.length
  ]!;
};

export function CaptchaLabel({
  text,
  working,
  verified,
}: {
  text: string;
  working: boolean;
  verified: boolean;
}) {
  const [motionPreference] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : window.matchMedia?.("(prefers-reduced-motion: reduce)"),
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      motionPreference?.addEventListener("change", notify);
      return () => motionPreference?.removeEventListener("change", notify);
    },
    [motionPreference],
  );
  const reduced = useSyncExternalStore(
    subscribe,
    () => motionPreference?.matches ?? false,
    () => false,
  );
  const wasWorking = useRef(false);
  const characters = useRef<string[]>([]);
  const [frame, setFrame] = useState<{
    characters: string[];
    fixed: number;
  } | null>(null);

  useEffect(() => {
    const finish = verified && wasWorking.current;
    wasWorking.current = working;
    if (reduced || (!working && !finish)) {
      setFrame(null);
      return;
    }

    const target = Array.from(text);
    if (working || characters.current.length !== target.length)
      characters.current = target.map(randomCharacter);
    let fixed = 0,
      cursor = 0,
      ticks = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () =>
      setFrame({ characters: [...characters.current], fixed });
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const tick = () => {
      ticks++;
      if (finish && ticks % 2 === 0) {
        characters.current[fixed] = target[fixed]!;
        fixed++;
      } else {
        const index = fixed + (cursor++ % (target.length - fixed));
        characters.current[index] = randomCharacter(characters.current[index]);
      }
      update();
      if (fixed === target.length) stop();
    };
    const visibility = () => {
      stop();
      if (document.hidden) {
        if (finish) {
          characters.current = target;
          fixed = target.length;
          update();
        }
      } else if (fixed < target.length) timer = setInterval(tick, 60);
    };
    update();
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [text, working, verified, reduced]);

  const animated = !reduced && (working || verified) && frame;
  return (
    <span role="status" aria-live="polite" aria-atomic="true">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        {animated
          ? frame.characters.map((character, index) => (
              <span
                key={index}
                data-state={index < frame.fixed ? "fixed" : "changing"}
                className={cn(
                  "inline-block w-[1em] text-center tabular-nums transition-colors duration-150 motion-reduce:transition-none",
                  index < frame.fixed
                    ? "text-success"
                    : "text-muted-foreground",
                )}
              >
                {character}
              </span>
            ))
          : text}
      </span>
    </span>
  );
}
