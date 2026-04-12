# Workspace Migration Dry Run

- Generated: 2026-04-11T19:15:18.689Z
- Mode: dry-run only
- Snapshot output root: `/Users/timharris/.mission-control/stable/migration-backups/workspace-separation-stable-2026-04-11T19-15-18-690Z`
- Snapshot DB rows: companies=5, projects=18, agents=9
- Snapshot directory sources: 4
- Lane: stable
- DB: `/Users/timharris/.openclaw/workspace/projects/mission-control-app/data/orchestration.db`
- MC workspace root: `/Users/timharris/.mission-control/stable/workspaces`
- OpenClaw dir: `/Users/timharris/.openclaw`

## Summary

- Companies: 5
- Safe auto-migrate: 4
- Manual review: 0
- Blocked: 1
- Orphaned directories: 8
- Legacy agent directories: 1

## Companies

| Company | Classification | Current workspace_root | Proposed destination | Source exists | Destination exists | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| neveridle-core | blocked | `/Users/timharris/.openclaw/workspace` | `/Users/timharris/.mission-control/stable/workspaces/companies/6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f` | yes | no | default_company_explicit_openclaw_compatibility, neveridle-core is excluded from auto-migration, unsafe_source_root:openclaw-default-workspace |
| cascade-inc | safe-auto-migrate | `/Users/timharris/.openclaw/workspaces/cascade-inc` | `/Users/timharris/.mission-control/stable/workspaces/companies/53351dd9-641c-4bf8-aed0-4472188b6cf4` | yes | no | legacy_openclaw_workspaces_source |
| river-s-edge | safe-auto-migrate | `/Users/timharris/.openclaw/workspaces/river-s-edge` | `/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c` | yes | no | legacy_openclaw_workspaces_source |
| virtual-design-house | safe-auto-migrate | `/Users/timharris/.openclaw/workspaces/virtual-design-house` | `/Users/timharris/.mission-control/stable/workspaces/companies/830d5f6b-b9f1-4288-ada5-89868513c21d` | yes | no | legacy_openclaw_workspaces_source |
| tims-jobs | safe-auto-migrate | `/Users/timharris/.openclaw/workspaces/tims-jobs` | `/Users/timharris/.mission-control/stable/workspaces/companies/d5f5283f-9421-434c-a31c-7a5a3570b1df` | yes | no | legacy_openclaw_workspaces_source |

## Orphaned Directories

- `/Users/timharris/.openclaw/workspace/companies/ee259939-58f5-49bd-b113-c5a849c99cdf`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_company_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/bobs-burger`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/burgers-r-us`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/fancy-for-feet`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/fresh-pizza-co`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/rocket-donuts`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/taco-palace`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row
- `/Users/timharris/.openclaw/workspaces/test-tacos-inc`
  classification: manual-review
  reasons: no_matching_company_row, legacy_openclaw_workspace_directory_without_db_row

## Legacy Agent Directories

- `/Users/timharris/.openclaw/workspace-forge`
  classification: legacy-compatible
  reasons: matched agent row

## Snapshot Preflight

- `/Users/timharris/.openclaw/workspaces/cascade-inc`
  company: cascade-inc
  exists: yes
  classification: safe-auto-migrate
  reasons: legacy_openclaw_workspaces_source
- `/Users/timharris/.openclaw/workspaces/river-s-edge`
  company: river-s-edge
  exists: yes
  classification: safe-auto-migrate
  reasons: legacy_openclaw_workspaces_source
- `/Users/timharris/.openclaw/workspaces/virtual-design-house`
  company: virtual-design-house
  exists: yes
  classification: safe-auto-migrate
  reasons: legacy_openclaw_workspaces_source
- `/Users/timharris/.openclaw/workspaces/tims-jobs`
  company: tims-jobs
  exists: yes
  classification: safe-auto-migrate
  reasons: legacy_openclaw_workspaces_source