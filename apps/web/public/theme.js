// Run before the page paints. Kept external for the existing script-src 'self' CSP.
(() => {
  let theme = "system";
  try {
    theme = localStorage.getItem("nebuctf-theme") || "system";
  } catch {}
  const dark =
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#141414" : "#f6f7f8");
})();
