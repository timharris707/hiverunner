# Insight Project Tasks Page — Claude-style template pass

Date: 2026-04-06
Branch: feat/mission-control-live-parity

## Scope
- Single-page template alignment for:
  - `/NEV/projects/insight-website/tasks`
- No cross-page or global resets.

## Decisions carried forward
- Use shared visual primitives and tokens to reduce drift:
  - `src/lib/ui/tokens.ts`
  - `src/lib/ui/primitives.tsx`
- Introduce a calmer page surface: muted backgrounds (`P.surface*`), restrained borders, and smaller density through tighter spacing constants.
- Move from utility-heavy ad-hoc classes toward tokenized inline style on this page for consistent rhythm and future portability.
- Add a stronger top hierarchy via shared header/card sections:
  - Project title + meta
  - Toolbar row with compact view/sort/group/filter controls
- Normalize row structure: consistent status marker, identifier, title, metadata line, and muted accent treatment.
- Keep page-specific affordances (search, filters, board/list modes) but align interaction feel with a premium card-based aesthetic.

## Rollout intent
- Treat this as a template pattern for task pages and similar high-density list/board views.
- Prefer reusing existing primitives (`PageHeader`, `Card`, `EmptyState`, `ActionButton`) and token values before introducing new primitives.
