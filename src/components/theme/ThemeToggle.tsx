"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemePreference } from "./ThemeProvider";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "auto", label: "Auto", Icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{
        display: "inline-flex",
        height: "32px",
        padding: "2px",
        borderRadius: "8px",
        backgroundColor: "var(--surface)",
        border: "0.5px solid var(--border)",
        flexShrink: 0,
      }}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              border: active ? "0.5px solid var(--theme-toggle-active-border)" : "0.5px solid transparent",
              cursor: "pointer",
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? "var(--theme-toggle-active-bg)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              transition:
                "background-color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
