# HiveRunner Fresh GitHub Onboarding Gauntlet - 2026-05-25

## Environment

- Repository: `<repo-url>`
- Fresh clone path: `/tmp/hiverunner-fresh-20260525`
- Branch tested: `main`
- Baseline commit: `ce6d707b [codex] Add first-run starter team templates (#12)`
- Test server: `http://127.0.0.1:3011`
- Reason for alternate port: local `3010` was already reserved for the live development instance; the README documents `PORT=3011 npm run dev` as the alternate-port path.

## Commands Followed

```bash
git clone <repo-url> /tmp/hiverunner-fresh-20260525
cd /tmp/hiverunner-fresh-20260525
cp .env.example .env.local
npm install
PORT=3011 npm run dev
```

Validation commands:

```bash
ORCHESTRATION_DB_PATH=/tmp/orchestration-create-full-runtime-identity-gauntlet.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-create-full-runtime-identity.test.ts
ORCHESTRATION_DB_PATH=/tmp/orchestration-starter-team-templates-gauntlet.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-starter-team-templates.test.ts
npm run test:orchestration:company-owner-authorization
npx tsc --noEmit --incremental false --pretty false
git diff --check
```

## Failures Found

### P0 - First-run workspace launch redirected to a company the local owner could not see

The Software/Product wizard path created a new company and redirected to `/GAU/dashboard`, but the dashboard rendered `Company not found`.

Root cause: `/api/orchestration/companies/create-full` created the company owner from the typed owner form fields, while local-single-user auth continued to resolve as `local-owner`. Owner enforcement then filtered the newly created company out of the logged-in owner's view.

Fix: bind create-full company ownership to the authenticated/request owner id when one is present, while still using the form fields as the owner profile.

### P1 - Stale owner-authorization assertion

The owner-authorization test expected a pre-reconciliation generated owner id after local-single-user reconciliation. The correct assertion is that aliases reconcile to the current canonical local owner id.

Fix: assert against the canonical owner id after reconciliation.

### P2 - Audit-only observations

- `npm install` reports 11 audit findings: 6 moderate, 5 high. This was not chased in this goal because the install succeeds and dependency remediation may require broader package decisions.
- The repo still contains historical/internal docs with legacy names and paths. Public quickstart docs are clean enough for this path; broad historical-doc cleanup is a separate share-readiness pass.

## Final Successful Path

After the ownership fix and a fresh SQLite reset, the browser gauntlet passed:

- Login page rendered the local-single-user `Continue as owner` path.
- `/` redirected to `/HIVE/dashboard` on a fresh install.
- `/HIVE/dashboard` rendered with neutral empty state.
- `/companies/new` completed successfully for:
  - Software/Product: 4 selected starter agents, dashboard loaded at `/GAU/dashboard`.
  - Research/Strategy: 3 selected starter agents, dashboard loaded at `/GAU2/dashboard`.
  - Blank/custom: 0 selected starter agents, dashboard loaded at `/GAU3/dashboard`.
- Provider keys were not configured and did not block launch.
- OpenClaw provisioning stayed gated: a request for OpenClaw without `MC_ENABLE_OPENCLAW_AGENT_PROVISIONING=1` returned `runtimeProvider: manual` and `openclawAgentId: null`.
- Health check returned `status: ok`, dev mode, port `3011`, and zero pending migrations.

## Files Changed

- `README.md` - clarified local-single-user first-run owner behavior.
- `src/app/api/orchestration/companies/create-full/route.ts` - resolves request owner id for create-full.
- `src/lib/orchestration/company-service.ts` - lets company creation bind ownership to a known owner user id.
- `src/lib/__tests__/orchestration-create-full-runtime-identity.test.ts` - adds local owner first-run regression coverage.
- `src/lib/__tests__/orchestration-company-owner-authorization.test.ts` - updates stale reconciliation assertion.
- `docs/onboarding-gauntlet-2026-05-25.md` - this evidence report.

## Remaining Blockers

- P1: Dependency audit findings should be triaged before a broader public announcement.
- P2: Historical/internal docs still contain legacy names, private paths, and old architecture notes. They are not on the README quickstart path but remain public repository polish debt.
- P2: Default workspace root is outside the clone under the user's home directory. This is documented and intentional today, but first-run setup may feel cleaner later with an explicit workspace-root prompt or `.env.local` recommendation.
