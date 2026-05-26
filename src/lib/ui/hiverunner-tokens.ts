/**
 * HiveRunner design tokens — TypeScript mirror of `colors_and_type.css`.
 *
 * Use this when you need tokens in JS/TS land — chart libraries, inline
 * styles, motion configs, runtime theme switching. The CSS file remains
 * the source of truth at runtime; this is a parallel export so you don't
 * have to read CSS variables from the DOM.
 *
 * If you change a value here, also change it in:
 *   - colors_and_type.css           (system canonical)
 *   - app/src/app/globals.css       (app runtime)
 */

// ─── Surfaces ───────────────────────────────────────────────────────────
export const surfaces = {
  bg:               '#2d2c2c', // canvas (dark default)
  surface:          '#212020', // cards sit DARKER than canvas
  surfaceElevated:  '#2c2b2b', // hover / popover / sheet
  surfaceHover:     '#343333',
} as const;

// ─── Borders ────────────────────────────────────────────────────────────
export const borders = {
  hairline:    'rgba(222,220,209,0.12)', // 0.5px — default
  strong:      'rgba(222,220,209,0.22)', // 0.5px — emphasis
} as const;

// ─── Accent (single brand orange) ───────────────────────────────────────
export const accent = {
  base:   '#d97706',
  hover:  '#e5860a',
  soft:   'rgba(217,119,6,0.10)',
  muted:  'rgba(217,119,6,0.08)',
} as const;

// ─── Text ───────────────────────────────────────────────────────────────
export const text = {
  primary:   '#eae8e4',
  secondary: '#a8a6a0',
  muted:     '#7a7872',
} as const;

// ─── Semantic status ────────────────────────────────────────────────────
export const status = {
  positive:      { base: '#32D74B', soft: 'rgba(50,215,75,0.125)' },
  negative:      { base: '#FF453A', soft: 'rgba(255,69,58,0.125)' },
  warning:       { base: '#FFD60A', soft: 'rgba(255,214,10,0.125)' },
  info:          { base: '#0A84FF', soft: 'rgba(10,132,255,0.125)' },
} as const;

// ─── Activity / event types (used in activity rows + dots) ──────────────
export const types = {
  file:     { base: '#64D2FF', soft: 'rgba(100,210,255,0.125)' },
  search:   { base: '#FFD60A', soft: 'rgba(255,214,10,0.125)' },
  message:  { base: '#32D74B', soft: 'rgba(50,215,75,0.125)' },
  command:  { base: '#BF5AF2', soft: 'rgba(191,90,242,0.125)' },
  cron:     { base: '#FF375F', soft: 'rgba(255,55,95,0.125)'  },
  security: { base: '#FF453A', soft: 'rgba(255,69,58,0.125)'  },
  build:    { base: '#FF9F0A', soft: 'rgba(255,159,10,0.125)' },
} as const;

// ─── Type ───────────────────────────────────────────────────────────────
export const typography = {
  fontHeading: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
  fontBody:    '"Avenir Next", "Segoe UI", system-ui, sans-serif',
  fontMono:    '"SFMono-Regular", "SF Mono", "Menlo", "Consolas", monospace',

  // Sizes (px)
  size: {
    xs: 11,
    sm: 12,
    base: 13,
    md: 15,
    lg: 17,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
  },

  // Weights
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Tracking
  tracking: {
    tight: '-0.01em', // page titles
    normal: '0',
    wide: '0.04em',   // small caps
    wider: '0.08em',  // section labels
  },
} as const;

// ─── Spacing (4px base) ─────────────────────────────────────────────────
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
} as const;

// ─── Radius ─────────────────────────────────────────────────────────────
export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

// ─── Shadow ─────────────────────────────────────────────────────────────
export const shadow = {
  sm:        '0 1px 2px rgba(0,0,0,0.3)',
  md:        '0 4px 6px rgba(0,0,0,0.4)',
  statusbar: '0 -8px 24px rgba(0,0,0,0.18)',
  glass:     '0 12px 32px rgba(12,10,9,0.30)',
  cta:       '0 4px 16px rgba(217,119,6,0.10)',
} as const;

// ─── Motion ─────────────────────────────────────────────────────────────
export const motion = {
  duration: {
    fast:    150,
    normal:  240,
    slow:    360,
    breathe: 2500,
    live:    2200,
  },
  easing: {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',  // Material standard
    enter:    'cubic-bezier(0.22, 1, 0.36, 1)', // soft entry
  },
} as const;

// ─── Combined export ────────────────────────────────────────────────────
export const tokens = {
  surfaces,
  borders,
  accent,
  text,
  status,
  types,
  typography,
  space,
  radius,
  shadow,
  motion,
} as const;

export default tokens;
export type Tokens = typeof tokens;
