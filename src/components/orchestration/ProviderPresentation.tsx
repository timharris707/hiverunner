"use client";

/**
 * Mission Control — Shared Provider Presentation Components
 *
 * Canonical presentation atoms for provider identity, tier badges,
 * capability rows, and availability badges. Used by both the
 * Configuration tab and the Run Detail surface so they speak
 * exactly the same visual language.
 *
 * These components consume the shared ProviderPresentationInfo
 * type defined in adapters/types.ts. They do NOT import adapter
 * implementations or the registry — they are pure presentation.
 */

import { A } from "@/app/(dashboard)/companies/[slug]/agents/[agentId]/layout";
import type {
  ObservabilityTier,
  ProviderAvailability,
} from "@/lib/orchestration/adapters/types";

/* ── Capability Labels ── */

/**
 * Canonical labels for each capability dimension.
 * Used by both configuration and run detail surfaces.
 * Order matters: rendered in this order.
 */
export const CAPABILITY_LABELS: Array<{
  key: keyof import("@/lib/orchestration/adapters/types").ProviderCapabilities;
  label: string;
}> = [
  { key: "liveText", label: "Live text streaming" },
  { key: "actionDetection", label: "Action detection" },
  { key: "structuredTools", label: "Structured tool events" },
  { key: "thinking", label: "Thinking / reasoning" },
  { key: "runSteering", label: "Run steering" },
  { key: "persistedTranscript", label: "Persisted transcript" },
];

/* ── Tier Badge ── */

/**
 * Compact tier badge (e.g. "T3") — same styling everywhere.
 */
export function TierBadge({ tier }: { tier: ObservabilityTier }) {
  return (
    <span style={{
      fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
      color: A.accent, background: "rgba(217,119,6,0.1)",
    }}>
      T{tier}
    </span>
  );
}

/* ── Capability Row ── */

/**
 * Single capability indicator row.
 * Green dot = available, muted dot + "unavailable" = not available.
 * Identical rendering on configuration and run detail surfaces.
 */
export function CapabilityRow({ label, available }: { label: string; available: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0" }}>
      <div style={{
        width: 5, height: 5, borderRadius: "50%",
        background: available ? "#22c55e" : "rgba(120,113,108,0.35)",
      }} />
      <span style={{ color: available ? A.textSec : A.muted, fontSize: 11 }}>
        {label}
      </span>
      {!available && (
        <span style={{ fontSize: 9, color: "rgba(120,113,108,0.45)", marginLeft: "auto" }}>
          unavailable
        </span>
      )}
    </div>
  );
}

/* ── Capability Grid ── */

/**
 * Full 2-column capability grid, derived from a ProviderCapabilities object.
 * Renders all 6 canonical capability rows using CAPABILITY_LABELS order.
 * This is the canonical way to render capabilities — no ad-hoc label lists.
 */
export function CapabilityGrid({
  capabilities,
}: {
  capabilities: import("@/lib/orchestration/adapters/types").ProviderCapabilities;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
      {CAPABILITY_LABELS.map(({ key, label }) => (
        <CapabilityRow key={key} label={label} available={capabilities[key]} />
      ))}
    </div>
  );
}

/* ── Availability Badge ── */

/**
 * Status badge for provider comparison: Active / Available / Limited / Planned.
 */
export function AvailabilityBadge({ availability }: { availability: ProviderAvailability }) {
  const config: Record<ProviderAvailability, { label: string; bg: string; color: string; border: string }> = {
    active: {
      label: "Active",
      bg: "rgba(34,197,94,0.1)",
      color: "#22c55e",
      border: "rgba(34,197,94,0.25)",
    },
    available: {
      label: "Available",
      bg: "rgba(217,119,6,0.08)",
      color: A.accentLight,
      border: "rgba(217,119,6,0.2)",
    },
    limited: {
      label: "Limited",
      bg: "rgba(234,179,8,0.08)",
      color: "#eab308",
      border: "rgba(234,179,8,0.2)",
    },
    planned: {
      label: "Planned",
      bg: "rgba(120,113,108,0.08)",
      color: A.muted,
      border: "rgba(120,113,108,0.2)",
    },
  };
  const c = config[availability];
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, padding: "1px 7px", borderRadius: 3,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {c.label}
    </span>
  );
}
