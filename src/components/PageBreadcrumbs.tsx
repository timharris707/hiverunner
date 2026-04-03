"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const LABEL_MAP: Record<string, string> = {
  trading: "Trading Desk",
  advisory: "Advisory Board",
  agents: "Team",
  companies: "Companies",
  tasks: "Task Board",
  issues: "Tasks",
  team: "Team",
  board: "Board",
  inbox: "Inbox",
  sessions: "Sessions",
  memory: "Memory",
  files: "Files",
  search: "Search",
  reports: "Reports",
  logs: "Logs",
  system: "System",
  costs: "Costs",
  reliability: "Reliability",
  calendar: "Calendar",
  workflows: "Workflows",
  cron: "Cron Jobs",
  settings: "Settings",
  terminal: "Terminal",
  office: "3D Office",
  factory: "Factory Floor",
  pipeline: "Pipeline",
  activity: "Activity",
  analytics: "Analytics",
  about: "About",
  skills: "Skills",
  git: "Git",
};

export function PageBreadcrumbs() {
  const pathname = usePathname();

  // Advisory page uses full-bleed layout with negative margins — breadcrumbs overlap
  // Use startsWith to cover any advisory sub-routes
  if (pathname === "/" || pathname.startsWith("/advisory")) return null;

  const segments = pathname.split("/").filter(Boolean);

  const crumbs = segments.map((seg, i) => ({
    label: LABEL_MAP[seg] || seg.charAt(0).toUpperCase() + seg.slice(1),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav
      className="flex items-center gap-1.5 mb-3"
      style={{ fontSize: "12px", color: "var(--text-muted)" }}
    >
      <Link
        href="/"
        className="flex items-center gap-1 transition-opacity hover:opacity-80"
        style={{ color: "var(--text-muted)", textDecoration: "none" }}
      >
        <Home size={12} />
        <span>Home</span>
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight size={10} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
          {crumb.isLast ? (
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="transition-opacity hover:opacity-80"
              style={{ color: "var(--text-muted)", textDecoration: "none" }}
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
