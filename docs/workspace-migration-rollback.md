# Workspace Migration Rollback Procedure

Status: Phase 3 tooling only
Date: 2026-04-11

This document defines the rollback procedure for the future workspace cutover.
Phase 3 does not perform the cutover. It only adds the inventory, snapshot,
dry-run, and verification tools that make a rollback conservative and auditable.

## Scope

This rollback procedure applies to Phase 4 cutover work that will:

- copy eligible company workspaces from legacy OpenClaw-owned roots into `MC_WORKSPACE_ROOT`
- update existing company `workspace_root` rows after backup
- verify compatibility before resuming the lane

This procedure does not apply to:

- `neveridle-core`
- orphaned directories with no matching company row
- legacy top-level `workspace-*` agent directories that remain compatibility-only

## Backup-First Rule

Before any Phase 4 cutover step:

1. Run a fresh dry-run report.
2. Review all `manual-review` and `blocked` items.
3. Write a snapshot manifest and DB row snapshot.
4. Copy the eligible source workspace directories into the snapshot output.
5. Only then perform any directory copy or DB row update.

If any of those preconditions fail, stop the cutover.

## Required Commands

Review the current state:

```sh
npm run workspace:migration:dry-run
npm run workspace:migration:verify
```

Write the snapshot before Phase 4 touches anything:

```sh
npx tsx scripts/workspace-migration.ts snapshot --write --copy-workspaces
```

If operator review requires orphaned directories to be preserved alongside the
DB-backed company roots:

```sh
npx tsx scripts/workspace-migration.ts snapshot --write --copy-workspaces --include-orphaned-directories
```

The snapshot output root defaults to:

```text
$(dirname "$(dirname "$MC_WORKSPACE_ROOT")")/backups/migration/<lane>/<snapshot-id>
```

Example stable-lane target:

```text
~/.mission-control/backups/migration/stable/workspace-separation-stable-...
```

## Snapshot Contents

Each snapshot contains:

- `manifest.json`
- `db/companies.json`
- `db/projects.json`
- `db/agents.json`
- `directories/<company-slug>-<company-id>/...` for copied workspaces when `--copy-workspaces` is used

The DB snapshot is the source of truth for restoring company row metadata.
The copied directory trees are the source of truth for restoring migrated
workspace contents.

## Rollback Trigger Conditions

Trigger rollback immediately if any of these happen during Phase 4:

- post-cutover verification reports blocked items that were not present pre-cutover
- a copied destination root contains unexpected collisions or partial data
- file APIs or project/agent workspace resolution point at the wrong company root
- deletion safety classification changes unexpectedly for a migrated company root
- any DB update writes a `workspace_root` value that does not match the intended company

## Rollback Steps

1. Stop the affected Mission Control lane.
2. Preserve the failed cutover state for forensic comparison.
3. Restore company rows from the snapshot JSON.
4. Restore legacy company workspace directories from the copied snapshot trees if Phase 4 modified or removed them.
5. Remove any partially created destination directories from `MC_WORKSPACE_ROOT` only if they are confirmed to belong to the failed cutover and are safe to delete.
6. Re-run verification tooling.
7. Restart the lane only after verification returns to the pre-cutover baseline.

## DB Row Restore Procedure

Use the snapshot `db/companies.json` as the authoritative source.

For each restored company:

- restore `workspace_root`
- restore `workspace_source`
- do not rewrite `neveridle-core`
- do not rewrite companies that were intentionally excluded from the cutover

Phase 4 should automate the SQL restore script generation from `db/companies.json`
rather than relying on manual edits during an incident.

## Directory Restore Procedure

Use the copied workspace snapshot under `directories/`.

For each company selected for rollback:

1. Confirm the legacy source path from the snapshot manifest.
2. Confirm the copied snapshot directory exists and matches the company id/slug.
3. Restore the workspace contents back to the legacy source path.
4. Leave orphaned directories alone unless the rollback plan explicitly included them.

Do not restore directories into `neveridle-core`. It remains OpenClaw-backed.

## Verification After Rollback

Run:

```sh
npm run workspace:migration:verify
npm run workspace:migration:dry-run
```

Expected post-rollback state:

- all previously migrated companies resolve back to their legacy source roots
- default `workspace` alias still points to the OpenClaw workspace
- company/project/agent resolution matches the pre-cutover baseline
- deletion safety returns to the pre-cutover classification set
- `neveridle-core` remains blocked from auto-migration

## Operator Notes

- Treat orphaned directories as separate evidence, not as implicit company roots.
- Do not normalize `workspace_source` values during rollback unless the cutover explicitly changed them.
- Keep the pre-cutover dry-run report together with the snapshot manifest so the operator can compare expected and actual state quickly.
