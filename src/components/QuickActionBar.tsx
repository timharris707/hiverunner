"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Network,
  Terminal,
  Command,
  X,
} from "lucide-react";

const ACTIONS = [
  {
    id: "new-company",
    label: "Create Company",
    shortcut: "C",
    icon: Building2,
    href: "/companies/new",
    color: "var(--accent)",
  },
  {
    id: "companies",
    label: "Manage Companies",
    shortcut: "M",
    icon: Network,
    href: "/systems/companies",
    color: "#4ade80",
  },
  {
    id: "terminal",
    label: "Open Terminal",
    shortcut: "J",
    icon: Terminal,
    href: "/terminal",
    color: "#d97706",
  },
];

export function QuickActionBar() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  const handleAction = useCallback(
    (href: string) => {
      router.push(href);
      setVisible(false);
    },
    [router]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd+. to toggle quick action bar
      if (cmdOrCtrl && e.key === ".") {
        e.preventDefault();
        setVisible((v) => !v);
        return;
      }

      // When visible, shortcut keys trigger actions
      if (visible && !cmdOrCtrl && !e.altKey && !e.shiftKey) {
        const action = ACTIONS.find(
          (a) => a.shortcut.toLowerCase() === e.key.toLowerCase()
        );
        if (action) {
          e.preventDefault();
          handleAction(action.href);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setVisible(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, handleAction]);

  return (
    <>
      {/* FAB toggle button */}
      <button
        onClick={() => setVisible((v) => !v)}
        title="Quick Actions (⌘.)"
        style={{
          position: "fixed",
          bottom: "48px",
          right: "24px",
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          backgroundColor: visible ? "var(--card-elevated)" : "var(--accent)",
          border: `1px solid ${visible ? "var(--border)" : "var(--accent)"}`,
          color: visible ? "var(--text-secondary)" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 60,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          transition: "all 150ms ease",
        }}
      >
        {visible ? <X size={20} /> : <Command size={20} />}
      </button>

      {/* Action bar */}
      {visible && (
        <div
          style={{
            position: "fixed",
            bottom: "108px",
            right: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            zIndex: 60,
          }}
        >
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action.href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 16px",
                  borderRadius: "12px",
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  transition: "all 150ms ease",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "var(--card-elevated)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    action.color;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "var(--card)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    "var(--border)";
                }}
              >
                <Icon size={16} color={action.color} />
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {action.label}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    backgroundColor: "var(--card-elevated)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-code)",
                  }}
                >
                  {action.shortcut}
                </span>
              </button>
            );
          })}
          <div
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              textAlign: "right",
              paddingRight: "4px",
            }}
          >
            Toggle: ⌘.
          </div>
        </div>
      )}
    </>
  );
}
