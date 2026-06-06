"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();

  const visibleTheme = theme === "auto" ? resolved : theme;
  const darkMode = visibleTheme === "dark";
  const Icon = darkMode ? Moon : Sun;
  const nextTheme = darkMode ? "light" : "dark";
  const title = darkMode ? "Dark mode. Switch to light mode." : "Light mode. Switch to dark mode.";

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={() => setTheme(nextTheme)}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "0.5px solid var(--border)",
        backgroundColor: "var(--surface)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        flexShrink: 0,
        transition:
          "background-color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = "var(--surface-elevated)";
        event.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = "var(--surface)";
        event.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      <Icon size={15} strokeWidth={2.1} />
    </button>
  );
}
