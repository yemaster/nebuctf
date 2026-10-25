// Run before the page paints. Kept external for the existing script-src 'self' CSP.
(() => {
  let theme = "system";
  let color = "mint";
  try {
    theme = localStorage.getItem("nebuctf-theme") || "system";
    const saved = localStorage.getItem("nebuctf-color");
    if (["mint", "glacier", "ocean", "lime"].includes(saved)) color = saved;
  } catch {}
  const dark =
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.themeColor = color;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#141414" : "#f6f7f8");
})();
