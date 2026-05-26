"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type MissionIconOption = {
  value: string;
  label: string;
  keywords: string[];
};

export const HIVE_RUNNER_ICON_OPTIONS: MissionIconOption[] = [
  { value: "🛰️", label: "Satellite", keywords: ["space", "orbit", "mission", "control"] },
  { value: "🚀", label: "Rocket", keywords: ["launch", "ship", "build", "fast"] },
  { value: "🧠", label: "Brain", keywords: ["ai", "intelligence", "thinking", "model"] },
  { value: "⚙️", label: "Gear", keywords: ["ops", "system", "infra", "automation"] },
  { value: "🛡️", label: "Shield", keywords: ["security", "trust", "guard", "defense"] },
  { value: "🧪", label: "Lab", keywords: ["test", "research", "experiment", "qa"] },
  { value: "🎯", label: "Target", keywords: ["focus", "goal", "precision", "delivery"] },
  { value: "📈", label: "Growth", keywords: ["analytics", "market", "profit"] },
  { value: "📊", label: "Chart", keywords: ["metrics", "data", "report", "dashboard"] },
  { value: "🔧", label: "Tooling", keywords: ["engineering", "backend", "repair", "build"] },
  { value: "🎨", label: "Design", keywords: ["frontend", "ui", "creative", "visual"] },
  { value: "💻", label: "Terminal", keywords: ["code", "software", "full-stack", "dev"] },
  { value: "🤖", label: "Robot", keywords: ["agent", "autonomous", "assistant", "worker"] },
  { value: "🔭", label: "Scout", keywords: ["research", "intel", "explore", "signals"] },
  { value: "🌐", label: "Globe", keywords: ["web", "network", "global", "internet"] },
  { value: "📡", label: "Signal", keywords: ["monitor", "telemetry", "broadcast", "track"] },
  { value: "🏗️", label: "Architecture", keywords: ["platform", "foundation", "system", "structure"] },
  { value: "⚡", label: "Lightning", keywords: ["speed", "ceo", "priority", "energy"] },
  { value: "🌃", label: "City", keywords: ["night", "grid", "operations", "urban"] },
  { value: "📦", label: "Package", keywords: ["product", "project", "delivery", "bundle"] },
];

function matches(option: MissionIconOption, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [option.label, option.value, ...option.keywords].some((part) =>
    part.toLowerCase().includes(normalized)
  );
}

export function MissionIconPicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder = "Select icon",
  searchPlaceholder = "Search icons...",
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setQuery("");
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuery("");
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const selected =
    HIVE_RUNNER_ICON_OPTIONS.find((option) => option.value === value) ??
    (value
      ? {
          value,
          label: "Selected icon",
          keywords: [],
        }
      : null);

  const filteredOptions = useMemo(
    () => HIVE_RUNNER_ICON_OPTIONS.filter((option) => matches(option, query)),
    [query]
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() =>
          setOpen((current) => {
            if (current) setQuery("");
            return !current;
          })
        }
        className="flex w-full items-center gap-3 rounded-xl border border-amber-500/25 bg-[linear-gradient(180deg,rgba(68,64,60,0.96),rgba(28,25,23,0.98))] px-3 py-2 text-left text-stone-100 shadow-[0_10px_26px_rgba(12,10,9,0.24)] transition hover:border-amber-400/45 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-xl">
          {selected?.value ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{selected?.label ?? placeholder}</span>
          <span className="block truncate text-xs text-stone-400">
            {selected ? "HiveRunner icon" : "Open dropdown to pick an icon"}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-stone-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-amber-500/20 bg-[linear-gradient(180deg,rgba(41,37,36,0.98),rgba(12,10,9,0.99))] shadow-[0_18px_40px_rgba(12,10,9,0.45)] backdrop-blur-xl">
          <div className="border-b border-white/5 p-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-stone-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-stone-100 outline-none placeholder:text-stone-500"
              />
            </label>
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {filteredOptions.length ? (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                      isSelected
                        ? "bg-amber-500/14 text-amber-50"
                        : "text-stone-200 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-black/20 text-lg">
                      {option.value}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{option.label}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {option.keywords.join(" • ")}
                      </span>
                    </span>
                    {isSelected ? <Check className="h-4 w-4 text-amber-300" /> : null}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-sm text-stone-500">No icons match that search.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
