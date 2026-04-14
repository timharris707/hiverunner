# Anvil status, MC Paperclip parity sprint

Date: 2026-04-14
Branch: `feat/mission-control-live-parity`
Owner: Anvil

## Scope completed in this pass

### VIR-7, unified task timeline and issue-detail backend

Shipped:
- unified task detail backend assembler
- task detail DTO / contract
- task detail route now returns `task + detail`
- task detail page now consumes unified detail payload
- real subtask rendering on task detail
- parent task context on child pages
- provenance-styled activity timeline
- issue-local run summary strip on task detail
- regression coverage for unified detail route shape

Key commits:
- `68756799` Add unified task detail timeline backend
- `37e6deba` Wire task detail page to unified timeline payload
- `73f71838` Add parent task context to task detail page
- `2ce8677b` Add provenance styling to task activity timeline
- `f8cd7a61` Show run summary strip on task detail page
- `590df305` Cover unified task detail route in workflow regression

Primary files touched:
- `src/lib/orchestration/service/task-detail.ts`
- `src/lib/orchestration/types.ts`
- `src/lib/orchestration/service/index.ts`
- `src/app/api/orchestration/tasks/[id]/route.ts`
- `src/lib/orchestration/client.ts`
- `src/app/(dashboard)/companies/[slug]/tasks/[taskKey]/page.tsx`
- `src/lib/__tests__/orchestration-task-detail.test.ts`
- `src/lib/__tests__/orchestration-foundation-workflow.test.ts`

### VIR-11, stale live-agent indicators in left navigation

Shipped:
- dock now consults live run status map, not just stale persisted agent status
- terminal run truth now overrides stale SSE / persisted `working` state
- added live-status regression tests

Key commits:
- `3589fc10` Use live run status for dock agent indicators
- `e040f043` Make terminal run status authoritative for live agents

Primary files touched:
- `src/components/TenacitOS/Dock.tsx`
- `src/lib/orchestration/live-status.ts`
- `src/lib/__tests__/orchestration-live-status.test.ts`

## Verification commands already passing

### Task detail service coverage
```bash
ORCHESTRATION_DB_PATH=/tmp/orchestration-task-detail.db npx tsx src/lib/__tests__/orchestration-task-detail.test.ts
```

### Unified route workflow regression
```bash
ORCHESTRATION_DB_PATH=/tmp/orchestration-foundation-workflow.db npx tsx src/lib/__tests__/orchestration-foundation-workflow.test.ts
```

### Live-status regression
```bash
npx tsx src/lib/__tests__/orchestration-live-status.test.ts
```

## Known caveats

- Full repo `npx tsc --noEmit` is still noisy because of many unrelated pre-existing type errors outside this sprint slice.
- Task detail comments composer still renders separately from the unified activity timeline. Narrative parity improved substantially, but the page is not yet a full Paperclip-equivalent operator console.
- Task detail run strip shows summary truth, but not a deep run-detail link yet.

## Suggested Gater checks

1. Open a child task and confirm parent banner appears.
2. Open a parent task with subtasks and confirm Sub-tasks tab is real, not placeholder-only.
3. Confirm Activity tab shows mixed provenance rows, not just comments + raw task events.
4. Confirm the run summary strip appears on task detail even before opening Activity.
5. Start and finish an agent run, then verify the left dock stops showing that agent as live once terminal status lands.

## Practical read on status

This is now materially closer to Paperclip issue-detail parity.
The page can answer much more of the task story from one surface.
Remaining gaps are mostly polish / operability depth, not missing backend spine.
