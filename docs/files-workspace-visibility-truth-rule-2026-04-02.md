# Files Workspace Visibility Truth Rule (2026-04-02)

## Problem

Operator-facing Files rails were listing generated stress workspaces (`workspace-oc-stress-*`), which polluted the UI and made fake/test artifacts look like real working environments.

## Truth Rule

HiveRunner operator-facing workspace rails now include only:

1. The primary `workspace`
2. Agent workspaces (`workspace-*`) that:
   - do **not** match stress/temp/generated/test prefixes, and
   - contain an `IDENTITY.md` file

Hidden workspace patterns:

- `workspace-oc-stress-*`
- `workspace-stress-agent-*`
- `workspace-temp-*`
- `workspace-tmp-*`
- `workspace-generated-*`
- `workspace-test-*`

## Source of Truth

- Workspace visibility logic: `src/lib/workspace-visibility.ts`
- Operator-facing workspace endpoint: `src/app/api/files/workspaces/route.ts`

