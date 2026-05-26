"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

export function DeleteCompanyModal({
  open,
  onClose,
  onConfirm,
  companyName,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  companyName: string;
  busy: boolean;
}) {
  const [confirmationValue, setConfirmationValue] = useState("");
  const handleClose = useCallback(() => {
    setConfirmationValue("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose, busy]);

  if (!open) return null;

  const normalizedCompanyName = companyName.trim();
  const canConfirm = !busy && confirmationValue.trim() === normalizedCompanyName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-md md:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete company"
        className="w-full max-w-lg rounded-3xl border border-rose-500/20 bg-[radial-gradient(circle_at_top,rgba(225,29,72,0.15),transparent_38%),linear-gradient(165deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.8)] md:p-6"
      >
        <div className="mb-4">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-center text-xl font-semibold text-white">Delete {companyName}?</h2>
          <p className="mt-2 text-center text-sm text-slate-300">
            This will permanently remove the company from HiveRunner and destroy its company-scoped resources.
          </p>
          <ul className="mt-4 space-y-2 rounded-2xl border border-rose-500/15 bg-black/20 px-4 py-3 text-left text-sm text-slate-200">
            <li>Remove the company record and related company data from HiveRunner.</li>
            <li>Delete the company workspace from disk.</li>
            <li>Remove associated runtime registrations for this company.</li>
          </ul>
          <p className="mt-4 text-center text-sm font-semibold text-rose-300">
            This action cannot be undone.
          </p>
        </div>

        <label className="block rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <span className="mb-2 block text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
            Type the company name to confirm
          </span>
          <input
            autoFocus
            type="text"
            value={confirmationValue}
            onChange={(event) => setConfirmationValue(event.target.value)}
            disabled={busy}
            placeholder={normalizedCompanyName}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
          />
        </label>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="rounded-xl border border-rose-500/40 bg-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-100 shadow-[0_12px_26px_rgba(225,29,72,0.25)] hover:bg-rose-500/30 disabled:opacity-50"
          >
            {busy ? "Deleting..." : "Yes, delete company"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CompanyShell({
  eyebrow,
  title,
  description,
  accentColor: _accentColor,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  accentColor?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ padding: "12px 20px" }}>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{eyebrow}</p>
        <h1 style={{ marginTop: "4px", fontSize: "17px", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>{title}</h1>
        <p style={{ marginTop: "6px", maxWidth: "640px", fontSize: "13px", color: "var(--text-secondary)" }}>{description}</p>
      </div>
      {children}
    </div>
  );
}

export function CompanyErrorState({
  title,
  detail,
  href,
  linkLabel = "Back",
}: {
  title: string;
  detail: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <section className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-slate-100 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-red-500/15 p-2 text-red-200">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="max-w-xl text-sm text-red-100/85">{detail}</p>
            {href ? (
              <Link className="text-sm font-medium text-red-100 underline decoration-red-300/40 underline-offset-4" href={href}>
                {linkLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  accentColor: _accentColor,
}: {
  label: string;
  value: string | number;
  detail?: string;
  accentColor?: string;
}) {
  return (
    <div
      style={{
        borderRadius: "12px",
        border: "0.5px solid var(--border)",
        padding: "16px",
        background: "transparent",
      }}
    >
      <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>{label}</p>
      <p style={{ marginTop: "8px", fontSize: "24px", fontWeight: 600, color: "var(--text-primary)" }}>{value}</p>
      {detail ? <p style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-muted)" }}>{detail}</p> : null}
    </div>
  );
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
