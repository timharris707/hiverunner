# Paperclip Parity Audit

Date: 2026-04-06
Lane: DEV Mission Control `http://127.0.0.1:3000`
Reference: Paperclip `http://127.0.0.1:3101`

## Scope

This audit compares Mission Control against the shared Paperclip surface area only.

- Mission Control-only surfaces were excluded.
- Paperclip `/issues` was treated as the canonical equivalent of Mission Control `/tasks`.
- The audit covered both route definitions and live rendered pages.
- The audit deliberately checked subpages, not just landing pages.

Route evidence came from:

- Mission Control route tree under `src/app/(dashboard)/companies/[slug]/...`
- Paperclip board routes in `ui/src/App.tsx`
- Live browser inspection on `3000` and `3101`

Live coverage:

- 56 page loads
- about 50 unique concrete URLs
- 30+ mapped route patterns

## Executive Summary

Mission Control is closest to Paperclip on `Dashboard`, `Goals`, `Costs`, `Activity`, and the broad company/org shell. It is materially behind on the operator work queue and the agent-operability stack: `Tasks`, `Approvals`, `Agent Configuration`, `Agent Instructions`, `Agent Skills`, `Agent Runs`, `Project Workspaces`, and `Routine Detail`.

The biggest parity problems are not visual. They are operational:

1. Mission Control’s canonical work queue can appear empty by default on `/NEV/tasks`.
2. Mission Control has no approvals index, while Paperclip exposes pending/all approvals as a first-class workflow.
3. Mission Control agent run detail is much thinner than Paperclip’s run transcript/invocation surface.
4. Mission Control agent configuration is honest but much less operable than Paperclip’s adapter/runtime controls.
5. Mission Control project detail lacks Paperclip’s workspace layer entirely.

Overall parity judgment: `3.0 / 5`

- Mission Control is credible as a board UI.
- Mission Control is not yet at live parity for operator control depth.
- The biggest missing areas are agent execution surfaces and workflow plumbing, not just polish.

## Scored Summary

| Area | Paperclip routes sampled | Mission Control routes sampled | Feature | Interaction | Truth | Visual | Overall | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `/TIM/dashboard` | `/NEV/dashboard` | 4 | 4 | 4 | 4 | 4.0 | Acceptable divergence |
| Inbox | `/TIM/inbox/mine` | `/NEV/inbox` | 4 | 3 | 4 | 3 | 3.5 | Minor gap |
| Tasks / Issues list + detail | `/TIM/issues`, `/TIM/issues/TIM-6` | `/NEV/tasks`, `/NEV/tasks/NEV-45` | 2 | 2 | 3 | 3 | 2.5 | Ship blocker |
| Goals list + detail | `/TIM/goals`, `/TIM/goals/:id` | `/NEV/goals`, `/NEV/goals/:id` | 4 | 4 | 4 | 3 | 3.8 | Acceptable divergence |
| Agents roster + org | `/TIM/agents/all`, `/TIM/org` | `/NEV/team`, `/NEV/org` | 4 | 4 | 4 | 4 | 4.0 | Acceptable divergence |
| Agent detail subpages | `/TIM/agents/codesmith/{dashboard,instructions,skills,configuration,runs,runs/:id,budget}` | `/NEV/agents/forge/{dashboard,instructions,skills,configuration,runs,runs/:id,budget}` | 2 | 3 | 3 | 3 | 2.8 | Major gap |
| Projects list + detail | `/TIM/projects`, `/TIM/projects/onboarding/{issues,overview,configuration,budget}` | `/NEV/projects`, `/NEV/projects/henry-voice/{tasks,overview,configuration,budget}` | 3 | 3 | 4 | 3 | 3.3 | Major gap |
| Skills library + detail | `/TIM/skills/:id` | `/NEV/skills`, `/NEV/skills/polygon-data` | 3 | 3 | 4 | 3 | 3.3 | Major gap |
| Costs | `/TIM/costs` | `/NEV/costs` | 5 | 4 | 5 | 4 | 4.5 | Acceptable divergence |
| Activity | `/TIM/activity` | `/NEV/activity` | 4 | 4 | 4 | 3 | 3.8 | Acceptable divergence |
| Routines | `/TIM/routines` | `/NEV/routines` | 2 | 2 | 3 | 3 | 2.5 | Major gap |
| Company settings | `/TIM/company/settings` | `/NEV/settings` | 3 | 3 | 4 | 3 | 3.3 | Major gap |
| Instance / global settings | `/instance/settings/general` | none | 0 | 0 | 0 | 0 | 0.0 | Major gap |
| Approvals | `/TIM/approvals/pending` and approval detail route support | no company approvals index; detail route only | 1 | 1 | 2 | 2 | 1.5 | Ship blocker |

