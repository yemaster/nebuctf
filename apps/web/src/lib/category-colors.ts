// Keep category hues subtle against the table surface in both themes.
export const categoryTextColors: Record<string, string> = {
  Web: "text-blue-950/70 dark:text-blue-100/75",
  Pwn: "text-red-950/70 dark:text-red-100/75",
  Reverse: "text-yellow-950/70 dark:text-yellow-100/75",
  Crypto: "text-violet-950/70 dark:text-violet-100/75",
  Misc: "text-teal-950/70 dark:text-teal-100/75",
  Forensics: "text-indigo-950/70 dark:text-indigo-100/75",
};
export const categoryHeaderColors: Record<string, string> = {
  Web: `bg-blue-500/10 dark:bg-blue-400/10 ${categoryTextColors.Web}`,
  Pwn: `bg-red-500/10 dark:bg-red-400/10 ${categoryTextColors.Pwn}`,
  Reverse: `bg-yellow-500/10 dark:bg-yellow-400/10 ${categoryTextColors.Reverse}`,
  Crypto: `bg-violet-500/10 dark:bg-violet-400/10 ${categoryTextColors.Crypto}`,
  Misc: `bg-teal-500/10 dark:bg-teal-400/10 ${categoryTextColors.Misc}`,
  Forensics: `bg-indigo-500/10 dark:bg-indigo-400/10 ${categoryTextColors.Forensics}`,
};

// The same Tailwind hue families as the scoreboard, in sRGB for Three.js.
// Canvas materials cannot consume the stylesheet's oklch() values directly.
const categorySceneColors: Record<string, string> = {
  Web: "#60a5fa",
  Pwn: "#f87171",
  Reverse: "#facc15",
  Crypto: "#a78bfa",
  Misc: "#2dd4bf",
  Forensics: "#818cf8",
};
export function categorySceneColor(category: string) {
  const key = Object.keys(categorySceneColors).find(
    (name) => name.toLowerCase() === category.toLowerCase(),
  );
  return categorySceneColors[key ?? ""] ?? "#94a3b8";
}
