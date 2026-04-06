# Paperclip Parity Backlog

Updated: 2026-04-07
Source audit: [docs/paperclip-parity-audit.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/paperclip-parity-audit.md) (`88c23538`)

This file is the live tracking layer for Paperclip parity work on Mission Control. It rolls forward the original audit into status, commit linkage, and next-step guidance.

## Session Progress Summary

- Closed the two audit ship blockers:
  - `F1` canonical Tasks route defaulted to hidden project scope and could look empty
  - `F2` approvals had detail-only routing and no usable queue
- Closed the shared agent-status truth bug:
  - `T1` shared agent surfaces no longer show `working` or `LIVE` from stale `agents.status` or stale execution rows
- Partially closed the largest missing project-operability surface:
  - `F3` project workspaces — workspace list + agent workspace detail routes exist with DB + filesystem backing; project and agent workspace paths are convention-derived (not persisted), which limits trust
- Closed project configuration execution truth:
  - `D1` project configuration no longer shows misleading placeholder fields; every execution-context claim is labeled with its source (Persisted, Convention, or Not available)
- Closed import/export copy honesty:
  - `D2` settings and org page no longer imply import/export dedicated pages exist; copy replaced with honest unavailability statement, dead-end buttons removed or disabled
- Partially closed routine management:
  - `F4` routine detail — first-class detail route with editable configuration, status controls, run history, and honest trigger limitations
- Partially closed the main agent-operability stack:
  - `A1` configuration
  - `A2` instructions
  - `A3` skills
  - `A4` run detail

## Status Snapshot

| Bucket | Count | Notes |
| --- | ---: | --- |
| Closed | 4 | Includes the two original ship blockers, the tasks empty-state visual blocker, and the shared agent-status truth fix |
| Closed | 6 | Includes the two original ship blockers, tasks empty-state, shared agent-status truth, project configuration truth, and import/export copy honesty |
| Partially closed | 6 | Project workspaces and routine detail added; all six are materially better but not yet at full parity |
| Still open | 4 | Remaining gaps are minor UX items and one major feature gap (import/export routes) |
| Deferred / intentionally divergent | 3 | Either product-decision items or areas MC should likely keep distinct |

## Recommended Next 5

1. `A1` Agent configuration backing depth
   Reason: the operator surface is better now, but more runtime-control fields still need real backing or explicit provider-limited framing.
2. `U1` Inbox archive workflow
   Reason: the inbox is functional but archive/cleanup affordances are still weaker than Paperclip's.
3. `U2` Project last-tab memory
   Reason: Mission Control still resets users to the default project tab on navigation.
4. `U3` Company skill detail per-file navigation
   Reason: skill detail is still shallower than Paperclip's file-level browsing model.
5. `F5` Company import/export routes
   Reason: the honesty gap (D2) is now closed, but the actual feature remains unimplemented. Large scope, lower priority than the above.

