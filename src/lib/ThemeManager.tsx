import * as React from "react";
import { useSettings } from "./settings-store";

export function ThemeManager() {
  const { theme } = useSettings();

  React.useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (t: "light" | "dark" | "system") => {
      root.classList.remove("light", "dark");

      if (t === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
        root.classList.add(systemTheme);
      } else {
        root.classList.add(t);
      }
    };

    applyTheme(theme);

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => applyTheme("system");
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  return null;
}
