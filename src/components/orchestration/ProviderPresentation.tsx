"use client";

/**
 * HiveRunner - Shared Provider Presentation Components
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

import { color } from "@/lib/ui/tokens";
import type {
  ObservabilityTier,
  ProviderAvailability,
} from "@/lib/orchestration/adapters/types";

function tokenMix(token: string, percent: number): string {
  return `color-mix(in srgb, ${token} ${percent.toFixed(0)}%, transparent)`;
}

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
      color: color.warning,
      background: color.warningSoft,
      border: "1px solid rgba(138, 90, 0, 0.24)",
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
        background: available ? color.positive : color.textMuted,
      }} />
      <span style={{ color: available ? color.textSecondary : color.textMuted, fontSize: 11 }}>
        {label}
      </span>
      {!available && (
        <span style={{ fontSize: 9, color: color.textMuted, marginLeft: "auto" }}>
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
      bg: color.positiveSoft,
      color: color.positive,
      border: "rgba(23, 122, 50, 0.22)",
    },
    available: {
      label: "Available",
      bg: color.warningSoft,
      color: color.warning,
      border: "rgba(138, 90, 0, 0.24)",
    },
    limited: {
      label: "Limited",
      bg: color.warningSoft,
      color: color.warning,
      border: "rgba(138, 90, 0, 0.24)",
    },
    planned: {
      label: "Planned",
      bg: tokenMix(color.textMuted, 8),
      color: color.textMuted,
      border: tokenMix(color.textMuted, 20),
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
