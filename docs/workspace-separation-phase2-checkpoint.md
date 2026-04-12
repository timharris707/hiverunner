# Workspace Separation Phase 2 Checkpoint

Date: 2026-04-11

This checkpoint is the explicit Phase 2 boundary for workspace separation.
It is intentionally documented as a file list instead of a git commit because
the working tree contains unrelated local edits outside the workspace
separation scope.

Pre-existing test failure carried forward out of Phase 3 scope:

- `ORCHESTRATION_DB_PATH=/tmp/orchestration-company-workspace-phase2-followup.db npx tsx src/lib/__tests__/orchestration-company-workspace-project-scope.test.ts`
- Failing assertion: `company-scoped projects route excludes non-production by default`
- Root cause: [project.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/service/project.ts:30) forces `includeNonProduction = true` whenever `companyIdOrSlug` is set.
- Status: pre-existing baseline behavior, not introduced by Phase 2, and out of scope for Phase 3.

## Intentional Phase 2 File Boundary

Core workspace abstraction and safety:

- [src/lib/workspaces/root.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/workspaces/root.ts)
- [src/lib/workspaces/company-paths.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/workspaces/company-paths.ts)
- [src/lib/workspaces/delete-safety.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/workspaces/delete-safety.ts)

Company creation, resolution, and provisioning:

- [src/lib/orchestration/company-service.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/company-service.ts)
- [src/lib/orchestration/service/company-agent-provisioning.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/service/company-agent-provisioning.ts)
- [src/app/api/orchestration/companies/create-full/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/orchestration/companies/create-full/route.ts)
- [src/app/api/orchestration/companies/[slug]/agents/hire/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/orchestration/companies/[slug]/agents/hire/route.ts)

Workspace compatibility and file APIs:

- [src/lib/files/workspace-resolver.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/files/workspace-resolver.ts)
- [src/app/api/files/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/route.ts)
- [src/app/api/files/delete/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/delete/route.ts)
- [src/app/api/files/write/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/write/route.ts)
- [src/app/api/files/download/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/download/route.ts)
- [src/app/api/files/mkdir/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/mkdir/route.ts)
- [src/app/api/files/upload/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/upload/route.ts)
- [src/app/api/files/workspaces/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/files/workspaces/route.ts)
- [src/app/api/browse/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/browse/route.ts)

Project and agent workspace resolution:

- [src/app/api/orchestration/projects/[id]/workspaces/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/orchestration/projects/[id]/workspaces/route.ts)
- [src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts)
- [src/app/(dashboard)/companies/[slug]/projects/[projectSlug]/files/page.tsx](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/(dashboard)/companies/[slug]/projects/[projectSlug]/files/page.tsx)

Runtime config and safety plumbing:

- [src/lib/orchestration/service/provider-activation.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/service/provider-activation.ts)
- [scripts/cleanup-test-artifacts.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/cleanup-test-artifacts.ts)
- [scripts/run_dev_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/run_dev_service.sh)
- [scripts/run_stable_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/run_stable_service.sh)
- [config/com.harris-autonomous.mc-dev.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harris-autonomous.mc-dev.plist)
- [config/com.harris-autonomous.mc-stable.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harris-autonomous.mc-stable.plist)
- [server.js](/Users/timharris/.openclaw/workspace/projects/mission-control-app/server.js)

Docs and tests:

- [README.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/README.md)
- [docs/two-lane-runtime.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/two-lane-runtime.md)
- [docs/workspace-separation-rfc.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/workspace-separation-rfc.md)
- [src/lib/__tests__/provider-activation.test.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/__tests__/provider-activation.test.ts)
- [src/lib/__tests__/workspace-root-resolution.test.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/__tests__/workspace-root-resolution.test.ts)
- [src/lib/__tests__/workspace-delete-safety.test.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/__tests__/workspace-delete-safety.test.ts)
- [src/lib/__tests__/orchestration-company-workspace-project-scope.test.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/__tests__/orchestration-company-workspace-project-scope.test.ts)

Copy-only Phase 2 adjustments inside already-dirty UI files:

- [src/app/companies/new/page.tsx](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/companies/new/page.tsx)
- [src/components/orchestration/CreateCompanyModal.tsx](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/components/orchestration/CreateCompanyModal.tsx)

## Known Phase 2 Debt

- [create-full/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/orchestration/companies/create-full/route.ts) now goes through `createCompany()` for the company row, but it still retains separate CEO/OpenClaw provisioning logic.
- Existing persisted `workspace_root` rows are compatibility-resolved only. No existing company rows have been normalized or migrated.
- `neveridle-core` remains an explicit OpenClaw-backed compatibility company and is not part of the auto-migration set.