## Top 10 Recommendations

1. Fix `/NEV/tasks` so the default view always shows work instead of silently inheriting an empty project scope from remembered state.
2. Add a company approvals index with `Pending` and `All` states, then wire it into the main company workflow.
3. Expand agent run detail to include invocation metadata, prompt/context, token and cost metrics, raw transcript depth, and resume/re-run affordances where honest.
4. Expand agent configuration from profile editing into a true runtime control surface: adapter type, command/model controls, heartbeat policy, env vars, and timeout/grace fields.
5. Add multi-file agent instructions management for supported providers and make unsupported providers explicit instead of collapsing everything into a single prompt editor.
6. Replace raw agent skill tags with a managed skill attachment surface tied to the company skills library, including unsupported/unmanaged state.
7. Add project workspace surfaces or an honest equivalent for repo/local-folder/workspace lifecycle management.
8. Add routine detail/edit pages instead of keeping routines as a list-plus-inline-composer only.
9. Split company settings from instance/global settings the way Paperclip does, or explicitly decide that Mission Control will not expose instance controls and remove misleading equivalence.
10. Finish the company import/export experience with dedicated pages or remove the current “moved to dedicated pages” wording until those routes exist.

## Major Themes

### 1. Mission Control is strongest where it behaves like a company board

Mission Control is already competitive on:

- dashboard summaries
- org and team overview
- goals
- costs
- activity

Those pages largely work, and they do not feel obviously behind on truthfulness.

### 2. Mission Control is behind where Paperclip acts like an operator console

Paperclip is meaningfully ahead on:

- approvals workflow
- agent execution controls
- instruction bundle management
- managed skills attachment
- run transcript and invocation detail
- project workspace management

These are not cosmetic gaps. They affect whether an operator can understand and steer the system.

### 3. Mission Control is sometimes more honest than Paperclip

Mission Control is already better in a few places:

- agent configuration explicitly separates current runtime from current provider
- provider capabilities and observability tiering are surfaced directly
- Paperclip-backed run detail is annotated with bridge-sync provenance and tier limitations

That honesty should be preserved. Parity should not mean flattening those strengths away.

## Route Inventory Matrix

