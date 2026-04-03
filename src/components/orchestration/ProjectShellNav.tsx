"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flag, LayoutGrid, Settings, Sparkles, Users } from "lucide-react";

const tabs = [
  { key: "board", label: "Board", icon: LayoutGrid },
  { key: "agents", label: "Agents", icon: Users },
  { key: "sprints", label: "Sprints", icon: Flag },
  { key: "settings", label: "Settings", icon: Settings },
];

export function ProjectShellNav({ projectId, projectName }: { projectId: string; projectName: string }) {
  const pathname = usePathname();

  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_15%_15%,rgba(180,83,9,0.18),transparent_33%),radial-gradient(circle_at_85%_0%,rgba(244,63,94,0.16),transparent_30%),linear-gradient(165deg,rgba(15,23,42,0.86),rgba(2,6,23,0.94))] p-4 shadow-[0_20px_55px_rgba(2,6,23,0.45)] backdrop-blur-2xl md:p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/55 to-transparent" />
      <div className="pointer-events-none absolute -right-24 -top-20 h-44 w-44 rounded-full bg-amber-300/15 blur-3xl" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100/70">Mission Control Orchestration</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[1.75rem]">{projectName}</h1>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-amber-200" />
          Project Shell
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(({ key, label, icon: Icon }) => {
          const href = `/projects/${projectId}/${key}`;
          const active = pathname === href;
          return (
            <Link
              key={key}
              href={href}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/45"
              style={{
                borderColor: active ? "rgba(180,83,9,0.65)" : "rgba(148,163,184,0.22)",
                background: active
                  ? "linear-gradient(135deg, rgba(146,64,14,0.35), rgba(15,23,42,0.8))"
                  : "rgba(15,23,42,0.5)",
                color: active ? "#fef3c7" : "#cbd5e1",
                boxShadow: active ? "0 10px 26px rgba(180,83,9,0.2)" : "none",
              }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
