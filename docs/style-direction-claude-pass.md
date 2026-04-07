# Style Direction: Claude-Inspired Pass

Reference: Claude Platform dashboard (platform.claude.com/dashboard)
First page: `/NEV/projects/insight-website/tasks`
Date: 2026-04-06

## Key decisions

### Palette shift: cool → warm
- Background: `#0c0c0c` → `#141312` (warm charcoal)
- Surface: `#1a1a1a` → `#1c1b19`
- Elevated: `#242424` → `#252321`
- Text primary: `#e5e5e5` → `#eae8e4` (warm white, not cream)
- Text secondary: `#a3a3a3` → `#a8a6a0` (olive-gray, not blue-gray)
- Text muted: `#737373` → `#7a7872`

### Border treatment
- Width: `1px` → `0.5px` throughout (hairline borders)
- Color: `rgba(255,255,255,0.08)` → `rgba(222,220,209,0.10)` (warm tint)
- Stronger border: `rgba(222,220,209,0.18)`

### Radius
- `radius.lg`: `10px` → `12px` (cards, panels)

### Typography
- Page title: `15px/700` → `17px/600` with `-0.01em` tracking
- Less aggressive heading weights throughout

### Accent usage
- CSS variable `--accent` changed from red `#FF3B30` to amber `#d97706`
- Active nav items: white-on-subtle-dark instead of amber/orange
- Orchestra glassmorphism gradients: reduced from 10-14% opacity to 4%
- CTA glow effects: reduced intensity

### Sidebar (Dock)
- Flat background `#181716` instead of radial gradient + blur
- Border: hairline warm border instead of thick warm-gray
- Company name: normal casing at 13px instead of uppercase 11px
- Section labels: `#7a7872` (muted) at 600 weight
- Active nav: `rgba(255,255,255,0.08)` bg instead of amber highlight

### Top bar
- Background: `var(--bg)` instead of `var(--surface)` (blends with page)
- Brand: "Mission Control" in 13px/600 primary text instead of 11px/600 red uppercase
- Tagline: plain text in muted color instead of italic with quotes
- Avatar: surface bg with border instead of solid red

### Status bar
- Background: `var(--bg)` with 0.5px top border

## Files touched

| File | What changed |
|---|---|
| `src/lib/ui/tokens.ts` | Canonical color palette, radius, typography scale |
| `src/app/globals.css` | CSS variables, `.card`/`.orchestra-*`/`.nav-item` classes |
| `src/lib/ui/primitives.tsx` | Card, Section, ActionButton, InfoNote border weights |
| `src/components/TenacitOS/TopBar.tsx` | Brand treatment, avatar, dropdown |
| `src/components/TenacitOS/Dock.tsx` | Background, borders, nav states, section headers |
| `src/components/TenacitOS/StatusBar.tsx` | Background and border |
| `src/app/(dashboard)/companies/[slug]/projects/[projectSlug]/ProjectTabBar.tsx` | Border and text colors |

## Rollout guidance

All shared tokens and CSS variables are updated, so pages importing from `@/lib/ui/tokens` or using CSS custom properties will inherit the warm palette automatically. The remaining work for other pages:

1. Pages with hardcoded inline color values (not using tokens) need manual alignment
2. Pages using orchestra-class gradients will already see reduced intensity
3. The Dock and TopBar changes are global — all pages benefit immediately
4. Page-specific inline styles (like in `TaskRow`, `TaskCard`, etc.) should be reviewed for any remaining cool-gray values

## What this is NOT

This is not a redesign. It's a discipline pass — same information, same density, same product identity, but with coherent warm tones, quieter borders, and less visual noise. The goal is premium calm, not minimalism.
