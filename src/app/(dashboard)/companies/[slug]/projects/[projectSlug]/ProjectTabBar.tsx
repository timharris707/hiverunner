"use client";

import { SubmenuTabs } from "@/components/navigation/SubmenuTabs";
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
    <SubmenuTabs
      activeKey={active}
      tabs={TABS.map((tab) => ({
        key: tab.key,
        label: tab.label,
        href: buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}${tab.path}`),
        onClick: () => {
          try { localStorage.setItem(`project-tab:${projectSlug}`, tab.key); } catch { /* best-effort */ }
        },
      }))}
    />
  );
}
