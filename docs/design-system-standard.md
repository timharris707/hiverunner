# HiveRunner Design System Standard

Updated: 2026-04-07

## Design Inspiration

HiveRunner's visual language is inspired by Claude Code / Anthropic's product surfaces:
- **Simplified** — reduce visual noise, let content lead
- **Calm** — neutral/slate/ink surfaces, no competing accents
- **Consistent** — same typographic hierarchy on every page
- **Restrained color** — one accent color, semantic tones only for status
- **Premium but understated** — density without clutter

This is inspiration, not imitation. HiveRunner translates the same design discipline into its own product language — dark operator surfaces, amber accent, functional density, honest provenance labeling.

## System Location

| File | Purpose |
|---|---|
| `src/lib/ui/tokens.ts` | Design tokens: colors, typography, spacing, radius |
| `src/lib/ui/primitives.tsx` | Shared UI components: PageHeader, Section, Card, Badge, etc. |
| `src/lib/ui/index.ts` | Central export |
| `src/app/globals.css` | CSS custom properties (same values, for CSS/Tailwind contexts) |

## Principles

1. **One palette, everywhere.** Import from `@/lib/ui/tokens` — never define a local `const P = {}`.
2. **Primitives over inline.** Use `<Section>`, `<Card>`, `<Badge>` from `@/lib/ui/primitives` instead of reinventing containers.
3. **Typography scale, not ad-hoc sizes.** Use `type.pageTitle`, `type.sectionLabel`, `type.body`, etc.
4. **Spacing scale, not arbitrary numbers.** Use `space.sm` (8), `space.md` (12), `space.lg` (16), `space.xl` (20).
5. **Accent is amber, not everything.** `color.accent` (#d97706) for interactive highlights only. Status uses semantic tones (positive/negative/warning).
6. **Honest over pretty.** If data is absent, say so. If a surface is convention-derived, label it. Don't hide gaps behind polish.

## Color Palette

### Surface Stack

| Token | Hex | Use |
|---|---|---|
| `color.bg` | `#0c0c0c` | Page background |
| `color.surface` | `#1a1a1a` | Cards, panels, sections |
| `color.surfaceElevated` | `#242424` | Modals, dropdowns, popovers |
| `color.surfaceHover` | `#2e2e2e` | Hover state on interactive surfaces |

### Text

| Token | Hex | Use |
|---|---|---|
| `color.text` | `#e5e5e5` | Primary text — headings, values |
| `color.textSecondary` | `#a3a3a3` | Descriptions, metadata |
| `color.textMuted` | `#737373` | Timestamps, captions, disabled labels |

### Borders

| Token | Value | Use |
|---|---|---|
| `color.border` | `rgba(255,255,255,0.08)` | Default card/container border |
| `color.borderStrong` | `rgba(255,255,255,0.16)` | Hover, focused input, active states |

### Accent & Semantic

| Token | Hex | Use |
|---|---|---|
| `color.accent` | `#d97706` | Interactive highlights, active state |
| `color.positive` | `#22c55e` | Success, online, completed |
| `color.negative` | `#ef4444` | Error, destructive, offline |
| `color.warning` | `#f59e0b` | Caution, pending, degraded |
| `color.info` | `#3b82f6` | Informational highlights |

Each semantic color has a `*Soft` variant (12% opacity background) for badge/banner backgrounds.

## Typography Scale

| Token | Size | Weight | Use |
|---|---|---|---|
| `type.pageTitle` | 15px | 700 | Page header (once per page) |
| `type.sectionLabel` | 11px | 600 | Uppercase section label |
| `type.cardTitle` | 13px | 600 | List row / card primary label |
| `type.body` | 13px | 400 | Default reading text |
| `type.bodySmall` | 12px | 400 | Descriptions, metadata |
| `type.caption` | 11px | 500 | Badges, timestamps |
| `type.metric` | 24px | 700 | Large numeric display |
| `type.mono` | 12px | 400 | Code, IDs, file paths |

Fonts: headings use `font.heading`, body uses `font.body`, code uses `font.mono`.

## Spacing Scale

4px base unit:

| Token | px | Use |
|---|---|---|
| `space.xs` | 4 | Tight internal padding |
| `space.sm` | 8 | Default gap, tight padding |
| `space.md` | 12 | Standard padding, comfortable gap |
| `space.lg` | 16 | Section padding, card padding |
| `space.xl` | 20 | Page horizontal padding |
| `space.xxl` | 24 | Generous section spacing |
| `space.xxxl` | 32 | Major section breaks |

## Border Radius

| Token | px | Use |
|---|---|---|
| `radius.sm` | 4 | Buttons, inputs, badges |
| `radius.md` | 8 | Cards, panels |
| `radius.lg` | 10 | Prominent cards, sections |
| `radius.full` | 9999 | Pills, avatars |

## Shared Primitives

Import from `@/lib/ui`:

### PageHeader
```tsx
<PageHeader icon={<Settings size={16} />} title="Company Settings" />
```
Standard page title with optional icon and right-side actions.

### Section
```tsx
<Section title="General">
  <p>Content inside a card container</p>
</Section>
```
Uppercase label + card-wrapped content. Set `card={false}` for unwrapped sections.

### Card
```tsx
<Card hoverable onClick={handleClick}>
  <span>Card content</span>
</Card>
```
Standard surface container with optional hover effect.

### PropRow
```tsx
<PropRow label="Workspace root">
  <span style={{ fontFamily: font.mono }}>~/workspace</span>
</PropRow>
```
Label–value pair for settings/configuration displays.

### Badge
```tsx
<Badge label="Active" tone="positive" />
<Badge label="Pending" tone="warning" />
```
Inline status/category indicator with semantic tones.

### ActionButton
```tsx
<ActionButton label="Save" variant="primary" onClick={save} />
<ActionButton label="Export" icon={<Download size={13} />} href="/export" />
```
Standard button with primary/secondary/ghost variants.

### EmptyState
```tsx
<EmptyState icon={<Inbox size={24} />} title="No messages" description="Check back later." />
```
Centered placeholder for empty sections/pages.

### InfoNote
```tsx
<InfoNote tone="warning">This action cannot be undone.</InfoNote>
```
Callout for caveats, limitations, and advisories.

## Page Structure Pattern

Every company-scoped page should follow:

```tsx
import { P, type, space, font } from "@/lib/ui/tokens";
import { PageHeader, Section, ActionButton } from "@/lib/ui/primitives";

export default function SomePage() {
  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, maxWidth: 960, color: P.text, fontSize: type.body.size }}>
      <PageHeader title="Page Name" icon={<SomeIcon size={16} />} />
      <Section title="First Section">
        {/* content */}
      </Section>
    </div>
  );
}
```

## Do / Don't

### Do

- Import `P` from `@/lib/ui/tokens` for palette values
- Use `<Section>` for labeled content groups
- Use `type.*` for font sizes instead of arbitrary numbers
- Use `space.*` for padding/gap instead of arbitrary numbers
- Use `<Badge>` with semantic tones for status indicators
- Use `color.accent` only for interactive highlights
- Use `color.textMuted` for timestamps and tertiary info

### Don't

- Define a local `const P = { bg: "#0f0f0f", ... }` palette
- Use `fontSize: 14` or `fontSize: 11` without referencing the type scale
- Use `padding: "12px 18px"` without referencing the space scale
- Use `borderRadius: 6` — stick to `radius.sm` (4), `radius.md` (8), or `radius.lg` (10)
- Use red as an accent color — red is reserved for error/destructive states
- Add per-page accent colors — amber is the only accent
- Use `#f5f5f4` or `#d6d3d1` for text — those are the wrong palette (stone vs neutral)

## Migration Guide

To migrate an existing page:

1. Remove the local `const P = { ... }` palette definition
2. Add `import { P, type, space, font } from "@/lib/ui/tokens"`
3. Replace `P.card` → `P.card` (same name, now canonical)
4. Replace inline `fontSize: 13` → `type.body.size` where it maps
5. Replace inline `padding: "16px 20px"` → `` `${space.lg}px ${space.xl}px` ``
6. Replace inline section headers with `<Section title="...">`
7. Replace inline card wrappers with `<Card>`

## Rollout Plan

### Wave 1 — Exemplar pages (this commit)
- Settings page
- Export page
- Import page

### Wave 2 — High-visibility operator pages
- Dashboard
- Inbox
- Tasks page
- Approvals queue

### Wave 3 — Agent subpages
- Agent configuration
- Agent instructions
- Agent skills
- Agent runs

### Wave 4 — Project subpages
- Project tasks
- Project board
- Project configuration
- Project workspaces

### Wave 5 — Remaining surfaces
- Goals
- Routines
- Skills library
- Activity
- Costs
- Org chart
- Team

### Legacy patterns to retire
- All local `const P = { ... }` palette definitions
- All inline `fontSize: XX` that don't reference `type.*`
- All inline `padding: "Xpx Ypx"` that don't reference `space.*`
- All inline `borderRadius: N` that don't reference `radius.*`
- Stone palette values (`#f5f5f4`, `#d6d3d1`, `#a8a29e`) on the approvals page
- Per-page `Section` / `PropRow` / `Badge` component definitions (use shared versions)
