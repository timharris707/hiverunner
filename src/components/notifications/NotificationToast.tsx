"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Link from "next/link";

/* ── types ── */
export interface ToastNotification {
  id: string;
  title: string;
  body?: string;
  href?: string;
  hrefLabel?: string;
  /** auto-dismiss in ms (default 6000) */
  ttl?: number;
  /** dot color next to the title */
  dotColor?: string;
}

interface NotificationContextValue {
  push: (n: Omit<ToastNotification, "id">) => void;
}

const NotificationContext = createContext<NotificationContextValue>({ push: () => {} });
export const useNotifications = () => useContext(NotificationContext);

/* ── provider ── */
const MAX_VISIBLE = 5;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const counterRef = useRef(0);

  const push = useCallback((n: Omit<ToastNotification, "id">) => {
    counterRef.current += 1;
    const id = `toast-${counterRef.current}-${Date.now()}`;
    const toast: ToastNotification = { ...n, id };

    setToasts((prev) => {
      const next = [...prev, toast];
      // keep only the most recent MAX_VISIBLE
      return next.length > MAX_VISIBLE ? next.slice(-MAX_VISIBLE) : next;
    });

    // auto-dismiss
    const ttl = n.ttl ?? 6000;
    if (ttl > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ push }}>
      {children}
      {toasts.length > 0 ? (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: 16,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column-reverse",
            gap: 8,
            maxWidth: 340,
            pointerEvents: "none",
          }}
        >
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      ) : null}
    </NotificationContext.Provider>
  );
}

/* ── individual toast card ── */
function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastNotification;
  onDismiss: (id: string) => void;
}) {
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    requestAnimationFrame(() => setEntering(false));
  }, []);

  return (
    <div
      style={{
        pointerEvents: "auto",
        borderRadius: 10,
        border: "1px solid rgba(120,113,108,0.25)",
        background: "rgba(28,25,23,0.97)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        padding: "12px 14px",
        opacity: entering ? 0 : 1,
        transform: entering ? "translateY(12px)" : "translateY(0)",
        transition: "opacity 0.2s ease, transform 0.25s ease",
      }}
    >
      {/* header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {toast.dotColor && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: toast.dotColor,
              flexShrink: 0,
              marginTop: 4,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#f5f5f4",
              lineHeight: 1.3,
            }}
          >
            {toast.title}
          </p>
          {toast.body && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "#a8a29e",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {toast.body}
            </p>
          )}
          {toast.href && (
            <Link
              href={toast.href}
              style={{
                display: "inline-block",
                marginTop: 6,
                fontSize: 12,
                color: "#d6d3d1",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {toast.hrefLabel ?? "View"}
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          style={{
            background: "none",
            border: "none",
            color: "#57534e",
            cursor: "pointer",
            padding: 2,
            display: "flex",
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
