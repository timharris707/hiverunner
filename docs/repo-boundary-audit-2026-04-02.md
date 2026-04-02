# Repo Boundary Audit — 2026-04-02

This document sharpens the current repository split work into practical buckets.

## Mission Control core candidates

- `src/app/api/orchestration` — directory present (36 files)
- `src/lib/orchestration` — directory present (36 files)
- `src/app/(dashboard)/companies` — directory present (31 files)
- `src/app/(dashboard)/projects` — directory present (6 files)
- `src/app/(dashboard)/agents` — directory present (2 files)
- `src/app/(dashboard)/tasks` — directory present (1 files)
- `src/app/(dashboard)/sessions` — directory present (1 files)
- `src/app/(dashboard)/settings` — directory present (1 files)
- `src/app/(dashboard)/system` — directory present (1 files)
- `scripts/promote_to_stable.sh` — file present
- `scripts/rollback_stable.sh` — file present
- `scripts/stable_release_common.sh` — file present

## Optional Mission Control modules

- `src/app/(dashboard)/advisory` — directory present (1 files)
- `src/app/(dashboard)/ideas` — directory present (1 files)
- `src/app/(dashboard)/marketing` — directory present (1 files)
- `src/app/(dashboard)/trading` — directory present (3 files)
- `src/app/api/advisory` — directory present (17 files)
- `src/app/api/ideas` — directory present (7 files)
- `src/app/api/trading` — directory present (11 files)
- `src/components/advisory` — directory present (10 files)
- `src/lib/advisory-agent.ts` — file present
- `src/lib/ideas-processing.ts` — file present
- `src/lib/ideas-store.ts` — file present
- `src/lib/live-trade-status.ts` — file present

## Panely standalone product candidates

- `projects/panely-app` — directory present (37723 files)

## Likely shared or ambiguous

- `src/components/AdvisoryPDFExport.tsx` — file present
- `src/components/AdvisorySessionDrawer.tsx` — file present
- `src/components/NarrativeFeed.tsx` — file present
- `src/components/QuickActionBar.tsx` — file present
- `src/components/QuickActions.tsx` — file present
- `src/app/api/advisory/sessions/[id]/run/route.ts` — file present

## Working guidance

- Do not commit Panely product code as if it were Mission Control core.
- Prefer optional-module framing for Ideas / Marketing / Trading / internal Advisory.
- Keep runtime/release tooling in Mission Control core.
- Use this audit together with the separation plan and migration checklist when making cleanup commits.

