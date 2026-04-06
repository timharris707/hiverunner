# Paperclip Parity Backlog

Updated: 2026-04-06  
Source audit: [docs/paperclip-parity-audit.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/paperclip-parity-audit.md) (`88c23538`)

This file is the live tracking layer for Paperclip parity work on Mission Control. It rolls forward the original audit into status, commit linkage, and next-step guidance.

## Session Progress Summary

- Closed the two audit ship blockers:
  - `F1` canonical Tasks route defaulted to hidden project scope and could look empty
  - `F2` approvals had detail-only routing and no usable queue
- Closed the shared agent-status truth bug:
  - `T1` shared agent surfaces no longer show `working` or `LIVE` from stale `agents.status` or stale execution rows
- Partially closed the main agent-operability stack:
  - `A1` configuration
  - `A2` instructions
  - `A3` skills
  - `A4` run detail

## Status Snapshot

| Bucket | Count | Notes |
| --- | ---: | --- |
| Closed | 4 | Includes the two original ship blockers, the tasks empty-state visual blocker, and the shared agent-status truth fix |
| Partially closed | 4 | All four are materially better but not yet at Paperclip parity |
| Still open | 8 | Remaining gaps are still material, but the direct agent-status trust bug is no longer open |
| Deferred / intentionally divergent | 3 | Either product-decision items or areas MC should likely keep distinct |

## Recommended Next 5

1. `F3` Project workspaces and workspace detail  
   Reason: this remains the largest missing project-operability surface relative to Paperclip.
2. `F4` Routine detail / edit route  
   Reason: routines are still list-only in Mission Control, which keeps recurring work opaque.
3. `D1` Project configuration execution truth  
   Reason: repo/local-folder/codebase placeholders still overstate confidence and weaken operator trust.
4. `F5` + `D2` Company import/export routes and honesty cleanup  
   Reason: the current UI still implies route-backed workflows that do not actually exist.
5. `A1` Agent configuration backing depth  
   Reason: the operator surface is better now, but more runtime-control fields still need real backing or explicit provider-limited framing.

## Closed

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Tasks default scope | `/NEV/tasks` | Ship blocker | Feature/functionality | Closed | The canonical company tasks route now defaults to company-wide visibility and only scopes when the route explicitly asks for it. | `d0de73b0` | Watch for regressions if task filtering or remembered state changes again. |
| V1 | Tasks empty-first visual failure | `/NEV/tasks` | Minor | Visual/polish/layout | Closed | This was downstream of `F1`; once the hidden remembered scope was removed, the main visual failure stopped dominating the page. | `d0de73b0` | No separate action unless the tasks shell changes materially again. |
| F2 | Approvals queue/index missing | `/NEV/approvals`, `/NEV/approvals/pending`, `/NEV/approvals/all` | Ship blocker | Feature/functionality | Closed | Mission Control now has a real company approvals queue with `pending` and `all` states, nav entry, empty states, and detail drill-in. | `3d5b5eed` | Iterate only if approval depth or actions need parity beyond the queue itself. |
| T1 | Agent shown as active when not actually active | Shared agent-status surfaces, including `/NEV/agents`, `/NEV/team`, `/NEV/agents/forge/configuration`, `/NEV/agents/forge/skills`, `/NEV/agents/henry/dashboard` | Major | Data/truth/provenance | Closed | Shared agent status now comes from fresh execution evidence or fresh queued/running heartbeat evidence. Stale persisted `agents.status = working` and stale `execution_runs.status = running` rows no longer create false-positive `working` or `LIVE` states on the read path. | — | Keep the freshness thresholds aligned with engine semantics if heartbeat or execution timing policy changes. |