| Paperclip route | Mission Control equivalent | Status | Notes |
| --- | --- | --- | --- |
| `/:company/dashboard` | `/:companyCode/dashboard` | Matched | Both are active landing dashboards. |
| `/:company/inbox/{mine,recent,unread,all}` | `/:companyCode/inbox` with tabs | Partial | MC has tabs and read-state controls, but no visible archive action on the inbox list. |
| `/:company/issues` | `/:companyCode/tasks` | Partial | Canonical mapping works, but MC default behavior can render an empty board. |
| `/:company/issues/:issueId` | `/:companyCode/tasks/:taskKey` | Partial | Both have detail pages; Paperclip detail has stronger property editing and timeline framing. |
| `/:company/goals` | `/:companyCode/goals` | Matched | Comparable list views. |
| `/:company/goals/:goalId` | `/:companyCode/goals/:goalId` | Matched | Both expose core goal detail. |
| `/:company/agents/all|active|paused|error` | `/:companyCode/team` and redirecting `/:companyCode/agents` | Intentionally different | MC splits roster and org context more explicitly. |
| `/:company/org` | `/:companyCode/org` | Matched | Both expose org charts with import/export entry points. |
| `/:company/agents/:agentId/dashboard` | `/:companyCode/agents/:agentId/dashboard` | Matched | Both expose dashboard-style agent summaries. |
| `/:company/agents/:agentId/instructions` | `/:companyCode/agents/:agentId/instructions` | Partial | MC exists, but depth is much lower. |
| `/:company/agents/:agentId/skills` | `/:companyCode/agents/:agentId/skills` | Partial | MC exists, but uses raw tags instead of managed skill attachment. |
| `/:company/agents/:agentId/configuration` | `/:companyCode/agents/:agentId/configuration` | Partial | MC exists, but lacks most adapter/runtime control fields. |
| `/:company/agents/:agentId/runs` | `/:companyCode/agents/:agentId/runs` | Partial | MC exists, but list depth is lower. |
| `/:company/agents/:agentId/runs/:runId` | `/:companyCode/agents/:agentId/runs/:runId` | Partial | MC exists, but transcript/invocation detail is much thinner. |
| `/:company/agents/:agentId/budget` | `/:companyCode/agents/:agentId/budget` | Matched | Both have budget/cost summary surfaces. |
| `/:company/projects` | `/:companyCode/projects` | Matched | Comparable project list pages. |
| `/:company/projects/:projectId/issues` | `/:companyCode/projects/:projectSlug/tasks` | Partial | Canonical mapping works, but MC lacks Paperclip’s workspaces branch and remembered-tab behavior. |
| `/:company/projects/:projectId/overview` | `/:companyCode/projects/:projectSlug/overview` | Matched | Both expose high-level project info. |
| `/:company/projects/:projectId/configuration` | `/:companyCode/projects/:projectSlug/configuration` | Partial | MC exists, but Paperclip includes goal linkage and codebase controls. |
| `/:company/projects/:projectId/budget` | `/:companyCode/projects/:projectSlug/budget` | Matched | Near parity; MC even adds cost breakdown detail. |
| `/:company/projects/:projectId/workspaces` | none | Missing | No MC equivalent route. |
| `/execution-workspaces/:workspaceId` | none | Missing | No MC equivalent route. |
| `/:company/skills` | `/:companyCode/skills` | Matched | Both expose company skills libraries. |
| `/:company/skills/:skillId` | `/:companyCode/skills/:skillId` | Partial | Both have detail views; Paperclip goes deeper on file navigation and attachment context. |
| `/:company/skills/:skillId/files/:path` | none | Missing | No MC per-file skill route. |
| `/:company/costs` | `/:companyCode/costs` | Matched | Strong parity. |
| `/:company/activity` | `/:companyCode/activity` | Matched | Strong parity. |
| `/:company/routines` | `/:companyCode/routines` | Partial | Both have list pages, but MC has no detail route. |
| `/:company/routines/:routineId` | none | Missing | No MC routine detail route. |
| `/:company/company/settings` | `/:companyCode/settings` | Partial | MC company settings exist, but are shallower. |
| `/:company/company/export/*` | org/settings buttons only | Missing | MC exposes entry points but no dedicated export route. |
| `/:company/company/import` | org/settings buttons only | Missing | MC exposes entry points but no dedicated import route. |
| `/:company/approvals/pending` and `/:company/approvals/all` | none | Missing | No MC approvals index route. |
| `/:company/approvals/:approvalId` | `/:companyCode/approvals/:approvalId` | Partial | MC detail route exists, but without an index it is not a usable workflow. |
| `/instance/settings/{general,heartbeats,experimental,plugins}` | none | Missing | MC has no equivalent instance-level settings surface. |

## Findings Backlog

### Feature / Functionality Gaps

#### F1. Ship blocker: the canonical Mission Control work queue can render empty by default

