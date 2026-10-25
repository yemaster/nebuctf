export type Theme = "light" | "dark" | "system";
export const themeKey = "nebuctf-theme";
export const colorKey = "nebuctf-color";
export const themeColors = [
  // Reference values and light-mode mappings are documented in FRONTEND.md.
  {
    value: "mint",
    label: "薄荷青",
    light: "#007f6e",
    dark: "#2ae5b5",
    ink: "#141414",
  },
  {
    value: "glacier",
    label: "冰川蓝",
    light: "#0774be",
    dark: "#0991ed",
    ink: "#000000",
  },
  {
    value: "ocean",
    label: "深海蓝",
    light: "#0a58ca",
    dark: "#6ea8fe",
    ink: "#141414",
  },
  {
    value: "lime",
    label: "青柠绿",
    light: "#507800",
    dark: "#9fef00",
    ink: "#141414",
  },
] as const;
export type ThemeColor = (typeof themeColors)[number]["value"];
export const validTheme = (value: string | null): Theme =>
  value === "light" || value === "dark" ? value : "system";
export const validColor = (value: string | null): ThemeColor =>
  themeColors.find((color) => color.value === value)?.value ?? "mint";
