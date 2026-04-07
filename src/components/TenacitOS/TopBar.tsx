"use client";

import { useState, useEffect, useRef } from "react";
import { Settings, LogOut, ChevronDown, Eye, EyeOff } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationDropdown } from "@/components/NotificationDropdown";
import { useDemoMode } from "@/lib/demo-mode";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "./Dock";
import { useDockCollapsed } from "@/lib/dock-state";

export function TopBar() {
  const [showSearch, setShowSearch] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { collapsed: dockCollapsed } = useDockCollapsed();
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
        {/* Left: Brand */}
        <div className="flex items-center gap-3" style={{ paddingLeft: "10px" }}>
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "0.02em",
            }}
          >
            Mission Control
          </span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "12px",
              fontWeight: 400,
              color: "var(--text-muted)",
              marginLeft: "12px",
            }}
          >
            Build an autonomous organization that produces value 24/7
          </span>
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
                  backgroundColor: "var(--surface-elevated)",
                  border: "0.5px solid var(--border-strong)",
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
                  backgroundColor: "var(--surface-elevated)",
                  border: "0.5px solid var(--border)",
                  borderRadius: "10px",
                  padding: "4px",
                  zIndex: 100,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
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