- Category: feature/functionality
- Severity: ship blocker
- Routes: Paperclip `/TIM/issues`; Mission Control `/NEV/tasks`
- Paperclip has: a visible issues list immediately on page load
- Mission Control has: `No tasks match filters.` on the canonical route because the page applies remembered active-project state before showing any work
- Why it matters: the primary operator queue looks broken even when the company has tasks
- Recommended fix: make `/tasks` default to company-wide scope unless a route param or explicit UI selection narrows it; show the active project filter explicitly when it is active
- Scope: M

#### F2. Ship blocker: no approvals index exists in Mission Control

- Category: feature/functionality
- Severity: ship blocker
- Routes: Paperclip `/TIM/approvals/pending`, `/TIM/approvals/all`; Mission Control none
- Paperclip has: first-class approvals list states and a clear approvals workflow entry point
- Mission Control has: only a detail route file for `/companies/[slug]/approvals/[approvalId]`
- Why it matters: approval requests are not operable as a queue in Mission Control
- Recommended fix: add company approvals list routes and navigation first, then wire detail views off that list
- Scope: M

#### F3. Major: Mission Control has no project workspace surface

- Category: feature/functionality
- Severity: major
- Routes: Paperclip `/TIM/projects/onboarding/workspaces`, `/execution-workspaces/:id`; Mission Control none
- Paperclip has: workspace summaries and dedicated workspace detail routes
- Mission Control has: no workspace routes; project detail stops at tasks/overview/configuration/budget
- Why it matters: operators cannot inspect repo/folder execution context at the project level
- Recommended fix: add project workspaces list and workspace detail pages, or explicitly model the same information under project configuration if a different IA is preferred
- Scope: L

#### F4. Major: Mission Control routines stop at the list surface

- Category: feature/functionality
- Severity: major
- Routes: Paperclip `/TIM/routines`, `/TIM/routines/:id`; Mission Control `/NEV/routines`
- Paperclip has: a detail route contract for recurring workflow inspection and editing
- Mission Control has: a good list page with inline create/edit affordances, but no detail route
- Why it matters: recurring work is not inspectable as a first-class entity
- Recommended fix: add `/routines/:routineId` with schedule, runs, and policy details
- Scope: M

#### F5. Major: Mission Control company import/export is still an entry point, not a real surface

- Category: feature/functionality
- Severity: major
- Routes: Paperclip `/TIM/company/export/*`, `/TIM/company/import`; Mission Control org/settings buttons only
- Paperclip has: dedicated import/export pages
- Mission Control has: import/export buttons and copy that says dedicated pages exist, but no dedicated routes in `src/app`
- Why it matters: the UI implies functionality that is not actually present as a navigable workflow
- Recommended fix: ship real import/export pages or change the copy and disable/remove the dead-end affordance
- Scope: M

#### F6. Major: Mission Control has no instance-level settings surface

- Category: feature/functionality
- Severity: major
- Routes: Paperclip `/instance/settings/general`, `/heartbeats`, `/experimental`, `/plugins`; Mission Control none
- Paperclip has: instance/global operator settings separated from company settings
- Mission Control has: only company settings
- Why it matters: company-scoped settings and instance-scoped settings are collapsed conceptually, which limits operator control and muddies ownership
- Recommended fix: add an explicit instance settings IA or document that MC intentionally omits instance controls
- Scope: L

### Agent Operability Gaps

#### A1. Major: Mission Control agent configuration is much thinner than Paperclip’s runtime-control surface

- Category: feature/functionality
- Severity: major
- Routes: `/TIM/agents/codesmith/configuration` vs `/NEV/agents/forge/configuration`
- Paperclip has: adapter type, command, model, thinking effort, Chrome toggle, permissions toggle, max turns, env vars, seal mode, timeout, interrupt grace, heartbeat interval, permissions editing
- Mission Control has: identity editing, provider/runtime summary, run policy summary, permissions readout, API keys empty state
- Why it matters: Mission Control lets operators see the provider truth, but not actually control most of the runtime mechanics
- Recommended fix: extend configuration with adapter/runtime controls while preserving MC’s stronger runtime/provider distinction and provider capabilities block
- Scope: L

#### A2. Major: Mission Control instructions are still a single-prompt editor

