"use client";

/**
 * HiveRunner - Shared UI Primitives
 *
 * Reusable building blocks that enforce the design standard.
 * Use these instead of reinventing section headers, cards, badges,
 * buttons, and empty states on every page.
 *
 * See docs/design-system-standard.md for usage guidance.
 */

import React from "react";
import { color, type, space, radius, font } from "./tokens";

/* ─── PageHeader ─── */

interface PageHeaderProps {
  /** Page title text */
  title: string;
  /** Optional icon element (Lucide icon, emoji, etc.) */
  icon?: React.ReactNode;
  /** Optional right-side actions */
  actions?: React.ReactNode;
  /** Optional description below the title */
  description?: string;
}

/**
 * Standard page header. Use once at the top of every company-scoped page.
 *
 * ```tsx
 * <PageHeader
 *   icon={<Settings size={16} />}
 *   title="Company Settings"
 *   actions={<ActionButton label="Save" onClick={save} />}
 * />
 * ```
 */
export function PageHeader({ title, icon, actions, description }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: space.xl }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          {icon && (
            <span style={{ color: color.accent, display: "flex", alignItems: "center" }}>
              {icon}
            </span>
          )}
          <h1 style={{
            margin: 0,
            fontSize: type.pageTitle.size,
            fontWeight: type.pageTitle.weight,
            letterSpacing: type.pageTitle.letterSpacing,
            fontFamily: font.heading,
            color: color.text,
          }}>
            {title}
          </h1>
        </div>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            {actions}
          </div>
        )}
      </div>
      {description && (
        <p style={{
          margin: `${space.sm}px 0 0`,
          fontSize: type.body.size,
          color: color.textSecondary,
          lineHeight: type.body.lineHeight,
        }}>
          {description}
        </p>
      )}
    </div>
  );
}

/* ─── Section ─── */

interface SectionProps {
  /** Uppercase section label */
  title: string;
  /** Optional right-side actions or counts */
  trailing?: React.ReactNode;
  /** Section contents */
  children: React.ReactNode;
  /** Whether to wrap children in a card container (default: true) */
  card?: boolean;
}

/**
 * Standard section with uppercase label and optional card container.
 *
 * ```tsx
 * <Section title="General">
 *   <p>Content here</p>
 * </Section>
 * ```
 */
export function Section({ title, trailing, children, card = true }: SectionProps) {
  return (
    <div style={{ marginBottom: space.xl }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: space.md,
      }}>
        <span style={{
          fontSize: type.sectionLabel.size,
          fontWeight: type.sectionLabel.weight,
          letterSpacing: type.sectionLabel.letterSpacing,
          textTransform: "uppercase",
          color: color.textMuted,
        }}>
          {title}
        </span>
        {trailing && (
          <span style={{ fontSize: type.caption.size, color: color.textMuted }}>
            {trailing}
          </span>
        )}
      </div>
      {card ? (
        <div style={{
          padding: `${space.lg}px ${space.xl}px`,
          borderRadius: radius.lg,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
        }}>
          {children}
        </div>
      ) : children}
    </div>
  );
}

/* ─── Card ─── */

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Make the card hoverable (subtle border highlight) */
  hoverable?: boolean;
  onClick?: () => void;
}

/**
 * Standard card container.
 */
export function Card({ children, style, hoverable, onClick }: CardProps) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={hoverable ? () => setHovered(true) : undefined}
      onMouseLeave={hoverable ? () => setHovered(false) : undefined}
      style={{
        padding: `${space.lg}px ${space.xl}px`,
        borderRadius: radius.lg,
        border: `0.5px solid ${hovered ? color.borderStrong : color.border}`,
        background: color.surface,
        cursor: onClick ? "pointer" : undefined,
        transition: "border-color 0.15s",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ─── PropRow ─── */

interface PropRowProps {
  /** Left-side label */
  label: string;
  /** Right-side value */
  children: React.ReactNode;
}

/**
 * Label–value row for settings and configuration displays.
 *
 * ```tsx
 * <PropRow label="Workspace root">
 *   <span style={{ fontFamily: font.mono }}>~/.hiverunner/workspace</span>
 * </PropRow>
 * ```
 */
export function PropRow({ label, children }: PropRowProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: `${space.sm}px 0`,
    }}>
      <span style={{ fontSize: type.bodySmall.size, color: color.textMuted }}>{label}</span>
      <div style={{ fontSize: type.bodySmall.size }}>{children}</div>
    </div>
  );
}

/* ─── Badge ─── */

interface BadgeProps {
  /** Badge label text */
  label: string;
  /** Semantic tone */
  tone?: "default" | "accent" | "positive" | "negative" | "warning" | "info";
}

const badgeTones: Record<string, { bg: string; fg: string }> = {
  default: { bg: "rgba(255,255,255,0.06)", fg: color.textSecondary },
  accent: { bg: color.accentSoft, fg: color.accent },
  positive: { bg: color.positiveSoft, fg: color.positive },
  negative: { bg: color.negativeSoft, fg: color.negative },
  warning: { bg: color.warningSoft, fg: color.warning },
  info: { bg: color.infoSoft, fg: color.info },
};

