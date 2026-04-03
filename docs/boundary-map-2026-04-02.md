# Boundary Map — 2026-04-02

## 1. Mission Control Core (Keep in `src/`)
- `src/app/api/orchestration/`
- `src/app/api/agents/`, `src/app/api/tasks/`, `src/app/api/office/`, `src/app/api/files/`
- `src/app/(dashboard)/` (Base layout, Dock, StatusBar, TopBar, system/settings/org pages)
- `src/components/TenacitOS/` (Shell/UI framework)
- `src/lib/orchestration/`
- `src/lib/tasks-db.ts`, `src/lib/agent-skills.ts`, `src/lib/system-stats.ts`, `src/lib/activity-stream.ts`
- `src/config/agents.ts`
- `scripts/lane.sh`, `scripts/promote_to_stable.sh`, `scripts/rollback_stable.sh`, etc.

## 2. Mission Control Optional Modules (Keep in `src/` but as modular features)
- **Ideas:** `src/app/(dashboard)/ideas/`, `src/lib/ideas-*.ts`
- **Trading Floor:** `src/app/(dashboard)/trading/`, `src/lib/live-trade-status.ts`, `src/lib/trading-weather.ts`
- **Advisory (Internal):** `src/components/AdvisorySessionDrawer.tsx`, `src/lib/advisory-agent.ts` (the light version)
- **Voice/Office:** `src/app/(dashboard)/voice/`, `src/app/(dashboard)/office/`, `src/components/Office3D/`

## 3. Panely Standalone Product (Move/Keep in `projects/panely-app/`)
- **Shell & Layout:** Custom landing page, login shell, user dashboard (`projects/panely-app/src/app/page.tsx`, `auth/`, `login/`, `profile/`)
- **Billing:** `projects/panely-app/src/app/billing/`, `projects/panely-app/src/lib/stripe.ts`, `projects/panely-app/src/lib/billing.ts`
- **Public Advisory Engine:** `projects/panely-app/src/app/api/advisory/`, `projects/panely-app/src/components/advisory/`
- **Public Assets:** `public/avatars/` (unless used by MC core)

## Decisions / Actions
- **Move:** Any Stripe or public auth logic found in `src/` must migrate to `projects/panely-app/`.
- **Split:** `advisory-agent.ts` currently exists in both places. The Panely version is the full product. The MC version remains a lightweight internal integration.
- **Delete:** Unused mixed/generated artifacts.