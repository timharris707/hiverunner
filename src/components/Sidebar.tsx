"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Timer,
  Brain,
  Search,
  BarChart3,
  FileBarChart,
  FolderOpen,
  Terminal,
  LogOut,
  Settings,
  Menu,
  X,
  Users,
  GitBranch,
  Workflow,
  Server,
  History,
  DollarSign,
  TrendingUp,
  Shield,
  CalendarDays,
} from "lucide-react";
import { getAgentDisplayName } from "@/config/branding";

const navSections = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/tasks", label: "Task Board", icon: GitBranch },
      { href: "/agents", label: "Agents", icon: Users },
      { href: "/trading", label: "Trading Desk", icon: TrendingUp },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/workflows", label: "Workflows", icon: Workflow },
    ],
  },
  {
    items: [
      { href: "/sessions", label: "Sessions", icon: History },
      { href: "/memory", label: "Memory", icon: Brain },
      { href: "/files", label: "Files", icon: FolderOpen },
      { href: "/logs", label: "Logs", icon: Terminal },
    ],
  },
  {
    items: [
      { href: "/costs", label: "Costs", icon: DollarSign },
      { href: "/reliability", label: "Reliability", icon: Shield },
      { href: "/reports", label: "Reports", icon: FileBarChart },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/system", label: "System", icon: Server },
    ],
  },
  {
    items: [
      { href: "/cron", label: "Cron Jobs", icon: Timer },
      { href: "/search", label: "Search", icon: Search },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setIsOpen(false);
      }
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setIsOpen(false);
    }
  }, [pathname, isMobile]);

  useEffect(() => {
    if (isOpen && isMobile) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, isMobile]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={toggleSidebar}
        className="mobile-menu-button"
        aria-label="Toggle menu"
        style={{
          position: "fixed",
          top: "1rem",
          left: "1rem",
          zIndex: 60,
          padding: "0.5rem",
          borderRadius: "0.5rem",
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          display: isMobile ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Overlay for mobile */}
      {isMobile && (
        <div
          onClick={closeSidebar}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 40,
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? "auto" : "none",
            transition: "opacity 0.3s ease",
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        className="sidebar"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "16rem",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "1rem",
          backgroundColor: "var(--card)",
          borderRight: "1px solid var(--border)",
          zIndex: 50,
          transform: isMobile ? (isOpen ? "translateX(0)" : "translateX(-100%)") : "translateX(0)",
          transition: "transform 0.3s ease",
          overflowY: "auto",
        }}
      >
        {/* Close button for mobile */}
        {isMobile && (
          <button
            onClick={closeSidebar}
            aria-label="Close menu"
            style={{
              position: "absolute",
              top: "1rem",
              right: "1rem",
              padding: "0.25rem",
              borderRadius: "0.375rem",
              backgroundColor: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2 py-3 mb-4">
          <Terminal
            className="w-6 h-6"
            style={{ color: "var(--accent)" }}
          />
          <h1
            className="text-base font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--text-primary)",
              letterSpacing: "-0.5px",
            }}
          >
            Mission Control
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 pt-2">
          {navSections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {sectionIndex > 0 && (
                <div
                  style={{
                    height: "1px",
                    backgroundColor: "var(--border)",
                    margin: "8px 8px",
                  }}
                />
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`nav-item w-full ${isActive ? "active" : ""}`}
                        style={
                          !isActive
                            ? { color: "var(--text-secondary)" }
                            : {
                                backgroundColor: "var(--accent)",
                                color: "var(--text-primary)",
                                fontFamily: "var(--font-heading)",
                                fontWeight: 600,
                              }
                        }
                      >
                        <Icon
                          className="w-5 h-5"
                          style={!isActive ? { color: "var(--text-muted)" } : undefined}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="pt-4 mt-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div
            className="px-4 py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            OpenClaw Agent
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2 w-full rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--error)";
              e.currentTarget.style.backgroundColor = "var(--card-elevated)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
