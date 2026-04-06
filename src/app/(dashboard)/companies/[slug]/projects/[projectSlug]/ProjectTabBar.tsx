"use client";

import Link from "next/link";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

type TabKey = "tasks" | "overview" | "workspaces" | "configuration" | "budget";

const TABS: { key: TabKey; label: string; path: string }[] = [
  { key: "tasks", label: "Tasks", path: "/tasks" },
  { key: "overview", label: "Overview", path: "/overview" },
  { key: "workspaces", label: "Workspaces", path: "/workspaces" },
  { key: "configuration", label: "Configuration", path: "/configuration" },
  { key: "budget", label: "Budget", path: "/budget" },
];

export function ProjectTabBar({
  slug,
  projectSlug,
  active,
}: {
  slug: string;
  projectSlug: string;
  active: TabKey;
}) {
  return (
    <div className="border-b" style={{ borderColor: "rgba(120,113,108,0.15)" }}>
      <nav className="flex gap-0">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}${tab.path}`)}
            className="relative px-3 py-2.5 text-sm font-medium no-underline transition-colors"
            style={{ color: tab.key === active ? "#f5f5f4" : "#78716c" }}
          >
            {tab.label}
            {tab.key === active && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5"
                style={{ background: "#d97706" }}
              />
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}