- Category: feature/functionality
- Severity: major
- Routes: `/TIM/agents/codesmith/instructions` vs `/NEV/agents/forge/instructions`
- Paperclip has: file tree, entry file, multi-file instruction bundle, advanced mode
- Mission Control has: a single “System Prompt” editor plus honest copy that multi-file bundles require the Paperclip provider
- Why it matters: the current surface is honest but substantially less capable for agents that do support file-bundle instructions
- Recommended fix: make instructions provider-aware; expose multi-file bundle management for supported providers and keep the fallback single-prompt editor for unsupported ones
- Scope: L

#### A3. Major: Mission Control agent skills are raw tags, not managed attachments

- Category: feature/functionality
- Severity: major
- Routes: `/TIM/agents/codesmith/skills` vs `/NEV/agents/forge/skills`
- Paperclip has: required skill list, view links to the company library, unmanaged-skill warnings, adapter applicability messaging
- Mission Control has: a flat editable list of skill tags
- Why it matters: operators cannot tell which skills are sourced from the company library, mounted at runtime, unmanaged, or unsupported
- Recommended fix: replace tag editing with a company-library attachment UI and explicit unsupported/unmanaged states
- Scope: L

#### A4. Major: Mission Control run detail lacks transcript and invocation depth

- Category: feature/functionality
- Severity: major
- Routes: `/TIM/agents/codesmith/runs/:id` vs `/NEV/agents/forge/runs/:id`
- Paperclip has: large run sidebar, per-run token counts, cached tokens, invocation command, prompt, wake context, session info, working directory, adapter notes
- Mission Control has: status, provider, timing, and imported milestone/comment timeline for the run
- Why it matters: MC shows the outcome, but not enough raw execution context for high-confidence operator debugging
- Recommended fix: expand the run detail schema/UI to show invocation metadata, token/cost metrics, transcript depth, and provider-native context where available
- Scope: L

### UX / Interaction Gaps

#### U1. Minor: Mission Control inbox lacks the visible archive workflow Paperclip exposes

- Category: UX/interaction
- Severity: minor
- Routes: `/TIM/inbox/mine` vs `/NEV/inbox`
- Paperclip has: visible `Archive` action on inbox rows
- Mission Control has: tabs, columns, and mark-all-read controls, but no visible archive action in the live inbox list inspected
- Why it matters: inbox cleanup is slower and less obvious
- Recommended fix: add row-level or bulk archive affordances to the inbox
- Scope: S

#### U2. Minor: Paperclip remembers project tabs; Mission Control always drops back to tasks

- Category: UX/interaction
- Severity: minor
- Routes: `/TIM/projects/:id` routing behavior vs MC `/companies/[slug]/projects/[projectSlug]/page.tsx`
- Paperclip has: last-tab memory and smart redirects
- Mission Control has: an unconditional redirect to the project tasks tab
- Why it matters: operator context is lost when returning to a project
- Recommended fix: remember the last active project tab or at least honor the most recently visited project subpage
- Scope: S

#### U3. Minor: Mission Control skills browsing is less navigable inside the detail surface

- Category: UX/interaction
- Severity: minor
- Routes: `/TIM/skills/:id` vs `/NEV/skills/:id`
- Paperclip has: file-level routes and integrated library/detail state
- Mission Control has: a working detail view, but not per-file routes or the same depth of in-context navigation
- Why it matters: skill inspection is slower for larger bundles
- Recommended fix: add per-file navigation within the skill detail surface
- Scope: M

### Data / Truth / Provenance Gaps

#### D1. Major: Mission Control project configuration cannot show the same execution context Paperclip can

- Category: data/truth/provenance
- Severity: major
- Routes: `/TIM/projects/onboarding/configuration` vs `/NEV/projects/henry-voice/configuration`
- Paperclip has: goal linkage, repo status, local folder, and project archive flow
- Mission Control has: name, description, status, repo/local folder placeholders, and archive button
- Why it matters: project execution context is partially present but not trustworthy enough for operators
- Recommended fix: either populate repo/local folder/codebase truth from real sources or remove placeholder fields until they are backed by real data
- Scope: M

