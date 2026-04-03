"use client";

import { useState, useEffect, useRef } from "react";
import { Settings, LogOut, ChevronDown, Eye, EyeOff } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { useDemoMode } from "@/lib/demo-mode";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { listCompanies, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "./Dock";
import { useDockCollapsed } from "@/lib/dock-state";

type ActiveCompany = {
  name: string;
  prefix: string;
};

function companyPrefix(company: OrchestrationCompany): string {
  const initials = company.name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
  if (initials.length >= 2) return initials;
  return company.slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "ORG";
}

export function TopBar() {
  const [showSearch, setShowSearch] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { collapsed: dockCollapsed } = useDockCollapsed();
  const [activeCompany, setActiveCompany] = useState<ActiveCompany | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { isDemoMode, toggleDemoMode } = useDemoMode();
  const pathname = usePathname();

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      // Escape to close search
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  useEffect(() => {
    let cancelled = false;
    const segments = pathname.split("/").filter(Boolean);
    const root = segments[0];

    const resolveActiveCompany = async () => {
      if (root !== "companies" && root !== "projects") {
        setActiveCompany(null);
        return;
      }

      const companies = await listCompanies();
      if (cancelled) return;

      if (root === "companies" && segments[1]) {
        const current = companies.find((company) => company.slug === segments[1]);
        if (!current) {
          setActiveCompany(null);
          return;
        }
        setActiveCompany({
          name: current.name,
          prefix: companyPrefix(current),
        });
        return;
      }

      if (root === "projects" && segments[1]) {
        const projects = await listProjects();
        if (cancelled) return;
        const project = projects.find(
          (row) => row.id === segments[1] || row.slug === segments[1]
        );
        if (!project?.companyId) {
          setActiveCompany(null);
          return;
        }
        const current = companies.find((company) => company.id === project.companyId);
        if (!current) {
          setActiveCompany(null);
          return;
        }
        setActiveCompany({
          name: current.name,
          prefix: companyPrefix(current),
        });
        return;
      }

      setActiveCompany(null);
    };

    void resolveActiveCompany();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <>
      <div
        className="top-bar"
        style={{
          position: "fixed",
          top: 0,
          left: isMobile ? 0 : `${dockCollapsed ? DOCK_COLLAPSED_WIDTH : DOCK_WIDTH}px`,
          right: 0,
          height: "48px",
          backgroundColor: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          zIndex: 45,
        }}
      >
        {/* Left: Logo & Brand */}
        <div className="flex items-center gap-3" style={{ paddingLeft: "10px" }}>
          <span style={{ fontSize: "18px" }}>⚡</span>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.3px",
            }}
          >
            Never Idle
          </h1>
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--accent)",
              letterSpacing: "1.5px",
              textTransform: "uppercase" as const,
            }}
          >
            Mission Control
          </span>
          <span style={{ color: "var(--border)", fontSize: "14px", margin: "0 4px" }}>|</span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "12px",
              fontWeight: 600,
              fontStyle: "italic",
              color: "var(--text-secondary)",
              letterSpacing: "0.3px",
            }}
          >
            &ldquo;Build an autonomous organization that produces value 24/7&rdquo;
          </span>
          {activeCompany ? (
            <>
              <span style={{ color: "var(--border)", fontSize: "14px", margin: "0 4px" }}>|</span>
              <div
                className="hidden md:inline-flex"
                style={{
                  alignItems: "center",
                  gap: "6px",
                  borderRadius: "999px",
                  border: "1px solid rgba(56,189,248,0.35)",
                  background: "rgba(8,47,73,0.5)",
                  padding: "2px 10px",
                }}
              >
                <span
                  style={{
                    color: "#a5f3fc",
                    fontSize: "10px",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Active Company
                </span>
                <span style={{ color: "#e2e8f0", fontSize: "12px", fontWeight: 600 }}>{activeCompany.name}</span>
                <span
                  style={{
                    color: "#67e8f9",
                    fontSize: "10px",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  {activeCompany.prefix}
                </span>
              </div>
            </>
          ) : null}
        </div>

        {/* Right: Demo Toggle + Notifications + User */}
        <div className="flex items-center gap-3">
          {/* Demo Mode Toggle */}
          <div className="flex items-center gap-2">
            {isDemoMode && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "1.5px",
                  color: "#f59e0b",
                  fontFamily: "var(--font-heading)",
                  textTransform: "uppercase" as const,
                }}
              >
                DEMO MODE
              </span>
            )}
            <button
              onClick={toggleDemoMode}
              title={isDemoMode ? "Exit demo mode" : "Enter demo mode — hide sensitive data"}
              className="flex items-center justify-center transition-all"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                backgroundColor: isDemoMode ? "#f59e0b20" : "transparent",
                border: isDemoMode ? "1px solid #f59e0b40" : "1px solid transparent",
                color: isDemoMode ? "#f59e0b" : "var(--text-muted)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isDemoMode) {
                  e.currentTarget.style.backgroundColor = "var(--surface-elevated)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isDemoMode) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              {isDemoMode ? <EyeOff style={{ width: "16px", height: "16px" }} /> : <Eye style={{ width: "16px", height: "16px" }} />}
            </button>
          </div>

          {/* Notifications Dropdown */}
          <NotificationDropdown />

          {/* User Area with Dropdown */}
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 transition-all"
              style={{
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "8px",
                backgroundColor: showUserMenu ? "var(--surface-elevated)" : "transparent",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "14px",
                  backgroundColor: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  T
                </span>
              </div>
              {/* Name */}
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                }}
              >
                Tim
              </span>
              <ChevronDown style={{ width: "12px", height: "12px", color: "var(--text-muted)" }} />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  width: "180px",
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "4px",
                  zIndex: 100,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                }}
              >
                <Link
                  href="/settings"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 transition-colors"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    color: "var(--text-secondary)",
                    fontSize: "13px",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <Settings style={{ width: "14px", height: "14px" }} />
                  Settings
                </Link>
                <div style={{ height: "1px", backgroundColor: "var(--border)", margin: "4px 0" }} />
                <button
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                  className="flex items-center gap-2 w-full transition-colors"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    color: "var(--error, #ef4444)",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <LogOut style={{ width: "14px", height: "14px" }} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global Search Modal */}
      {showSearch && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.8)",
          }}
          onClick={() => setShowSearch(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "90%",
              maxWidth: "42rem",
            }}
          >
            <GlobalSearch />
          </div>
        </div>
      )}
    </>
  );
}