## Partially Closed

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Agent configuration depth | `/NEV/agents/:agentId/configuration` | Major | Feature/functionality | Partially closed | The page is materially deeper and now includes better readability, working `Reports to`, provider activation evidence, switch controls, and clearer runtime-policy framing. It is still not full Paperclip parity because several runtime controls remain read-only or unsupported. | `0a0b5c86`, `c9562a67`, `c432c7fc` | Back real timeout/grace/heartbeat/runtime fields where possible, and explicitly scope out anything that should stay provider-limited. |
| A2 | Agent instructions depth | `/NEV/agents/:agentId/instructions` | Major | Feature/functionality | Partially closed | Mission Control now shows provider-aware instruction sources, editable `SOUL.md` and profile prompt paths, provenance, and read-only role defaults. It still does not expose a true provider-native multi-file instructions bundle workflow like Paperclip. | `e379c932` | Decide whether any provider paths should gain true multi-file bundle management or remain intentionally simpler. |
| A3 | Agent skills depth | `/NEV/agents/:agentId/skills` | Major | Feature/functionality | Partially closed | The page is no longer a raw tag editor. It now distinguishes library-backed vs unmanaged declarations, shows configured library entries, and supports real attach/detach of stored declarations. It still does not prove live provider/runtime skill mounting. | `fe3b73d7` | Add backed runtime evidence or provider-native attachment visibility where possible; otherwise keep the current explicit limitations. |
| A4 | Agent run detail / transcript depth | `/NEV/agents/:agentId/runs/:runId` | Major | Feature/functionality | Partially closed | Run detail now exposes richer invocation/session/provider context and more metrics, but it still lacks full transcript depth, full prompt/environment visibility, and higher-order rerun/resume affordances. | `a371ff7d` | Add more real execution context only where schema/provider data supports it; do not fake transcript completeness. |

## Still Open

| ID | Area | Route(s) | Original severity | Original theme | Current status | Rationale | Relevant commits | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F3 | Project workspaces missing | No MC equivalent to `/projects/:id/workspaces` or `/execution-workspaces/:id` | Major | Feature/functionality | Open | No Mission Control route or equivalent workspace lifecycle surface has been added yet. | — | Add a project workspaces list and workspace detail, or choose an honest alternative IA and document it. |
| F4 | Routine detail/edit route missing | `/NEV/routines` | Major | Feature/functionality | Open | Routines remain a list-plus-inline surface with no first-class detail route. | — | Add `/routines/:routineId` with schedule, run history, edit controls, and policy details. |
| F5 | Company import/export still not route-backed | Current entry points live in org/settings, but no dedicated routes | Major | Feature/functionality | Open | The audit concern still stands: entry points exist, but the dedicated workflow pages are not present on this branch. | — | Either ship real import/export pages or remove/replace wording that implies those routes already exist. |
| U1 | Inbox archive workflow weaker than Paperclip | `/NEV/inbox` | Minor | UX/interaction | Open | This branch still has no clearly visible archive action on the live inbox list. | — | Add explicit row-level or bulk archive affordances on the inbox surface. |
| U2 | Project last-tab memory missing | `/NEV/projects/:projectSlug` redirect behavior | Minor | UX/interaction | Open | Mission Control still resets users back to the default project tab instead of preserving recent subpage context. | — | Preserve the last visited project subpage or make the redirect stateful. |
| U3 | Company skill detail lacks per-file navigation depth | `/NEV/skills/:skillId` | Minor | UX/interaction | Open | Agent-skills parity improved, but the company skill detail surface is still shallower than Paperclip’s file-level navigation model. | — | Add per-file routes or stronger in-surface file browsing on the company skills detail page. |
| D1 | Project configuration execution truth is shallow | `/NEV/projects/:projectSlug/configuration` | Major | Data/truth/provenance | Open | Repo/local-folder/codebase context is still not populated with the same level of backed execution truth as Paperclip. | — | Back those fields with real sources or remove/rename placeholders until they are trustworthy. |
| D2 | Settings/import-export copy still overstates availability | `/NEV/settings` | Major | Data/truth/provenance | Open | The honesty issue remains unless and until the route-backed import/export surfaces actually exist. | — | Align the copy to the real state immediately if the routes are not coming next. |

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
