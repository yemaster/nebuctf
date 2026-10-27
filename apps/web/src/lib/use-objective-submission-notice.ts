import { useAPI } from "./api";

const remembered = new WeakMap<Window, Set<string>>();

export function useObjectiveSubmissionNotice() {
  const { data } = useAPI<{ user: { id: string } | null }>("/me");
  const key = data?.user?.id
    ? `nebuctf:objective-submit-notice:v1:${data.user.id}`
    : null;

  return {
    needsConfirmation: () => {
      if (!key) return true;
      if (remembered.get(window)?.has(key)) return false;
      try {
        return window.localStorage.getItem(key) !== "confirmed";
      } catch {
        return true;
      }
    },
    acknowledge: () => {
      if (!key) return;
      try {
        window.localStorage.setItem(key, "confirmed");
      } catch {
        const keys = remembered.get(window) ?? new Set<string>();
        keys.add(key);
        remembered.set(window, keys);
      }
    },
  };
}
