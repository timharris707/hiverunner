"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
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
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  shortLabel: string;
  collapsible: boolean;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    id: "command",
    label: "Command",
    shortLabel: "CMD",
    collapsible: false,
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/tasks", label: "Task Board", icon: Kanban },
      { href: "/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    shortLabel: "OPS",
    collapsible: true,
    items: [
      { href: "/trading", label: "Trading Desk", icon: TrendingUp },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/workflows", label: "Workflows", icon: Workflow },
      { href: "/cron", label: "Cron Jobs", icon: Clock },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    shortLabel: "INTEL",
    collapsible: true,
    items: [
      { href: "/memory", label: "Memory", icon: Brain },
      { href: "/files", label: "Files", icon: FolderOpen },
      { href: "/search", label: "Search", icon: Search },
      { href: "/reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    shortLabel: "INFRA",
    collapsible: true,
    items: [
      { href: "/sessions", label: "Sessions", icon: History },
      { href: "/logs", label: "Logs", icon: Terminal },
      { href: "/system", label: "System", icon: Monitor },
      { href: "/costs", label: "Costs", icon: DollarSign },
      { href: "/reliability", label: "Reliability", icon: Shield },
    ],
  },
];

const settingsItem: NavItem = { href: "/settings", label: "Settings", icon: Settings };

const STORAGE_KEY = "dock-group-state";

function loadGroupState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGroupState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// Standalone nav item component to avoid TypeScript inference issues
function DockNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const shortLabel = item.label.split(" ")[0];

  return (
    <Link
      href={item.href}
      className="dock-item group relative"
      title={item.label}
      style={{
        width: "100%",
        height: "44px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2px",
        borderRadius: "8px",
        backgroundColor: active ? "var(--accent-soft)" : "transparent",
        transition: "all 150ms ease",
        textDecoration: "none",
        flexShrink: 0,
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
      {/* Active indicator bar */}
      {active && (
        <div
          style={{
            position: "absolute",
            left: "-6px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "3px",
            height: "20px",
            backgroundColor: "var(--accent)",
            borderRadius: "0 2px 2px 0",
          }}
        />
      )}

      <Icon
        size={16}
        strokeWidth={active ? 2.5 : 2}
        color={active ? "var(--accent)" : "var(--text-secondary)"}
        style={{ flexShrink: 0 }}
      />

      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "8px",
          fontWeight: active ? 700 : 500,
          color: active ? "var(--accent)" : "var(--text-muted)",
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "52px",
          lineHeight: 1,
        }}
      >
        {shortLabel}
      </span>

      {/* Hover tooltip */}
      <span
        className="absolute left-[66px] top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
        style={{
          backgroundColor: "var(--surface-elevated)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          fontWeight: 500,
        }}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Dock() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    operations: true,
    intelligence: true,
    infrastructure: true,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = loadGroupState();
    setOpenGroups((prev) => ({ ...prev, ...saved }));
    setMounted(true);
  }, []);

  const checkActive = useCallback(
    (item: NavItem) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(item.href + "/"),
    [pathname]
  );

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveGroupState(next);
      return next;
    });
  }, []);

  // Auto-expand group if current page is inside it
  useEffect(() => {
    if (!mounted) return;
    navGroups.forEach((group) => {
      if (group.collapsible && group.items.some((item) => checkActive(item))) {
        setOpenGroups((prev) => {
          if (!prev[group.id]) {
            const next = { ...prev, [group.id]: true };
            saveGroupState(next);
            return next;
          }
          return prev;
        });
      }
    });
  }, [pathname, mounted, checkActive]);

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
        alignItems: "stretch",
        padding: "8px 0",
        paddingBottom: "40px",
        zIndex: 50,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* Nav Groups */}
      <div style={{ flex: 1 }}>
        {navGroups.map((group, groupIndex) => {
          const isOpen = !group.collapsible || openGroups[group.id] !== false;
          const hasActiveItem = group.items.some((item) => checkActive(item));

          return (
            <div key={group.id}>
              {/* Divider between groups */}
              {groupIndex > 0 && (
                <div
                  style={{
                    height: "1px",
                    backgroundColor: "var(--border)",
                    margin: "4px 10px",
                    opacity: 0.6,
                  }}
                />
              )}

              {/* Collapsible group header */}
              {group.collapsible && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="group relative"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "3px 8px 3px 10px",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: "4px",
                    marginBottom: "2px",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: hasActiveItem ? "var(--accent)" : "var(--text-muted)",
                      fontFamily: "var(--font-body)",
                      opacity: 0.85,
                    }}
                  >
                    {group.shortLabel}
                  </span>
                  {isOpen ? (
                    <ChevronDown size={10} color="var(--text-muted)" style={{ opacity: 0.7 }} />
                  ) : (
                    <ChevronRight
                      size={10}
                      color={hasActiveItem ? "var(--accent)" : "var(--text-muted)"}
                      style={{ opacity: hasActiveItem ? 1 : 0.7 }}
                    />
                  )}

                  {/* Tooltip */}
                  <span
                    className="absolute left-[72px] top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
                    style={{
                      backgroundColor: "var(--surface-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {isOpen ? "Collapse" : "Expand"} {group.label}
                  </span>
                </button>
              )}

              {/* Group items */}
              {isOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1px", padding: "0 6px" }}>
                  {group.items.map((item) => (
                    <DockNavItem key={item.href} item={item} active={checkActive(item)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Settings — always pinned to bottom */}
      <div
        style={{
          padding: "6px 6px 0",
          borderTop: "1px solid var(--border)",
          marginTop: "4px",
        }}
      >
        <DockNavItem item={settingsItem} active={checkActive(settingsItem)} />
      </div>
    </aside>
  );
}
