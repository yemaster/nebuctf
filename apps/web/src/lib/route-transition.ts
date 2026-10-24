// Navigation fades the content only. Editing and solving never move the shell.
export function routeTransition(path: string) {
  if (path === "/challenges" || /^\/contests\/[^/]+\/challenges$/.test(path))
    return { y: 0, duration: 0.12 };
  if (["/login", "/register", "/account", "/admin"].includes(path))
    return { y: 0, duration: 0.14 };
  if (/^\/(library|learning|problemsets)\/[^/]+$/.test(path))
    return { y: 4, duration: 0.18 };
  if (
    [
      "/",
      "/contests",
      "/problemsets",
      "/scoreboard",
      "/library",
      "/learning",
      "/team",
      "/instances",
      "/announcements",
    ].includes(path) ||
    /^\/contests\/[^/]+(?:\/(scoreboard|announcements|instances))?$/.test(path)
  )
    return { y: 3, duration: 0.16 };
  return { y: 0, duration: 0 };
}
