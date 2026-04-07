/**
 * Mission Control Design Tokens
 *
 * Single source of truth for inline-style values. Every page should import
 * from here instead of defining a local `const P = { ... }` palette.
 *
 * These values are intentionally aligned with the CSS custom properties in
 * globals.css. When used in inline styles (React `style` prop), reference
 * this module. When used in CSS/Tailwind, reference the CSS variables.
 *
 * See docs/design-system-standard.md for the full design standard.
 */

/* ─── Color Palette ─── */

export const color = {
  /** Page background — neutral charcoal canvas (lightest layer) */
  bg: "#2d2c2c",
  /** Cards, panels — darker than bg, defined by borders */
  surface: "#212020",
  /** Elevated surfaces (modals, dropdowns, popovers) */
  surfaceElevated: "#2c2b2b",
  /** Hover state for surfaces */
  surfaceHover: "#343333",

  /** Default border — warm, hairline-weight feel */
  border: "rgba(222,220,209,0.12)",
  /** Stronger border (focused inputs, active states) */
  borderStrong: "rgba(222,220,209,0.22)",

  /** Primary text — warm white */
  text: "#eae8e4",
  /** Secondary text — descriptions, metadata, supporting content */
  textSecondary: "#a8a6a0",
  /** Muted text — timestamps, captions, disabled labels */
  textMuted: "#7a7872",

  /** Brand accent (amber) — interactive highlights, active indicators */
  accent: "#d97706",
  /** Accent background — subtle highlight behind accent elements */
  accentSoft: "rgba(217,119,6,0.10)",

  /** Positive/success */
  positive: "#22c55e",
  positiveSoft: "rgba(34,197,94,0.12)",

  /** Negative/error/destructive */
  negative: "#ef4444",
  negativeSoft: "rgba(239,68,68,0.12)",

  /** Warning/caution */
  warning: "#f59e0b",
  warningSoft: "rgba(245,158,11,0.12)",

  /** Info/neutral highlight */
  info: "#3b82f6",
  infoSoft: "rgba(59,130,246,0.12)",
} as const;

/* ─── Typography ─── */

export const font = {
  heading: 'var(--font-heading, "Avenir Next", system-ui, sans-serif)',
  body: 'var(--font-body, "Avenir Next", system-ui, sans-serif)',
  mono: 'var(--font-mono, "SFMono-Regular", "Menlo", monospace)',
} as const;

/**
 * Typography scale. Use these instead of ad-hoc font sizes.
 *
 * Each entry is { size, weight, letterSpacing?, lineHeight? }.
 * Compose with: `style={{ fontSize: type.pageTitle.size, fontWeight: type.pageTitle.weight }}`
 */
export const type = {
  /** Page title — used once per page in the header */
  pageTitle: { size: 17, weight: 600 as const, letterSpacing: "-0.01em" },
  /** Section header — uppercase label above grouped content */
  sectionLabel: { size: 11, weight: 600 as const, letterSpacing: "0.08em" },
  /** Card/item title — primary label in a list row or card */
  cardTitle: { size: 13, weight: 600 as const, letterSpacing: undefined },
  /** Body text — default reading text */
  body: { size: 13, weight: 400 as const, lineHeight: 1.5 },
  /** Small body — descriptions, metadata */
  bodySmall: { size: 12, weight: 400 as const, lineHeight: 1.5 },
  /** Caption — timestamps, tertiary info, badges */
  caption: { size: 11, weight: 500 as const, letterSpacing: undefined },
  /** Metric — large numeric display */
  metric: { size: 24, weight: 700 as const, letterSpacing: "-0.03em" },
  /** Mono — code, IDs, paths */
  mono: { size: 12, weight: 400 as const, letterSpacing: undefined },
} as const;

/* ─── Spacing ─── */

/** Spacing scale (4px base unit) */
export const space = {
  /** 4px — tight internal padding */
  xs: 4,
  /** 8px — default gap, tight padding */
  sm: 8,
  /** 12px — standard padding, comfortable gap */
  md: 12,
  /** 16px — section padding, card padding */
  lg: 16,
  /** 20px — page-level horizontal padding */
  xl: 20,
  /** 24px — generous section spacing */
  xxl: 24,
  /** 32px — major section breaks */
  xxxl: 32,
} as const;

/** Border radius scale */
export const radius = {
  /** 4px — buttons, inputs, badges */
  sm: 4,
  /** 8px — cards, panels, inputs */
  md: 8,
  /** 12px — prominent cards, sections */
  lg: 12,
  /** 9999px — pills, fully rounded */
  full: 9999,
} as const;

/* ─── Shared Style Fragments ─── */

/** Standard card container style */
export const cardStyle: React.CSSProperties = {
  padding: `${space.lg}px ${space.xl}px`,
  borderRadius: radius.lg,
  border: `0.5px solid ${color.border}`,
  background: color.surface,
};

/** Standard section label style (uppercase header above content groups) */
export const sectionLabelStyle: React.CSSProperties = {
  fontSize: type.sectionLabel.size,
  fontWeight: type.sectionLabel.weight,
  letterSpacing: type.sectionLabel.letterSpacing,
  textTransform: "uppercase",
  color: color.textMuted,
  marginBottom: space.md,
};

/** Standard page container style */
export const pageStyle: React.CSSProperties = {
  padding: `${space.lg}px ${space.xl}px`,
  maxWidth: 960,
  color: color.text,
  fontSize: type.body.size,
};

/**
 * Legacy palette compatibility shim.
 *
 * If you're migrating an existing page that uses `const P = { ... }`,
 * replace it with: `import { P } from "@/lib/ui/tokens"`
 *
 * This provides the same property names used by most existing pages
 * but sourced from the canonical token values.
 */
export const P = {
  bg: color.bg,
  surface: color.surface,
  surfaceElevated: color.surfaceElevated,
  surfaceHover: color.surfaceHover,
  card: color.surface,
  cardBorder: color.border,
  cardBorderHover: color.borderStrong,
  text: color.text,
  textSec: color.textSecondary,
  textSecondary: color.textSecondary,
  textMuted: color.textMuted,
  muted: color.textMuted,
  accent: color.accent,
  accentSoft: color.accentSoft,
  accentDim: color.accentSoft,
  success: color.positive,
  successDim: color.positiveSoft,
  error: color.negative,
  errorDim: color.negativeSoft,
  warn: color.warning,
  warnDim: color.warningSoft,
} as const;
