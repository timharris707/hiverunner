"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Monitor,
  FolderOpen,
  Brain,
  Bot,
  Clock,
  DollarSign,
  Settings,
  History,
  Kanban,
  TrendingUp,
  CalendarDays,
  Workflow,
  Terminal,
  Search,
  Shield,
  FileBarChart,
  BarChart3,
  Puzzle,
} from "lucide-react";

const dockItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/tasks", label: "Task Board", icon: Kanban },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/trading", label: "Trading Desk", icon: TrendingUp },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/sessions", label: "Sessions", icon: History },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/logs", label: "Logs", icon: Terminal },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/reliability", label: "Reliability", icon: Shield },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/system", label: "System", icon: Monitor },
  { href: "/cron", label: "Cron", icon: Clock },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Dock() {
  const pathname = usePathname();

  return (
    <aside
      className="dock"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: "68px",
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 6px",
        gap: "2px",
        zIndex: 50,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {dockItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className="dock-item group relative"
            style={{
              width: "56px",
              height: "52px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "3px",
              borderRadius: "8px",
              backgroundColor: isActive ? "var(--accent-soft)" : "transparent",
              transition: "all 150ms ease",
              position: "relative",
              textDecoration: "none",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = "var(--surface-hover)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            {/* Icon */}
            <Icon
              style={{
                width: "20px",
                height: "20px",
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                strokeWidth: isActive ? 2.5 : 2,
              }}
            />

            {/* Label */}
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "8px",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "52px",
              }}
            >
              {item.label.split(" ")[0]}
            </span>

            {/* Tooltip - shown on hover via CSS */}
            <span
              className="absolute left-[72px] top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg text-sm whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
              style={{
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </aside>
  );
}
