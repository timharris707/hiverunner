"use client";

import { CircleHelp } from "lucide-react";
import { ReactNode, useState } from "react";

interface InlineTooltipProps {
  label: string;
  children: ReactNode;
}

export function InlineTooltip({ label, children }: InlineTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full"
        style={{ color: "var(--text-muted)", opacity: open ? 1 : 0.75 }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg p-3 text-xs leading-5 shadow-2xl"
          style={{
            backgroundColor: "rgba(10, 15, 28, 0.98)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
