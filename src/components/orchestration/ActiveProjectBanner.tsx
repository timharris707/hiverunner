"use client";

import Link from "next/link";
import { Check, FolderKanban, Plus, X } from "lucide-react";

import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationProject } from "@/lib/orchestration/types";

type Props = {
  companySlug: string;
  project: OrchestrationProject;
  onClear?: () => void;
  compact?: boolean;
};

export function ActiveProjectBanner({ companySlug, project, onClear, compact = false }: Props) {
  return (
    <section
      className="rounded-2xl border px-4 py-3 backdrop-blur-xl"
      style={{
        borderColor: `${project.color}55`,
        background: `linear-gradient(135deg, ${project.color}18, rgba(28,25,23,0.88))`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
            style={{
              borderColor: `${project.color}66`,
              backgroundColor: `${project.color}22`,
              color: project.color,
            }}
          >
            <FolderKanban className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-100">
                <Check className="h-3 w-3" />
                Active project
              </span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-stone-400">{project.slug}</span>
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-stone-100">{project.name}</p>
            {!compact ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-stone-400">
                {project.description || "Global project context is pinned across this company workspace."}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={buildCompanyPath(companySlug, `/projects/${encodeURIComponent(project.slug || project.id)}/board`)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-stone-200 transition hover:bg-white/10"
          >
            Open board
          </Link>
          <Link
            href={`/companies/${encodeURIComponent(companySlug)}/issues/new?projectId=${encodeURIComponent(project.id)}`}
            className="inline-flex items-center gap-1 rounded-xl border border-amber-300/35 bg-amber-500/15 px-3 py-2 text-amber-100 transition hover:bg-amber-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            New task in project
          </Link>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-stone-300 transition hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