## Closed

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Tasks default scope | `/NEV/tasks` | Ship blocker | Feature/functionality | Closed | The canonical company tasks route now defaults to company-wide visibility and only scopes when the route explicitly asks for it. | `d0de73b0` | Watch for regressions if task filtering or remembered state changes again. |
| V1 | Tasks empty-first visual failure | `/NEV/tasks` | Minor | Visual/polish/layout | Closed | This was downstream of `F1`; once the hidden remembered scope was removed, the main visual failure stopped dominating the page. | `d0de73b0` | No separate action unless the tasks shell changes materially again. |
| F2 | Approvals queue/index missing | `/NEV/approvals`, `/NEV/approvals/pending`, `/NEV/approvals/all` | Ship blocker | Feature/functionality | Closed | Mission Control now has a real company approvals queue with `pending` and `all` states, nav entry, empty states, and detail drill-in. | `3d5b5eed` | Iterate only if approval depth or actions need parity beyond the queue itself. |
| T1 | Agent shown as active when not actually active | Shared agent-status surfaces, including `/NEV/agents`, `/NEV/team`, `/NEV/agents/forge/configuration`, `/NEV/agents/forge/skills`, `/NEV/agents/henry/dashboard` | Major | Data/truth/provenance | Closed | Shared agent status now comes from fresh execution evidence or fresh queued/running heartbeat evidence. Stale persisted `agents.status = working` and stale `execution_runs.status = running` rows no longer create false-positive `working` or `LIVE` states on the read path. | — | Keep the freshness thresholds aligned with engine semantics if heartbeat or execution timing policy changes. |
| D1 | Project configuration execution truth | `/NEV/projects/:projectSlug/configuration` | Major | Data/truth/provenance | Closed | The old Codebase section showed "—" dashes for Repo and Local Folder fields that had no schema backing, implying the data was merely empty rather than unsupported. The section was replaced with an honest Execution Context surface: company workspace root (Persisted badge, DB-backed), project directory (Convention badge, convention-derived and filesystem-verified), repository (explicitly stated as not available — no column in schema), assigned agents with workspace existence indicators, and a provenance note explaining the data model. The misleading duplicated "Updated" date (which used `created_at`) was also removed. | — | If a persisted repo or workspace_path column is added to the projects table, upgrade the Convention badges to Persisted. |
| D2 | Settings/import-export copy honesty | `/NEV/settings`, `/NEV/org` | Major | Data/truth/provenance | Closed | The settings page said "Import and export have moved to dedicated pages accessible from the Org Chart header" — those pages did not exist. Two dead-end Export/Import buttons had no handlers. The org page had Import/Export header buttons with no onClick. Fixed: settings copy replaced with honest unavailability statement, dead-end buttons removed, org header buttons made visually disabled with "not yet available" tooltips. The UI no longer implies functionality that does not exist. | — | When import/export routes are actually implemented (F5), re-enable the org header buttons and link them. |

## Partially Closed

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F3 | Project workspaces | `/NEV/projects/:projectSlug/workspaces`, `/NEV/projects/:projectSlug/workspaces/:agentSlug` | Major | Feature/functionality | Partially closed | The route contract exists: workspace list tab with company root, project dir, per-agent workspace cards, and execution context; workspace detail with filesystem contents, git info, identity, and run history. **However**, project directory paths and agent workspace paths are convention-derived (`{root}/projects/{slug}`, `~/.openclaw/workspace-{slug}`), not persisted. No `workspace_path` column exists on the `projects` or `agents` tables. The company `workspace_root` is persisted truth, but everything below it is inferred convention verified against the filesystem. The UI now explicitly labels all paths with their source (Persisted vs Convention) and the provenance footer explains the inference model. Paperclip's equivalent route currently redirects to issues and renders empty, but the lack of persisted project/agent workspace paths means MC's surface cannot be called fully source-of-truth-backed. | `08f8f231` | Add a persisted `workspace_path` column to projects and/or agents, or resolve workspace paths from adapter config, so paths are source-of-truth rather than convention-inferred. Until then, the convention model is honest but not durable. |
| A1 | Agent configuration depth | `/NEV/agents/:agentId/configuration` | Major | Feature/functionality | Partially closed | The page is materially deeper and now includes better readability, working `Reports to`, provider activation evidence, switch controls, and clearer runtime-policy framing. It is still not full Paperclip parity because several runtime controls remain read-only or unsupported. | `0a0b5c86`, `c9562a67`, `c432c7fc` | Back real timeout/grace/heartbeat/runtime fields where possible, and explicitly scope out anything that should stay provider-limited. |
| A2 | Agent instructions depth | `/NEV/agents/:agentId/instructions` | Major | Feature/functionality | Partially closed | Mission Control now shows provider-aware instruction sources, editable `SOUL.md` and profile prompt paths, provenance, and read-only role defaults. It still does not expose a true provider-native multi-file instructions bundle workflow like Paperclip. | `e379c932` | Decide whether any provider paths should gain true multi-file bundle management or remain intentionally simpler. |
| A3 | Agent skills depth | `/NEV/agents/:agentId/skills` | Major | Feature/functionality | Partially closed | The page is no longer a raw tag editor. It now distinguishes library-backed vs unmanaged declarations, shows configured library entries, and supports real attach/detach of stored declarations. It still does not prove live provider/runtime skill mounting. | `fe3b73d7` | Add backed runtime evidence or provider-native attachment visibility where possible; otherwise keep the current explicit limitations. |
| A4 | Agent run detail / transcript depth | `/NEV/agents/:agentId/runs/:runId` | Major | Feature/functionality | Partially closed | Run detail now exposes richer invocation/session/provider context and more metrics, but it still lacks full transcript depth, full prompt/environment visibility, and higher-order rerun/resume affordances. | `a371ff7d` | Add more real execution context only where schema/provider data supports it; do not fake transcript completeness. |
| F4 | Routine detail/edit | `/NEV/routines/:routineId` | Major | Feature/functionality | Partially closed | The routine detail route now exists with editable title, instructions, assignee, project, concurrency and catch-up policy, status toggle (active/paused), Run Now, priority/dates properties, run history table, and honest trigger limitation note. Editing works via the existing PATCH API and reloads on save. Run Now creates a routine_run record and the runs table updates live. **Still missing vs Paperclip**: trigger configuration (schedule/webhook/cron UI), activity audit log, and variable placeholder support in instructions. The trigger gap is called out honestly in the UI. | — | Add trigger configuration UI if/when the engine supports scheduled triggers. Add activity audit log if the event model supports it. |

