"use client";

import { useMemo, useRef } from "react";

type SegmentedControlOption = {
  value: string;
  label: string;
};

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = useMemo(() => Math.max(0, options.findIndex((option) => option.value === value)), [options, value]);

  const focusOption = (index: number) => {
    const normalized = (index + options.length) % options.length;
    const next = options[normalized];
    if (!next) return;
    onChange(next.value);
    buttonRefs.current[normalized]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 2,
        padding: 3,
        borderRadius: 999,
        border: "0.5px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected || index === activeIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                focusOption(index + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                focusOption(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusOption(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusOption(options.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onChange(option.value);
              }
            }}
            style={{
              height: 28,
              border: selected ? "0.5px solid var(--theme-toggle-active-border)" : "0.5px solid transparent",
              borderRadius: 999,
              background: selected ? "var(--theme-toggle-active-bg)" : "transparent",
              color: selected ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: selected ? 650 : 500,
              outline: "none",
              transition: "background-color 120ms ease, color 120ms ease",
            }}
            onMouseEnter={(event) => {
              if (!selected) event.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(event) => {
              if (!selected) event.currentTarget.style.background = "transparent";
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
