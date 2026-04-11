# URL Routing Migration Handoff — April 3, 2026

## Goal
Replace `/companies/{slug}/...` URLs with human-readable Paperclip-style canonical URLs:
- `/{companyCode}/projects/{projectSlug}/issues`
- Example: `/NEV/projects/boardrunner/issues`

Reference: `http://127.0.0.1:3100/PAN/projects/panely-ai/issues`

## Hard constraints
- Routing-only. Do NOT move directories or workspace roots.
- NeverIdle's special main-workspace binding stays unchanged.
- Do NOT rearrange dock icons.
- Do NOT use hashed/derived codes. Use the durable `company_code` DB field.

## What exists now

### DB migration v15 (partially done)
- `src/lib/orchestration/db.ts` — migration 15 adds `company_code` column to `companies` table
- Backfills NeverIdle Core as `NEV`
- Other companies get first 3 letters of name, uppercased
- Unique index on `company_code`

### Type system
- `OrchestrationCompany` in `src/lib/orchestration/types.ts` now has a `code` field
- `company-service.ts` `CompanyRow` has `company_code`, `companyFromRow()` maps it to `code`
- `createCompany()` generates unique codes and inserts them

### Route helpers (split server/client)
- **Server-only:** `src/lib/orchestration/routes.ts`
  - `getCompanyCode(slug)` — reads code from DB
  - `resolveCompanySlugFromCode(code)` — reverse lookup
  - `buildCanonicalProject*Route()` — server-side builders
  - `resolvePrimaryCompanySlug()`, `findProjectSlugById()`
- **Client-safe:** `src/lib/orchestration/route-paths.ts`
  - Pure path builders: `buildCanonicalProjectIssuesPath()`, `buildCanonicalProjectBoardPath()`, etc.
  - No DB or server-only imports
- **Client helpers:** `src/lib/orchestration/company-routes.ts`
  - `companyCodeFor(company)` — reads `.code` from company object
  - `canonicalProjectBoardHref()`, `canonicalProjectIssuesHref()`, etc.

### Canonical route pages (working)
- `src/app/[companyCode]/page.tsx` — company code root → redirects to dashboard
- `src/app/[companyCode]/projects/[projectSlug]/issues/page.tsx`
- `src/app/[companyCode]/projects/[projectSlug]/board/page.tsx`
- `src/app/[companyCode]/projects/[projectSlug]/settings/page.tsx`
- `src/app/[companyCode]/projects/[projectSlug]/agents/page.tsx`

### Legacy redirects (working)
- `/companies/{slug}/projects/{projectSlug}` → redirects to `/{code}/projects/{projectSlug}/issues`

### Partially converted internal links
These pages now use canonical builders:
- `companies/[slug]/issues/page.tsx` — task row links use `buildCanonicalProjectBoardPath`
- `companies/[slug]/projects/page.tsx` — project open link uses `buildCanonicalProjectIssuesPath`
- `companies/[slug]/inbox/page.tsx` — event + task links use `canonicalProjectBoardHref`
- `companies/[slug]/activity/page.tsx` — event links use `canonicalProjectBoardHref`
- `companies/[slug]/board/page.tsx` — task links use `canonicalProjectBoardHref`
- `ActiveProjectBanner.tsx` — "Open board" link uses `buildCanonicalProjectBoardPath`

## What was completed (April 3 pass)

### Dock fully converted to canonical URLs ✅
- Added `code` field to `CompanyNavState` (populated from API `OrchestrationCompany.code`)
- All ~40+ `/companies/${slug}/...` hrefs in Dock replaced with canonical path builders
- Both expanded and collapsed dock views emit canonical URLs
- Mobile nav items emit canonical URLs
- Company picker switch navigates to canonical `/{code}/dashboard`
- Project picker switch navigates to canonical `/{code}/projects/{slug}/issues`
- Company code detection added to pathname resolver for canonical URL context
- Only 2 legacy references intentionally preserved:
  - pathname backward-compat detection for legacy `/companies/...` URLs
  - `/companies/new` (standalone create flow, not company-scoped)

### Company-level canonical route pages created ✅
New `[companyCode]/` redirect pages added for:
- `dashboard`, `inbox`, `issues`, `issues/new`, `team`, `org`, `skills`, `costs`, `activity`, `files`, `settings`, `projects`, `goals`, `agents/new`, `agents/[agentId]`

All redirect to the corresponding legacy `/companies/{slug}/...` page (same pattern as existing project-level canonicals).

### Route path builders expanded ✅
`route-paths.ts` now exports company-level builders:
- `buildCanonicalCompanyPath`, `buildCanonicalDashboardPath`, `buildCanonicalInboxPath`, `buildCanonicalIssuesPath`, `buildCanonicalGoalsPath`, `buildCanonicalTeamPath`, `buildCanonicalOrgPath`, `buildCanonicalSkillsPath`, `buildCanonicalCostsPath`, `buildCanonicalActivityPath`, `buildCanonicalFilesPath`, `buildCanonicalSettingsPath`, `buildCanonicalProjectsPath`, `buildCanonicalNewIssuePath`, `buildCanonicalAgentPath`, `buildCanonicalNewAgentPath`

## What is NOT done yet

### Remaining legacy company pages (non-Dock internal links)
These pages still emit `/companies/...` links internally. They work because the canonical routes redirect, but for a fully clean URL experience they should eventually use canonical builders too:
1. **`companies/[slug]/goals/page.tsx`** — sprint links
2. **`companies/[slug]/dashboard/page.tsx`** — project/agent links
3. **`companies/[slug]/page.tsx`** — company detail links
4. **`companies/[slug]/team/page.tsx`** — agent links
5. **`companies/[slug]/org/page.tsx`** — agent links
6. **`companies/[slug]/costs/page.tsx`** — team links
7. **`companies/[slug]/skills/page.tsx`** — team links
8. **`companies/[slug]/issues/new/page.tsx`** — back link + created redirect
9. **`companies/new/page.tsx`** — post-create redirect
10. **`projects/[id]/settings/page.tsx`**, **`projects/[id]/agents/page.tsx`** — company links
11. **`projects/page.tsx`** — company/team links

These are lower priority since the Dock drives most user navigation.

### The canonical routes still redirect into old company pages
Currently `/{code}/projects/{slug}/issues` redirects to `/companies/{companySlug}/issues?project={slug}`. Ideally the canonical routes should eventually render directly, but redirect-through is acceptable for this phase.

## Acceptance criteria
1. ✅ Build passes
2. ✅ Port 3010 live: `/NEV/projects/boardrunner/issues` resolves (307 → `/companies/neveridle-core/issues?project=boardrunner`)
3. ✅ Legacy `/companies/neveridle-core/projects/boardrunner` redirects to `/NEV/projects/boardrunner/issues`
4. ✅ Internal navigation keeps browser on canonical URLs (especially Dock — fully converted)
5. ✅ No workspace root changes
6. ✅ No dock icon rearrangement
