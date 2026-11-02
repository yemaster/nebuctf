import type { User } from "./types";
export type AccessProfile = {
  permissions: string[];
  roles: { id: string; name: string }[];
  grants: {
    kind: "challenge" | "contest";
    id: string;
    permissions: string[];
  }[];
};
const includes = (keys: string[], key: string) =>
  keys.includes(key) ||
  (key.endsWith(".read") && keys.includes(key.replace(/\.read$/, ".write")));
export function can(user: User | null | undefined, key: string, id?: string) {
  if (!user) return false;
  return (
    user.role === "admin" ||
    includes(user.access?.permissions ?? [], key) ||
    (!!id &&
      !!user.access?.grants.some(
        (g) => g.id === id && includes(g.permissions, key),
      ))
  );
}
export function anyAccess(user: User | null | undefined, key: string) {
  return (
    can(user, key) ||
    !!user?.access?.grants.some((g) => includes(g.permissions, key))
  );
}
export function isStaff(user: User | null | undefined) {
  return (
    user?.role === "admin" ||
    !!user?.access?.permissions.length ||
    !!user?.access?.grants.length
  );
}
export const adminSection = (section: string) =>
  (
    ({
      problemsets: "content",
      articles: "content",
      learning: "content",
      submissions: "logs",
      audit: "logs",
    }) as Record<string, string>
  )[section] ?? section;
