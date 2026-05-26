# Theme Specification — HiveRunner

> **Owner:** HiveRunner
> **Last verified:** 2026-04-03
> **Rule:** NO colored accents (amber, blue, green, red, etc.) unless explicitly approved for a specific use case.

---

## Philosophy

HiveRunner uses a **monochrome stone palette** — warm grays derived from Tailwind's `stone` scale. The UI should feel like polished dark metal, not a candy store. Color is reserved for very specific, intentional moments (status dots, destructive actions) — never for decoration, gradients, or accent fills.

---

## Color Palette

### Backgrounds (darkest → lightest)

| Token | Value | Usage |
|-------|-------|-------|
| `bg-base` | `rgba(12,10,9,...)` / `#0c0a09` | Page background |
| `bg-surface` | `rgba(28,25,23,0.65–0.7)` | Cards, panels, table containers |
| `bg-elevated` | `rgba(41,37,36,0.5–0.55)` | Inputs, buttons, form fields |
| `bg-hover` | `rgba(255,255,255,0.02–0.04)` | Row/item hover states |
| `bg-active` | `rgba(255,255,255,0.12)` | Active page selector (dock) |
| `bg-context` | `rgba(255,255,255,0.05)` | Active context row (dock) |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border-default` | `rgba(120,113,108,0.25)` | Cards, panels, containers |
| `border-subtle` | `rgba(120,113,108,0.18)` | Dividers, table row separators |
| `border-input` | `rgba(120,113,108,0.3)` | Input fields, form controls |
| `border-button` | `rgba(120,113,108,0.35–0.4)` | Buttons |
| `border-active` | `rgba(255,255,255,0.18)` | Active page selector |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#f5f5f4` | Headings, active labels, important values |
| `text-secondary` | `#d6d3d1` | Body text, button labels |
| `text-tertiary` | `#a8a29e` | Descriptions, metadata, icons |
| `text-muted` | `#78716c` | Column headers, timestamps, placeholders |
| `text-faint` | `#57534e` | Disabled text, slug labels |

### Specific Elements

| Element | Style |
|---------|-------|
| Page header container | `border-radius: 20px`, `border: 1px solid rgba(120,113,108,0.25)`, `background: linear-gradient(145deg, rgba(41,37,36,0.88), rgba(20,17,15,0.95))` — NO radial color gradients |
| Stat cards | `border-radius: 14px`, `border: 1px solid rgba(120,113,108,0.25)`, `background: rgba(28,25,23,0.7)` — NO colored gradient fills |
| Table containers | `border-radius: 14px`, `border: 1px solid rgba(120,113,108,0.25)`, `background: rgba(28,25,23,0.65)` |
| Inputs | `border-radius: 10px`, `border: 1px solid rgba(120,113,108,0.3)`, `background: rgba(41,37,36,0.5)` |
| Buttons | `border-radius: 10px`, `border: 1px solid rgba(120,113,108,0.4)`, `background: rgba(41,37,36,0.55)`, `color: #d6d3d1` |
| Button hover | `border: rgba(168,162,158,0.5)`, `background: rgba(68,64,60,0.6)`, `color: #f5f5f4` |
| Column headers | `font-size: 10px`, `font-weight: 700`, `letter-spacing: 0.14em`, `text-transform: uppercase`, `color: #78716c` |
| Section eyebrows | `font-size: 11px`, `letter-spacing: 0.22em`, `text-transform: uppercase`, `color: #78716c` |
| Toggle (on) | Track: `rgba(168,162,158,0.45)`, Knob: `#f5f5f4` |
| Toggle (off) | Track: `rgba(68,64,60,0.4)`, Knob: `#78716c` |

---

## Forbidden

- ❌ Colored gradients in backgrounds (`radial-gradient(...amber...)`, etc.)
- ❌ Amber/orange borders or fills on buttons (except dock hover — already approved)
- ❌ Blue anything (`slate-*` with blue tint, `sky-*`, `blue-*`)
- ❌ Green fills on stat cards or badges
- ❌ Colored project-color borders bleeding into UI chrome
- ❌ `accentColor` prop driving visual styling (kept for API compat but ignored visually)

## Allowed Color (case-by-case)

- ✅ Agent status dots: green `#22c55e` (active), gray `#78716c` (inactive)
- ✅ Destructive modals: rose/red borders (delete confirmation only)
- ✅ Dock hover: warm amber hover on `+`/action buttons (already approved)
- ✅ Dock accent bar: `rgba(214,211,209,0.6)` inset shadow (white/gray, not colored)

---

## Rules for Future Development

1. When building a new page, use `CompanyShell` and `StatCard` — they enforce the theme.
2. Do NOT pass meaningful `accentColor` values — the prop is ignored.
3. All inline styles should reference values from this spec.
4. If Tailwind classes are used, stick to `stone-*` scale only. No `slate-*`, `zinc-*`, `amber-*`, etc.
5. When in doubt: darker, less contrast, no color. Add color only for explicit product states.
