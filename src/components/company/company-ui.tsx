"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export function CompanyShell({
  eyebrow,
  title,
  description,
  accentColor = "#c084fc",
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
          borderColor: "rgba(255,255,255,0.08)",
          background: `radial-gradient(circle at 12% 18%, ${withAlpha(accentColor, 0.22)}, transparent 30%), radial-gradient(circle at 88% 0%, rgba(120,119,198,0.16), transparent 34%), linear-gradient(140deg, rgba(15,23,42,0.96), rgba(2,6,23,0.98))`,
        }}
      >
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-300/70">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">{description}</p>
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
  accentColor = "#38bdf8",
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
        background: `linear-gradient(180deg, ${withAlpha(accentColor, 0.12)}, rgba(15,23,42,0.78))`,
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      {detail ? <p className="mt-2 text-sm text-slate-400">{detail}</p> : null}
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
