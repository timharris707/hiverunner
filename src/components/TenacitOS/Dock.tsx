"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Monitor,
  FolderOpen,
  Brain,
  Bot,
  Clock,
  DollarSign,
  History,
  Kanban,
  TrendingUp,
  Building2,
  CalendarDays,
  Workflow,
  Terminal,
  Search,
  Shield,
  FileBarChart,
  Users,
  Factory,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcutKey?: string;
}

// Flat ordered list with null = separator
const navItems: (NavItem | null)[] = [
  { href: "/", label: "Dashboard", icon: Home, shortcutKey: "1" },
  { href: "/tasks", label: "Task Board", icon: Kanban, shortcutKey: "2" },
  { href: "/agents", label: "Agents", icon: Bot, shortcutKey: "3" },
  { href: "/advisory", label: "Advisory Board", icon: Users, shortcutKey: "4" },
  { href: "/office", label: "3D Office", icon: Building2 },
  { href: "/factory", label: "Factory Floor", icon: Factory },
  null, // separator
  { href: "/trading", label: "Trading Desk", icon: TrendingUp, shortcutKey: "5" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/workflows", label: "Workflows", icon: Workflow, shortcutKey: "6" },
  { href: "/cron", label: "Cron Jobs", icon: Clock },
  null, // separator
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/search", label: "Search", icon: Search },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  null, // separator
  { href: "/sessions", label: "Sessions", icon: History },
  { href: "/logs", label: "Logs", icon: Terminal },
  { href: "/system", label: "System", icon: Monitor },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/reliability", label: "Reliability", icon: Shield },
];

const DOCK_WIDTH = 168;

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.shortcutKey ? `${item.label} (⌘${item.shortcutKey})` : item.label}
      className="dock-nav-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px 6px 14px",
        borderRadius: "6px",
        textDecoration: "none",
        backgroundColor: active ? "var(--accent-soft)" : "transparent",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background-color 120ms ease, border-color 120ms ease",
        cursor: "pointer",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--surface-hover)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
        }
      }}
    >
      <Icon
        size={14}
        strokeWidth={active ? 2.5 : 2}
        color={active ? "var(--accent)" : "var(--text-secondary)"}
        style={{ flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "12px",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--accent)" : "var(--text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.2,
        }}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Dock() {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const checkActive = useCallback(
    (item: NavItem) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(item.href + "/"),
    [pathname]
  );

  // Mobile: bottom tab bar with key pages
  if (isMobile) {
    const mobileItems: NavItem[] = [
      { href: "/", label: "Home", icon: Home },
      { href: "/tasks", label: "Tasks", icon: Kanban },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/trading", label: "Trading", icon: TrendingUp },
      { href: "/workflows", label: "Flows", icon: Workflow },
    ];
    return (
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "56px",
          backgroundColor: "var(--surface)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          zIndex: 50,
          padding: "0 8px",
        }}
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "3px",
                padding: "4px 12px",
                borderRadius: "8px",
                textDecoration: "none",
                backgroundColor: active ? "var(--accent-soft)" : "transparent",
              }}
            >
              <Icon size={20} color={active ? "var(--accent)" : "var(--text-muted)"} strokeWidth={active ? 2.5 : 2} />
              <span style={{ fontSize: "9px", fontWeight: active ? 700 : 500, color: active ? "var(--accent)" : "var(--text-muted)" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside
      className="dock"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: `${DOCK_WIDTH}px`,
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "8px 6px",
        paddingBottom: "40px",
        zIndex: 50,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <nav style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        {navItems.map((item, idx) => {
          if (item === null) {
            return (
              <div
                key={`sep-${idx}`}
                style={{
                  height: "1px",
                  backgroundColor: "var(--border)",
                  margin: "4px 8px",
                  opacity: 0.5,
                }}
              />
            );
          }
          return <NavRow key={item.href} item={item} active={checkActive(item)} />;
        })}
      </nav>
    </aside>
  );
}

export { DOCK_WIDTH };
