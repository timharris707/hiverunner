# Mission Control — Legacy Route Cleanup Map

> Last updated: 2026-04-05
> Routes classified as non-canonical after inbound-reference analysis.
> Do not delete without reviewing this document first.

## Classification Key

| Class | Meaning |
|---|---|
| **Safe delete** | Zero inbound references from live code. No Dock link, no Link href, no router.push, no middleware rewrite. |
| **Safe quarantine** | Only referenced from dead code (unused components/old Sidebar). Safe to move to `_legacy/` directory. |
| **Legacy but referenced** | Referenced from live code but the reference points to a non-company-scoped version that should be migrated to company-scoped. |
| **Needs review** | Ambiguous — may have a purpose not captured by grep analysis. |

---

## Safe Delete Candidates (zero live references)

| Route | File | Evidence |
|---|---|---|
| `/about` | `about/page.tsx` | Only reference: from `about/page.tsx` itself linking to `/agents` (circular). Zero imports, zero Dock links. |
| `/factory` | `factory/page.tsx` | Zero references anywhere in codebase. |
| `/factory/pipeline` | `factory/pipeline/page.tsx` | Zero references. |
| `/git` | `git/page.tsx` | Zero references. |
| `/monitoring` | `monitoring/page.tsx` | Zero references. |
| `/office` | `office/page.tsx` | Only reference: its own `Office3D` component. Zero Dock links. Separate from dashboard layout. |
| `/projects` (top-level) | `projects/page.tsx` | Zero non-company-scoped references. Dock uses `/{code}/projects`. |
| `/projects/[id]` | `projects/[id]/page.tsx` | Zero references outside own dir. Company-scoped version is canonical. |
| `/projects/[id]/board` | `projects/[id]/board/page.tsx` | Same. |
| `/projects/[id]/agents` | `projects/[id]/agents/page.tsx` | Same. |
| `/projects/[id]/settings` | `projects/[id]/settings/page.tsx` | Same. |
| `/projects/[id]/sprints` | `projects/[id]/sprints/page.tsx` | Same. |
| `/{code}/board` | `companies/[slug]/board/page.tsx` | Zero inbound links. Not in Dock. Not in middleware COMPANY_SUB_PATHS. Not linked from any page. |

## Safe Quarantine Candidates (only dead-code references)

| Route | File | Referenced By | Evidence |
|---|---|---|---|
| `/agents` (top-level) | `agents/page.tsx` | `Sidebar.tsx` (dead), `KeyboardShortcuts.tsx`, `about/page.tsx` | Old Sidebar is dead code (never imported). KeyboardShortcuts references `/agents` but Dock doesn't. |
| `/analytics` | `analytics/page.tsx` | `Sidebar.tsx` (dead) | Only ref is dead Sidebar. |
| `/calendar` | `calendar/page.tsx` | `Sidebar.tsx` (dead) | Only ref is dead Sidebar. `/cron` page links to it but `/cron` is also stale. |
| `/costs` (top-level) | `costs/page.tsx` | `Sidebar.tsx` (dead) | Superseded by `/{code}/costs`. Only dead Sidebar reference. |
| `/cron` | `cron/page.tsx` | `Sidebar.tsx` (dead), `calendar/page.tsx` (stale) | Both referrers are stale. |
| `/files` (top-level) | `files/page.tsx` | `Sidebar.tsx` (dead), `Office3D` (dead) | Both referrers are dead code. |
| `/memory` | `memory/page.tsx` | `Sidebar.tsx` (dead), `Office3D` (dead) | Both referrers are dead code. |
| `/org` (top-level) | `org/page.tsx` | route-paths.ts (company-scoped builder, not this page) | Top-level page is not the target. |
| `/reliability` | `reliability/page.tsx` | `Sidebar.tsx` (dead) | Only dead Sidebar reference. |
| `/reports` | `reports/page.tsx` | `Sidebar.tsx` (dead), `analytics/page.tsx` redirect | Analytics redirects to /reports, but analytics is itself dead. |
| `/skills` (top-level) | `skills/page.tsx` | route-paths.ts (company-scoped builder) | Top-level page is not the target. |
| `/system` | `system/page.tsx` | `Sidebar.tsx` (dead), notification sync API | Notification sync links to `/system` but Dock uses `/terminal`, `/sessions`, `/logs` instead. |
| `/tasks` (top-level) | `tasks/page.tsx` | `Sidebar.tsx` (dead), notification sync, KeyboardShortcuts | Non-company-scoped. Dock uses `/{code}/tasks`. Notification sync should be updated. |
| `/workflows` | `workflows/page.tsx` | `Sidebar.tsx` (dead), KeyboardShortcuts | Both referrers use non-canonical paths. |

## Legacy But Still Referenced (migrate references first)

| Route | File | Live Referrer | Migration Needed |
|---|---|---|---|
| `/paperclip` | `paperclip/page.tsx` | `PaperclipStatusWidget.tsx` links here | Widget is dead code (not imported by any page). Safe to quarantine together. |
| `/actions` | `actions/page.tsx` | None found | Actually safe delete — re-classified. |
| `/activity` (top-level) | `activity/page.tsx` | `route-paths.ts` builds company-scoped `/activity` | route-paths builds `/{code}/activity`, NOT top-level `/activity`. Safe quarantine. |

## Needs Human Review

| Route | File | Reason |
|---|---|---|
| `/{code}/agents` (list) | `companies/[slug]/agents/page.tsx` | Dock links directly to per-agent detail, NOT this list page. But it may serve as a landing/browse page. Middleware does rewrite `/{code}/agents` to it. |
| `/companies/{slug}/page.tsx` | `companies/[slug]/page.tsx` | Middleware rewrites `/{code}` to `/companies/{slug}/dashboard`, so this root page may never render. But it's a large file (400+ lines) with its own UI — could be an alternate dashboard or onboarding view. |
| `/agents/[agentId]` (non-company) | `agents/[agentId]/page.tsx` | Could serve as fallback for non-company agent contexts. Low traffic but uncertain purpose. |

---

## Dead Code Components (not routes, but related)

| File | Status | Evidence |
|---|---|---|
| `src/components/Sidebar.tsx` | Dead code | Not imported by any layout or page. Replaced by `Dock.tsx`. |
| `src/components/PaperclipStatusWidget.tsx` | Dead code | Not imported by any page. |
| `src/components/orchestration/OperationsWidget.tsx` | Dead code | Not imported by any page. |
| `src/components/Office3D/Office3D.tsx` | Dead code | Only imported by `/office/page.tsx` which is itself stale. |

---

## Summary

| Classification | Count |
|---|---|
| Safe delete | 13 routes |
| Safe quarantine | 14 routes |
| Legacy but referenced (safe quarantine after cleanup) | 3 routes |
| Needs human review | 3 routes |
| Dead code components | 4 files |
| **Total non-canonical** | **33 routes + 4 components** |
