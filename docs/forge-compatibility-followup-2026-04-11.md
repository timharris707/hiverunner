# Forge Compatibility Follow-up

Date: 2026-04-11

Scope:
- trace Forge compatibility end-to-end
- remove the active Mission Control dependency on `workspace-forge`
- do not delete `workspace-forge`
- do not relocate the repo

## Status

Classification: `REVIEW`

`workspace-forge` is no longer the preferred compatibility path for the active Forge record, but it is still preserved on disk and should not be deleted without a separate approval pass.

## Root Cause

The Forge compatibility debt came from a mismatch between historical runtime state and current compatibility code:

1. The active Mission Control row still exists under `neveridle-core`.
   - Agent row: `Forge | slug=forge | openclaw_agent_id=forge`
   - Company row: `neveridle-core | workspace_root=/Users/timharris/.openclaw/workspace | workspace_source=openclaw`

2. Mission Control compatibility logic previously fell back from missing company-scoped paths directly to:
   - `/Users/timharris/.openclaw/workspace-forge`

3. Historical OpenClaw session state shows that `workspace-forge` was an early failed bootstrap location, while later sessions operated from:
   - `/Users/timharris/.openclaw/workspace/forge`

4. There is no live `forge` runtime entry in `/Users/timharris/.openclaw/openclaw.json`, so the stale top-level directory was not backed by a current runtime registry entry.

## End-to-End Compatibility Path

### DB Row

- Forge agent row resolves from the orchestration DB as:
  - `6f707951-fd68-41b0-bd53-dc6f6222fe5e | Forge | forge | neveridle-core`

### Workspace Resolution Helpers

- `src/lib/workspaces/company-paths.ts`
  - company-scoped path remains `companyRoot/agents/<slug>`
  - when a matching `workspace-<slug>` alias exists, legacy fallback now prefers a recognized OpenClaw subworkspace at `~/.openclaw/workspace/<slug>`
  - top-level `~/.openclaw/workspace-<slug>` remains as a compatibility alias only

- `src/lib/files/workspace-resolver.ts`
  - `workspace-forge` now resolves to `/Users/timharris/.openclaw/workspace/forge`

### Runtime / Config References

- `openclaw.json` still has no live `forge` entry
- persisted OpenClaw agent state still exists under `/Users/timharris/.openclaw/agents/forge`
- no runtime mutation was needed in this pass

### UI / File API Surfaces

- `src/app/api/files/workspaces/route.ts`
  - operator workspace rails still recognize the `workspace-forge` compatibility id
  - the returned filesystem path now points to `/Users/timharris/.openclaw/workspace/forge`

- `src/app/api/orchestration/projects/[id]/workspaces/route.ts`
- `src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts`
  - both inherit the corrected fallback via `resolveAgentWorkspacePathWithLegacyFallback`

- `src/lib/workspaces/migration.ts`
  - `workspace-forge` is now classified as `manual-review` with reason `superseded_by_openclaw_subworkspace`
  - verification treats `workspace-forge` alias redirection as compatible when it points to the preferred subworkspace

## Steady State

The conservative steady state for Forge is:

- keep the active Forge record as a legacy compatibility case under `neveridle-core`
- prefer `/Users/timharris/.openclaw/workspace/forge` as the actual legacy workspace
- keep `workspace-forge` as an on-disk reviewed artifact only, not as the active compatibility target

This avoids a broader `neveridle-core` redesign while removing `workspace-forge` as the path Mission Control actively depends on.

## Changes Made

- `src/lib/workspaces/company-paths.ts`
  - added marker-gated legacy subworkspace detection
  - added `resolveLegacyOpenClawAgentWorkspacePath()`
  - updated agent fallback resolution to redirect an existing `workspace-<slug>` alias to `~/.openclaw/workspace/<slug>` when that subworkspace is recognized

- `src/lib/files/workspace-resolver.ts`
  - updated `workspace-<slug>` alias handling to route through the preferred legacy workspace helper

- `src/app/api/files/workspaces/route.ts`
  - operator rails now expose `workspace-forge` using the preferred resolved path rather than the stale top-level directory path

- `src/lib/workspaces/migration.ts`
  - marks `workspace-forge` as superseded in inventory
  - treats alias redirection to the preferred legacy workspace as `ok` in verification

- `src/lib/__tests__/workspace-root-resolution.test.ts`
  - added tests for subworkspace preference and `workspace-forge` alias routing

## Verification

- `npx tsx src/lib/__tests__/workspace-root-resolution.test.ts`
  - `8 passed, 0 failed`

- `npx tsx src/lib/__tests__/workspace-migration-tools.test.ts`
  - `4 passed, 0 failed`

- `npm run workspace:migration:verify -- --format json`
  - Forge agent now resolves to `/Users/timharris/.openclaw/workspace/forge`
  - `legacy agent workspace alias workspace-forge` reports `ok`
  - overall summary: `ok=28 warning=16 blocked=0`

## Repo Relocation Impact

`workspace-forge` is no longer a repo-relocation blocker for Mission Control itself because the application no longer prefers or requires that directory as the live compatibility path.

Remaining repo-relocation blockers are elsewhere:
- repo-path-specific launchd and script paths
- terminal page repo hardcoding
- `process.cwd()` data-dir fallback when `MC_DATA_DIR` is absent
- broader `neveridle-core` and OpenClaw coupling unrelated to the stale top-level Forge directory

## Deletion Status

`workspace-forge` is still `REVIEW`, not `SAFE_TO_REMOVE`.

Reasons:
- historical OpenClaw agent state still references it
- provenance remains uncertain
- this pass did not audit the broader OpenClaw toolchain outside Mission Control

Deletion should be handled only in a later explicit cleanup pass with backup-first approval.
