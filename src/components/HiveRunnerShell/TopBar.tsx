"use client";

import { useState, useEffect, useRef } from "react";
import { Settings, LogOut, ChevronDown, Eye, EyeOff } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { useDemoMode } from "@/lib/demo-mode";
import Link from "next/link";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "./Dock";
import { useDockCollapsed } from "@/lib/dock-state";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const LOCAL_OWNER_LABEL = "Local Owner";
const LOCAL_OWNER_INITIAL = "O";

export function TopBar() {
  const [showSearch, setShowSearch] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { collapsed: dockCollapsed } = useDockCollapsed();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { isDemoMode, toggleDemoMode } = useDemoMode();

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
          backgroundColor: "var(--bg)",
          borderBottom: "0.5px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          zIndex: 45,
        }}
      >
        {/* Left: Breadcrumb navigation */}
        <div style={{ paddingLeft: "10px", minWidth: 0, flex: 1 }}>
          <PageBreadcrumbs inline />
        </div>

        {/* Right: Demo Toggle + Notifications + User */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexShrink: 0, minWidth: 0 }}>
          {/* Demo Mode Toggle */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {isDemoMode && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "1.5px",
                  color: "var(--accent)",
                  fontFamily: "var(--font-heading)",
                  textTransform: "uppercase" as const,
                }}
              >
                DEMO MODE
              </span>
            )}
            <button
              type="button"
              onClick={toggleDemoMode}
              title={isDemoMode ? "Exit demo mode" : "Enter demo mode — hide sensitive data"}
              className="flex items-center justify-center transition-all"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                backgroundColor: isDemoMode ? "var(--accent-soft)" : "transparent",
                border: isDemoMode ? "0.5px solid var(--border-strong)" : "0.5px solid transparent",
                color: isDemoMode ? "var(--accent)" : "var(--text-muted)",
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

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notifications Dropdown */}
          <NotificationDropdown />

          {/* User Area with Dropdown */}
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{
                appearance: "none",
                WebkitAppearance: "none",
                cursor: "pointer",
                height: "32px",
                padding: "2px 8px 2px 4px",
                borderRadius: "8px",
                border: "0.5px solid transparent",
                backgroundColor: showUserMenu ? "var(--surface-elevated)" : "transparent",
                color: "var(--text-secondary)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: "8px",
                flexShrink: 0,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "14px",
                  backgroundColor: "var(--surface-elevated)",
                  border: "0.5px solid var(--border-strong)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
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
                  {LOCAL_OWNER_INITIAL}
                </span>
              </div>
              {/* Name */}
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  display: "inline-block",
                  lineHeight: "14px",
                }}
              >
                {LOCAL_OWNER_LABEL}
              </span>
              <ChevronDown style={{ width: "12px", height: "12px", color: "var(--text-muted)", flexShrink: 0 }} />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  width: "180px",
                  backgroundColor: "var(--surface-elevated)",
                  border: "0.5px solid var(--border)",
                  borderRadius: "10px",
                  padding: "4px",
                  zIndex: 100,
                  boxShadow: "var(--shadow-glass)",
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
                <div style={{ height: "0.5px", backgroundColor: "var(--border)", margin: "4px 0" }} />
                <button
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                  className="flex items-center gap-2 w-full transition-colors"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    color: "var(--negative)",
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
            backgroundColor: "color-mix(in srgb, var(--bg) 78%, transparent)",
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
