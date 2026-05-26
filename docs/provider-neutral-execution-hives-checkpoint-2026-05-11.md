# Provider-Neutral Execution Hives Checkpoint

Date: 2026-05-11

## Purpose

This checkpoint packages the current HiveRunner execution-routing work for review before any promotion to 3001. The goal is to make HiveRunner's execution layer provider-neutral while keeping HiveRunner as the control plane and source of truth.

## Product Model

HiveRunner remains the top-level product, control plane, and system of record.

Each task can resolve through an execution path:

1. Orchestration mode: Symphony, HiveRunner Native, or Manual / Operator Controlled.
2. Runtime: Codex, Claude Code, Gemini CLI, Hermes, OpenClaw, or a future runner.
3. Model routing: runtime managed, Hive managed, OpenRouter, or a direct model source.

Codex is no longer treated as the architecture. It is one runtime option inside a broader execution boundary.

## Primary Scope

- Execution Hives management surface under company navigation.
- Execution Matrix UI for choosing orchestration mode, runtime, and model routing.
- Provider-neutral execution metadata on tasks, runs, adapters, and service mappers.
- Model-source credential and probe layer for OpenAI, Anthropic, Google, OpenRouter, local, and self-hosted sources.
- Runtime Inventory cleanup, including Local CLIs as the default tab and Agent bindings as the advanced binding view.
- Runtime CLI wrappers and tests for external-runner provider flexibility.
- Task, inbox, and run detail visibility for resolved execution settings and usage totals.
- Modal styling polish so new provider credential dialogs match the existing wizard modal language.

## Review File Groups

### Hives UI and Runtime Inventory

- `src/app/(dashboard)/companies/[slug]/runtimes/page.tsx`
- `src/app/(dashboard)/companies/[slug]/runtimes/execution-matrix.tsx`
- `src/app/(dashboard)/companies/[slug]/hives/page.tsx`
- `src/app/(dashboard)/companies/[slug]/runtime-inventory/page.tsx`

### Hives APIs and Services

- `src/app/api/orchestration/companies/[slug]/hives/route.ts`
- `src/app/api/orchestration/companies/[slug]/hives/[hiveId]/activate/route.ts`
- `src/app/api/orchestration/companies/[slug]/hives/[hiveId]/configure/route.ts`
- `src/app/api/orchestration/companies/[slug]/hives/[hiveId]/probe/route.ts`
- `src/lib/orchestration/execution-hives.ts`
- `src/lib/orchestration/service/execution-hives.ts`

### Model Sources and Credentials

- `src/app/api/orchestration/companies/[slug]/model-sources/route.ts`
- `src/app/api/orchestration/companies/[slug]/model-sources/[sourceId]/probe/route.ts`
- `src/lib/orchestration/model-source-credentials.ts`
- `src/lib/secrets.ts`
- `docs/model-source-credential-architecture.md`

### Execution Routing Data Flow

- `src/lib/orchestration/contracts.ts`
- `src/lib/orchestration/client.ts`
- `src/lib/orchestration/db.ts`
- `src/lib/orchestration/types.ts`
- `src/lib/orchestration/service/shared/mappers.ts`
- `src/lib/orchestration/service/shared/queries.ts`
- `src/lib/orchestration/service/shared/types.ts`
- `src/lib/orchestration/service/task.ts`
- `src/lib/orchestration/service/task-detail.ts`
- `src/lib/orchestration/service/index.ts`

### External Runner Path

- `scripts/hiverunner-symphony-runner.mjs`
- `src/lib/orchestration/execution.ts`
- `src/lib/orchestration/execution/adapters/codex.ts`
- `src/lib/orchestration/execution/adapters/symphony.ts`
- `src/lib/orchestration/engine/engine.ts`
- `src/lib/orchestration/bridge/store.ts`
- `src/lib/orchestration/bridge/types.ts`

### Task, Inbox, and Shell Visibility

- `src/app/(dashboard)/companies/[slug]/tasks/[taskKey]/page.tsx`
- `src/app/(dashboard)/companies/[slug]/inbox/page.tsx`
- `src/app/(dashboard)/companies/[slug]/agents/[agentId]/runs/[runId]/page.tsx`
- `src/app/(dashboard)/companies/[slug]/projects/[projectSlug]/configuration/page.tsx`
- `src/app/(dashboard)/companies/[slug]/settings/page.tsx`
- `src/components/orchestration/CreateTaskModal.tsx`
- `src/components/tasks/TaskQuickViewModal.tsx`
- `src/components/PageBreadcrumbs.tsx`
- `src/components/HiveRunner/Dock.tsx`
- `src/components/notifications/NotificationToast.tsx`

### Focused Tests

- `src/lib/__tests__/execution-matrix-render.test.tsx`
- `src/lib/__tests__/model-source-credentials.test.ts`
- `src/lib/__tests__/orchestration-execution-hives.test.ts`
- `src/lib/__tests__/orchestration-execution-hives-route.test.ts`
- `src/lib/__tests__/orchestration-codex-execution-adapter.test.ts`
- `src/lib/__tests__/orchestration-create-task-subtask.test.ts`
- `src/lib/__tests__/orchestration-symphony-execution-adapter.test.ts`
- `src/lib/__tests__/notification-toast-container.test.ts`

## Validation Completed

- Focused ESLint on hives, runtime inventory, model source, and task modal files.
- `ORCHESTRATION_DB_PATH=/tmp/execution-matrix-render-audit.db npx tsx src/lib/__tests__/execution-matrix-render.test.tsx`
- `ORCHESTRATION_DB_PATH=/tmp/orchestration-execution-hives-audit.db npx tsx src/lib/__tests__/orchestration-execution-hives.test.ts`
- `ORCHESTRATION_DB_PATH=/tmp/model-source-credentials-audit-2.db npx tsx src/lib/__tests__/model-source-credentials.test.ts`
- `git diff --check`
- Playwright visual audit of `http://127.0.0.1:3010/NEV/hives`
- Playwright visual audit of `http://127.0.0.1:3010/NEV/runtime-inventory`

## Browser Audit Results

Confirmed working on 3010:

- Hives library tab renders and selects hives.
- Setup Wizard opens and advances.
- Lane Inspector renders lane detail and test bench.
- Lane check calls the live probe API and updates persisted verification state.
- Execution Matrix changes can enter pending state and reset without saving.
- Model-source modal opens from matrix choices.
- Model-source connection test calls the live probe route.
- Runtime Inventory link resolves and loads Local CLIs as the default tab.
- No browser console or page errors appeared during the Playwright pass.

Expected current behavior:

- Anthropic Direct reports failed when no `ANTHROPIC_API_KEY` is configured.
- OpenAI Direct can show configured when an environment credential is present.
- Direct model-source routing is a credentialed model source, not an auto-router.

## Known Non-Blocking Follow-Ups

- Run one final 3010 acceptance pass after any additional UI copy edits.
- Decide whether to keep Runtime Inventory mostly as an advanced console or continue slimming it now that Hives is the main management surface.
- Confirm direct provider credential storage strategy before hosted production. Local/staging uses the active local server-side secret adapter; hosted production should use encrypted tenant-scoped storage with audit logs and rotation.
- Package a final staged commit only after the 3010 review is complete.

## Promotion Guidance

Do not promote this checkpoint to 3001 until:

- The 3010 hives UI review is accepted.
- The Runtime Inventory loading state is visually checked.
- The checkpoint file list is reviewed for unrelated changes.
- Focused tests still pass after final review edits.