#### D2. Major: Mission Control settings copy overstates import/export availability

- Category: data/truth/provenance
- Severity: major
- Routes: `/NEV/settings`
- Paperclip has: real import/export routes
- Mission Control has: copy that says import/export moved to dedicated pages, without corresponding route surfaces
- Why it matters: this violates the same honesty standard MC is otherwise improving on provider/runtime surfaces
- Recommended fix: align wording to the actual state of the product immediately
- Scope: S

#### D3. Positive: Mission Control is stronger than Paperclip on provider/runtime truth

- Category: intentional positive divergence
- Severity: n/a
- Routes: `/NEV/agents/forge/configuration`
- Paperclip has: adapter controls, but not the same explicit runtime/provider conceptual split
- Mission Control has: a clearer distinction between current runtime, current provider, observability capabilities, and static provider comparison
- Why it matters: this is a better operator mental model
- Recommendation: preserve this structure while adding the missing runtime controls

### Visual / Polish / Layout Gaps

#### V1. Minor: Mission Control tasks page currently undersells itself visually because the empty default state dominates

- Category: visual/polish
- Severity: minor
- Routes: `/NEV/tasks`
- Paperclip has: an immediately populated issue list
- Mission Control has: a valid board shell, but the empty default makes it feel broken before any interaction happens
- Why it matters: the parity gap reads as “product not working” rather than “different presentation”
- Recommended fix: fix the default task scope first; most of the visual complaint will drop with the functional fix
- Scope: S

#### V2. Minor: Mission Control settings and routines are serviceable but still flatter than Paperclip’s current component system

- Category: visual/polish
- Severity: minor
- Routes: `/NEV/settings`, `/NEV/routines`
- Paperclip has: stronger dense-form/card consistency across the modern surface
- Mission Control has: workable forms, but lower hierarchy and less polish on utility pages
- Why it matters: parity reads weaker even when core fields exist
- Recommended fix: after the functional gaps land, do a shared-surface polish pass on settings/routines/approvals
- Scope: M

## Where Mission Control Is Already Stronger

Do not erase these differences in pursuit of parity:

1. Agent configuration is more explicit about provider/runtime separation and observability capabilities.
2. Team and Org are split into two complementary views, which is better for roster browsing than a single merged page.
3. Project budget already includes a cost breakdown block that Paperclip’s project budget page does not surface.
4. Goal detail already exposes owner selection and delete affordances that Paperclip’s sampled goal detail did not show.
5. Paperclip-backed run detail in Mission Control is unusually honest about bridge-sync provenance and observability limits.

## Recommended Implementation Order

### Wave 1: unblock the operator core

1. Fix `/tasks` default scoping and make the active project filter explicit.
2. Add approvals index routes and wire the approvals workflow into navigation.
3. Clean up inbox actions so archive/read-state controls are at parity.

### Wave 2: close the agent-operability gap

4. Expand agent runs and run detail.
5. Expand agent configuration.
6. Expand agent instructions.
7. Expand agent skills.

### Wave 3: close the project and routine management gap

8. Add project workspaces and workspace detail.
9. Add routine detail/edit routes.
10. Make project configuration fields fully truthful or remove placeholders.

### Wave 4: finish platform settings and portability

11. Add instance/global settings or explicitly scope them out as a product decision.
12. Ship dedicated import/export pages or remove the current dead-end messaging.
13. Do a final polish pass on utility pages after the functional parity work lands.

## Audit Notes

- Mission Control `/NEV/agents` currently redirects to `/NEV/team`; that was treated as the canonical roster equivalent to Paperclip `/agents/all`.
- Mission Control `/issues` routes exist, but this audit used `/tasks` as the canonical Paperclip `/issues` equivalent per task instruction.
- Paperclip `workspaces` are conditional in the live project sample, but the route contract and component support clearly exist in code. Mission Control has no equivalent route contract.