## Still Open

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F5 | Company import/export not route-backed | No dedicated import/export routes | Major | Feature/functionality | Open | The copy/honesty gap (D2) is now closed — settings and org no longer imply these pages exist. However, the actual import/export workflow (package assembly, selective file export, zip upload, collision resolution) remains unimplemented. Paperclip has full export with file tree and selective download, plus import with GitHub/zip source and conflict strategy. | — | Implement real import/export pages if the feature is prioritized. This is a major feature, not a truth gap. |
| U1 | Inbox archive workflow weaker than Paperclip | `/NEV/inbox` | Minor | UX/interaction | Open | This branch still has no clearly visible archive action on the live inbox list. | — | Add explicit row-level or bulk archive affordances on the inbox surface. |
| U2 | Project last-tab memory missing | `/NEV/projects/:projectSlug` redirect behavior | Minor | UX/interaction | Open | Mission Control still resets users back to the default project tab instead of preserving recent subpage context. | — | Preserve the last visited project subpage or make the redirect stateful. |
| U3 | Company skill detail lacks per-file navigation depth | `/NEV/skills/:skillId` | Minor | UX/interaction | Open | Agent-skills parity improved, but the company skill detail surface is still shallower than Paperclip’s file-level navigation model. | — | Add per-file routes or stronger in-surface file browsing on the company skills detail page. |

## Deferred / Intentionally Divergent

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F6 | Instance/global settings surface | No MC equivalent to `/instance/settings/*` | Major | Feature/functionality | Deferred | This is still absent, but it is a product-boundary decision as much as a parity task. Mission Control may not want to expose full instance-level controls in the same way Paperclip does. | — | Make an explicit product decision: add instance settings, or document that MC intentionally omits them. |
| V2 | Utility-page polish on settings/routines/approvals | `/NEV/settings`, `/NEV/routines`, `/NEV/approvals/*` | Minor | Visual/polish/layout | Deferred | Functional work should stay ahead of a generalized polish pass. Several utility surfaces are better now, but there is no reason to prioritize polish over missing operator workflows yet. | `3d5b5eed` | Revisit after the remaining functional parity gaps land. |
| D3 | Provider/runtime conceptual split should remain | `/NEV/agents/:agentId/configuration` | n/a | Intentional positive divergence | Intentionally divergent | Mission Control’s clearer separation of current runtime, current provider, and observability/capabilities is still stronger than Paperclip and should not be flattened for the sake of visual parity. | `813e95a6`, `c432c7fc` | Preserve this model while deepening supported controls. |

## Recommended Divergences To Keep

- Keep the explicit runtime/provider split on agent configuration.
- Keep the separate `Team` and `Org` views rather than collapsing them into one roster surface.
- Keep Mission Control’s stronger provenance framing on provider capabilities and run/source truth.
- Keep richer cost breakdowns where Mission Control already exceeds Paperclip.

## Notes On Progress Credit

- `Closed` means the underlying audited gap is actually removed on this branch, not merely improved.
- `Partially closed` means the operator value is materially better, but the surface is still behind Paperclip or still limited by real backing data.
- `Still open` items should remain visible even if adjacent surfaces improved.
- `Deferred` is not the same as solved; it means a product decision or sequencing call is still pending.
