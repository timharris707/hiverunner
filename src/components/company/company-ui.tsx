"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
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
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-md md:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
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
            This will permanently erase all projects, agents, tasks, and the complete physical file workspace associated with this company.
          </p>
          <p className="mt-2 text-center text-sm font-semibold text-rose-300">
            This action cannot be undone.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
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
  accentColor = "#d97706",
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  accentColor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <section
        className="overflow-hidden rounded-3xl border p-5 shadow-[0_20px_50px_rgba(2,6,23,0.55)] backdrop-blur-2xl md:p-8"
        style={{
          borderColor: "rgba(120,113,108,0.28)",
          background: `radial-gradient(circle at 12% 18%, ${withAlpha(accentColor, 0.24)}, transparent 30%), radial-gradient(circle at 88% 0%, rgba(146,64,14,0.18), transparent 34%), linear-gradient(145deg, rgba(41,37,36,0.92), rgba(12,10,9,0.97))`,
        }}
      >
        <p className="text-[11px] uppercase tracking-[0.24em] text-stone-300/70">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-50">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-300">{description}</p>
      </section>
      {children}
    </div>
  );
}

export function CompanyErrorState({
  title,
  detail,
  href,
}: {
  title: string;
  detail: string;
  href?: string;
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
                Back to dashboard
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
  accentColor = "#d97706",
}: {
  label: string;
  value: string | number;
  detail?: string;
  accentColor?: string;
}) {
  return (
    <div
      className="rounded-2xl border p-4 backdrop-blur-xl"
      style={{
        borderColor: withAlpha(accentColor, 0.24),
        background: `linear-gradient(180deg, ${withAlpha(accentColor, 0.14)}, rgba(28,25,23,0.84))`,
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-stone-50">{value}</p>
      {detail ? <p className="mt-2 text-sm text-stone-400">{detail}</p> : null}
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
