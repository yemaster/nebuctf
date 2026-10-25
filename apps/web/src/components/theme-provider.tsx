import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, Moon, Sun, Monitor, Palette } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "./ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  colorKey,
  themeKey,
  themeColors,
  validColor,
  validTheme,
  type Theme,
  type ThemeColor,
} from "@/lib/theme-settings";

const ThemeContext = createContext<{
  theme: Theme;
  resolved: "light" | "dark";
  color: ThemeColor;
  setTheme: (theme: Theme) => void;
  setColor: (color: ThemeColor) => void;
}>({
  theme: "system",
  resolved: "dark",
  color: "mint",
  setTheme() {},
  setColor() {},
});
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, update] = useState<Theme>(() => {
    try {
      return validTheme(localStorage.getItem(themeKey));
    } catch {
      return "system";
    }
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    !document.documentElement.classList.contains("dark")
      ? "light"
      : "dark",
  );
  const [color, updateColor] = useState<ThemeColor>(() => {
    try {
      return validColor(localStorage.getItem(colorKey));
    } catch {
      return "mint";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.themeColor = color;
  }, [color]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#141414" : "#f6f7f8");
      setResolved(dark ? "dark" : "light");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null)
        update(validTheme(event.newValue));
      if (event.key === colorKey || event.key === null)
        updateColor(validColor(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function setTheme(value: Theme) {
    update(value);
    try {
      localStorage.setItem(themeKey, value);
    } catch {
      /* Private browsing may deny persistence; switching still works. */
    }
  }
  function setColor(value: ThemeColor) {
    updateColor(value);
    try {
      localStorage.setItem(colorKey, value);
    } catch {
      /* Keep the current tab usable when persistence is unavailable. */
    }
  }
  return (
    <ThemeContext.Provider
      value={{ theme, resolved, color, setTheme, setColor }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeSettings() {
  const { theme, resolved, color, setTheme, setColor } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-lg data-[state=open]:bg-accent"
          aria-label="主题设置"
          title="主题设置"
        >
          <Palette className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        collisionPadding={12}
        aria-label="主题设置"
        className="w-80 max-w-[calc(100vw-1.5rem)] space-y-5 rounded-xl p-5 shadow-lg"
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">外观</legend>
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(value) => {
              if (value) setTheme(validTheme(value));
            }}
            aria-label="外观"
            spacing={1}
            className="grid w-full grid-cols-3 rounded-lg bg-muted p-1"
          >
            {[
              { value: "light", label: "亮色", icon: Sun },
              { value: "dark", label: "暗色", icon: Moon },
              { value: "system", label: "跟随系统", icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                className="h-16 flex-col gap-2 rounded-md px-1 text-xs text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                <Icon className="size-5" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">主题色</legend>
          <ToggleGroup
            type="single"
            value={color}
            onValueChange={(value) => {
              if (value) setColor(validColor(value));
            }}
            aria-label="主题色"
            spacing={2}
            className="grid w-full grid-cols-2"
          >
            {themeColors.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
                className="h-11 justify-start rounded-lg px-2.5 data-[state=on]:shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor:
                      resolved === "dark" ? option.dark : option.light,
                    color: resolved === "dark" ? option.ink : "#ffffff",
                  }}
                >
                  {color === option.value && <Check className="size-3.5" />}
                </span>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
export function ThemedToaster() {
  const { resolved } = useContext(ThemeContext);
  return <Toaster theme={resolved} richColors position="top-right" />;
}
