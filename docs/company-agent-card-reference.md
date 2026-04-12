# Company Agent Card Reference (Recovery Pass)

## Source commit
- Preferred reference: `c53988e7` (`feat: implement company operating engine — CEO kickoff, persistent sessions, heartbeat runs`)
- The same richer agent-card structure appears in `0c5fc7eb`, `ded9fc84`, and `f813bd5a` for this path.
- The richer agent-card structure disappears after refactor chain at `5fa1b4eb -> b4a77eff -> 293fd328`.

## Exact files involved
- `src/app/(dashboard)/companies/[slug]/page.tsx` (historical versions in the listed commits)
  - `AgentStatusBadge`, `InfoRow`, card layout in the `activeTab === "agents"` block
  - heartbeat + model fields and heartbeat status in each card row
- `src/app/globals.css`
  - `.orchestra-live-dot`, `.orchestra-panel`, and other orchestration-layer utility styles
- `src/components/orchestration/ui.ts`
  - `formatAge()` used for heartbeat text

## Reference artifacts
- Screenshot: `docs/screenshots/company-agent-cards-reference-comparison.png`
  - Contains old-card block (`c53988e7`) plus current block (`293fd328`) side-by-side for visual comparison

## Why this is the better reference
- Information density: old cards expose current task, assigned project, model, heartbeat recency, and status in one card.
- Operational awareness: heartbeat and status color semantics are visible inline instead of only in a compact badge.
- Better action/readability pattern: grid card + structured mini-metrics rows, clearer hierarchy than the new compact Team card.
- Action affordance: explicit `Open profile` footer row at card level.
