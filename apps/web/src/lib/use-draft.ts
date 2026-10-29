import { useState, type SetStateAction } from "react";

const prefix = "nebuctf:form-draft:";
export function readDraft<T>(key: string, initial: T): T {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(prefix + key) ?? "null",
    );
    if (stored && Date.now() - stored.time < 86400000) return stored.value;
    if (stored) window.localStorage.removeItem(prefix + key);
  } catch {
    /* A blocked or full storage must not prevent editing. */
  }
  return initial;
}
export function writeDraft(key: string, value: unknown) {
  try {
    window.localStorage.setItem(
      prefix + key,
      JSON.stringify({ time: Date.now(), value }),
    );
    return true;
  } catch {
    return false;
  }
}
export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(prefix + key);
  } catch {
    /* Storage may be disabled. */
  }
}
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readDraft(key, initial));
  const [stored, setStored] = useState<boolean | null>(null);
  function update(next: SetStateAction<T>) {
    setValue((previous) => {
      const result =
        typeof next === "function" ? (next as (v: T) => T)(previous) : next;
      setStored(writeDraft(key, result));
      return result;
    });
  }
  return [
    value,
    update,
    () => {
      clearDraft(key);
      setStored(null);
    },
    stored,
  ] as const;
}