/**
 * Inline status/category badge.
 *
 * ```tsx
 * <Badge label="Active" tone="positive" />
 * ```
 */
export function Badge({ label, tone = "default" }: BadgeProps) {
  const t = badgeTones[tone] ?? badgeTones.default;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: `2px ${space.sm}px`,
      borderRadius: radius.sm,
      fontSize: type.caption.size,
      fontWeight: type.caption.weight,
      background: t.bg,
      color: t.fg,
    }}>
      {label}
    </span>
  );
}

/* ─── ActionButton ─── */

interface ActionButtonProps {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  /** "primary" = accent fill, "secondary" = surface outline, "ghost" = borderless */
  variant?: "primary" | "secondary" | "ghost";
  /** "sm" | "md" */
  size?: "sm" | "md";
}

/**
 * Standard button. Prefer this over ad-hoc styled buttons.
 */
export function ActionButton({
  label, icon, onClick, href, disabled,
  variant = "secondary", size = "md",
}: ActionButtonProps) {
  const py = size === "sm" ? 5 : 8;
  const px = size === "sm" ? 12 : 18;
  const fs = size === "sm" ? 12 : 13;

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: color.accent,
      border: "none",
      color: "#000",
      fontWeight: 600,
    },
    secondary: {
      background: color.surface,
      border: `0.5px solid ${color.border}`,
      color: color.text,
      fontWeight: 500,
    },
    ghost: {
      background: "transparent",
      border: "none",
      color: color.textSecondary,
      fontWeight: 500,
    },
  };

  const Tag = href ? "a" : "button";
  const extraProps = href
    ? { href, style: { textDecoration: "none" } }
    : { type: "button" as const, disabled };

  return (
    <Tag
      onClick={!disabled ? onClick : undefined}
      {...(extraProps as Record<string, unknown>)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.sm,
        padding: `${py}px ${px}px`,
        borderRadius: radius.md,
        fontSize: fs,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "border-color 0.15s, opacity 0.15s",
        ...variants[variant],
        ...(href ? { textDecoration: "none" } : {}),
      }}
    >
      {icon}
      {label}
    </Tag>
  );
}

/* ─── IconButton ─── */

interface IconButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** "primary" = accent fill, "secondary" = surface outline, "ghost" = borderless */
  variant?: "primary" | "secondary" | "ghost";
  /** "sm" | "md" */
  size?: "sm" | "md";
}

/**
 * Square icon-only button for compact tool and item actions.
 */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  busy,
  variant = "secondary",
  size = "md",
}: IconButtonProps) {
  const dimension = size === "sm" ? 30 : 34;

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: color.accent,
      border: "none",
      color: "#000",
    },
    secondary: {
      background: color.surface,
      border: `0.5px solid ${color.border}`,
      color: color.text,
    },
    ghost: {
      background: "transparent",
      border: "none",
      color: color.textSecondary,
    },
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      title={label}
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      style={{
        width: dimension,
        height: dimension,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flex: "0 0 auto",
        transition: "border-color 0.15s, opacity 0.15s",
        ...variants[variant],
      }}
    >
      {icon}
    </button>
  );
}

/* ─── EmptyState ─── */

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

/**
 * Standard empty state for pages/sections with no data.
 *
 * ```tsx
 * <EmptyState icon={<Inbox size={24} />} title="No messages" description="Check back later." />
 * ```
 */
export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: `${space.xxxl}px ${space.xl}px`,
      textAlign: "center",
    }}>
      {icon && (
        <div style={{ color: color.textMuted, marginBottom: space.md }}>
          {icon}
        </div>
      )}
      <div style={{
        fontSize: type.body.size,
        fontWeight: 500,
        color: color.textSecondary,
        marginBottom: space.xs,
      }}>
        {title}
      </div>
      {description && (
        <div style={{
          fontSize: type.bodySmall.size,
          color: color.textMuted,
          maxWidth: 320,
          lineHeight: type.bodySmall.lineHeight,
        }}>
          {description}
        </div>
      )}
    </div>
  );
}

/* ─── InfoNote ─── */

interface InfoNoteProps {
  children: React.ReactNode;
  tone?: "default" | "warning" | "error";
}

/**
 * Informational note / callout — for caveats, limitations, and advisories.
 */
export function InfoNote({ children, tone = "default" }: InfoNoteProps) {
  const bg = tone === "warning" ? color.warningSoft
    : tone === "error" ? color.negativeSoft
    : "rgba(255,255,255,0.03)";
  const borderColor = tone === "warning" ? "rgba(245,158,11,0.2)"
    : tone === "error" ? "rgba(239,68,68,0.2)"
    : color.border;

  return (
    <div style={{
      padding: `${space.md}px ${space.lg}px`,
      borderRadius: radius.md,
      background: bg,
      border: `0.5px solid ${borderColor}`,
      fontSize: type.bodySmall.size,
      color: color.textMuted,
      lineHeight: type.bodySmall.lineHeight,
    }}>
      {children}
    </div>
  );
}
