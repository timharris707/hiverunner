# Panely-Owned Work Audit — 2026-04-02

Purpose: complete checklist item 1 by identifying what is clearly Panely-owned, what already lives in `projects/panely-app/`, and what still bleeds into Mission Control but should be treated as embedded advisory-module territory rather than Panely core.

## Outcome

- `projects/panely-app/` is the correct standalone product home for Panely-specific product work.
- The Panely app now visibly contains public-product concerns that should stay there: auth, billing, profile, login/signup/signin, standalone advisory APIs/components/libs.
- Mission Control still contains a substantial internal advisory module, but that should be treated as an optional embedded module — not as justification to keep public Panely product work mixed into Mission Control core.

## Evidence from current repo state

### Panely-owned paths already in standalone product
These are strong indicators that Panely product work is correctly accumulating under the standalone app boundary:

- `projects/panely-app/src/app/auth/*`
- `projects/panely-app/src/app/login/*`
- `projects/panely-app/src/app/profile/*`
- `projects/panely-app/src/app/billing/*`
- `projects/panely-app/src/app/api/auth/*`
- `projects/panely-app/src/app/api/billing/*`
- `projects/panely-app/src/lib/billing.ts`
- `projects/panely-app/src/lib/stripe.ts`
- `projects/panely-app/src/lib/ai/*`
- `projects/panely-app/src/app/api/advisory/*`
- `projects/panely-app/src/components/advisory/*`
- `projects/panely-app/src/lib/advisory-agent.ts`
- `projects/panely-app/src/lib/advisory-history.ts`
- `projects/panely-app/src/types/advisory.ts`
- `projects/panely-app/src/styles/advisory.css`

### Mission Control paths that remain valid as internal module territory
These still belong to the internal/basic advisory capability inside Mission Control and should not be misclassified as Panely product leakage by default:

- `src/app/(dashboard)/advisory/*`
- `src/app/api/advisory/*`
- `src/components/advisory/*`
- `src/lib/advisory-agent.ts`
- `src/lib/advisory-history.ts`
- `src/types/advisory.ts`
- `src/styles/advisory.css`

### Important distinction
The overlap in naming (`advisory`) is architectural debt, but not all overlap is wrong.

- **Panely-owned** = public-product auth/billing/profile/standalone-app concerns
- **Mission-Control-owned advisory module** = embedded internal advisory capability

That means item 1 is not “move all advisory code out of Mission Control.”
It is “ensure Panely-owned work is happening in `projects/panely-app/` and stop confusing Panely standalone product work with Mission Control core.”

## Current item-1 judgment

Checklist item 1 can be considered complete because:
1. Panely-owned work is clearly identified under `projects/panely-app/`
2. Public-product concerns are now visibly separated from Mission Control core
3. The remaining ambiguity has been narrowed to shared naming and embedded-module boundaries, which is the proper scope of checklist item 2

## Handoff to item 2

Next focus:
- shared shell/layout/nav pieces
- ambiguous components sitting in Mission Control root component areas
- deciding whether certain advisory-adjacent shell pieces are MC module UI or should be extracted/reimplemented for Panely separately
