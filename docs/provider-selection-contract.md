# Provider Selection Contract

> Design doc governing how Mission Control handles runtime/provider
> selection for agents. Written 2026-04-05, grounded in existing
> codebase architecture. Intended to govern the next several
> implementation passes.

## Status

**Current**: Read-only provider visibility on the Configuration tab.
No editable selection. No runtime switching.

**Next**: This document defines what editability should mean, what
state model changes are required, and what the rollout sequence should
be.

---

## 1. What Is Being Selected?

Provider selection is **not** a single atomic choice. It is a composite
of four distinct concerns that should remain visually and architecturally
separate:

### 1a. Execution Provider

The system-level backend that runs agent sessions.

| Provider     | Status    | Integration Path              |
|-------------|-----------|-------------------------------|
| `openclaw`  | Available | Gateway WebSocket, CLI sessions |
| `paperclip` | Available | Bridge sync, REST API wake     |

This is stored as `agents.adapter_type` (default `'openclaw'`).
It is also derivable from the env-level
`ORCHESTRATION_EXECUTION_PROVIDER`, but per-agent override takes
precedence.

**Selection scope**: Per-agent. An agent's execution provider is a
durable property of that agent, not a per-run or per-task decision.

### 1b. Model

The LLM model family/version used for agent reasoning.

Currently stored in `agents.model` and/or
`agents.adapter_config_json.model`. Also settable through Paperclip's
execution settings API.

**Selection scope**: Per-agent, editable independently of provider.
Model choice is semi-portable across providers (same model string may
work on multiple providers), but not all providers support all models.

### 1c. Provider-Specific Configuration

Timeout, grace period, heartbeat interval, session params, etc.
Stored in `agents.adapter_config_json` and `agents.runtime_config_json`.

**Selection scope**: Per-agent. These configs are provider-specific and
do NOT port across providers. Switching providers should reset or
validate provider-specific config.

### 1d. Observability Depth

The tier of live event data available from this provider (T0-T5).
This is a **consequence** of provider choice, not an independent
selection. It is derived from the adapter's `maxTier`.

**Selection scope**: Not directly selectable. Read-only consequence.

---

## 2. Product Model: What the Operator Decides

The operator should be able to answer and act on:

| Question | Editable? | Scope |
|----------|-----------|-------|
| What provider runs this agent? | Yes (Phase 2) | Per-agent |
| What model does this agent use? | Yes (today) | Per-agent |
| What are this provider's timeout/grace limits? | Yes (via execution settings) | Per-agent |
| What observability depth does this provider give me? | No (read-only consequence) | Per-provider |
| What other providers could I use? | Visible (read-only comparison) | Per-company |

### What "switching" means to the operator

Switching provider means:
1. The agent's next run will be routed through a different execution
   backend.
2. Provider-specific config (timeouts, session state) will be reset
   or re-validated.
3. Observability depth may change (honestly communicated before
   switching).
4. Existing run history stays as-is (runs show the provider that
   executed them).
5. In-flight runs are NOT affected (switch applies to next run).

### What "switching" does NOT mean

- It does not change the agent's identity, name, skills, or
  personality.
- It does not migrate session state between providers.
- It does not change past run data or transcript provenance.
- It does not imply the new provider has the same capabilities.

---

## 3. State Model: Typed Contract

### Current schema (what exists today)

```sql
-- agents table (migration v31)
adapter_type         TEXT DEFAULT 'openclaw'
adapter_config_json  TEXT DEFAULT '{}'
runtime_config_json  TEXT DEFAULT '{}'
openclaw_agent_id    TEXT UNIQUE
paperclip_agent_id   TEXT UNIQUE
```

### Proposed state model

```typescript
/**
 * Agent's configured provider identity.
 * This is the durable, operator-chosen provider for this agent.
 * Not to be confused with run-level provider (which records what
 * actually executed a given run).
 */
interface AgentProviderConfig {
  /** Which execution backend runs this agent */
  executionProvider: "openclaw" | "paperclip";

  /**
   * Provider-specific configuration bundle.
   * Shape depends on executionProvider. NOT portable across providers.
   */
  providerConfig: OpenClawProviderConfig | PaperclipProviderConfig;

  /**
   * Model selection. Semi-portable across providers.
   * Validated against provider's supported model list on save.
   */
  model: string;

  /**
   * When the provider was last changed.
   * null if never changed (original assignment).
   */
  providerChangedAt: string | null;
}

interface OpenClawProviderConfig {
  agentId: string;           // openclaw_agent_id
  workspace?: string;
  agentDir?: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  timeoutSec: number;
  graceSec: number;
}

interface PaperclipProviderConfig {
  agentId: string;           // paperclip_agent_id
  boardId?: string;
  timeoutSec: number;
  graceSec: number;
}
```

### Relationship map

```
Agent
  |
  +-- executionProvider     (which backend)
  |     |
  |     +-- adapter_type in DB
  |     +-- determines: observability tier (read-only)
  |     +-- determines: supported models (validation)
  |     +-- determines: available config fields
  |
  +-- model                (which LLM)
  |     |
  |     +-- stored in agents.model or adapter_config_json
  |     +-- semi-portable across providers
  |     +-- validated against provider's model list
  |
  +-- providerConfig       (provider-specific settings)
  |     |
  |     +-- stored in adapter_config_json + runtime_config_json
  |     +-- NOT portable across providers
  |     +-- reset on provider switch
  |
  +-- observabilityTier    (read-only consequence)
        |
        +-- derived from adapter's maxTier
        +-- displayed but not editable
        +-- determines capability matrix
```

---

## 4. Current Gaps

These must be resolved before provider selection is editable:

### Gap 1: No generic agent PATCH endpoint

The existing API has no way to update `adapter_type`,
`adapter_config_json`, or `runtime_config_json` directly. The only
mutation path is through Paperclip's execution settings API, which
only covers model, timeout, and grace.

**Required**: A `PATCH /api/orchestration/agents/{id}/provider` endpoint
that:
- Validates the requested provider is available
- Validates model compatibility
- Resets provider-specific config if provider changed
- Records `providerChangedAt` timestamp
- Returns the new provider presentation info

### Gap 2: No provider availability validation

The `PROVIDER_PRODUCT_DESCRIPTORS` list is static. There is no runtime
check for whether a provider is actually available for a given
agent/company/environment. For example:
- Paperclip requires `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY`
- OpenClaw requires a valid `openclaw_agent_id` and gateway connection
- Not all agents have both `openclaw_agent_id` and `paperclip_agent_id`

**Required**: A `canActivateProvider(agentId, providerId)` function that
checks:
- Environment variables present
- Agent has the required external ID (or can create one)
- Provider adapter is registered and connected
- Company has access to this provider

### Gap 3: No model-provider compatibility matrix

Model selection is currently a freeform string. There is no validation
that a chosen model is supported by the configured provider.

**Required**: A per-provider `supportedModels` list or validation
function.

### Gap 4: No provider switch lifecycle

Switching providers mid-lifecycle has no defined behavior:
- What happens to in-flight heartbeat runs?
- What happens to session state in `agent_task_sessions`?
- What happens to cumulative state in `agent_runtime_state`?
- How does the bridge handle an agent that was Paperclip but is now
  OpenClaw?

**Required**: A provider switch protocol that:
1. Blocks switch if agent has in-flight runs
2. Archives (not deletes) existing session state
3. Creates fresh session state for new provider
4. Updates `adapter_type` atomically
5. Logs the switch as an audit event

### Gap 5: Dual external ID management

Currently agents can have both `openclaw_agent_id` and
`paperclip_agent_id`. The system uses these to infer the current
provider. But when both exist:
- Which one is "active"?
- `adapter_type` should be the source of truth, not ID inference

**Required**: Make `adapter_type` the canonical source of truth for
provider identity. External IDs become "this agent HAS a link to X"
rather than "this agent IS an X agent."

---

## 5. Rollout Sequence

### Phase 0: Read-only visibility (DONE)

- [x] Configuration tab shows current provider identity
- [x] Capability matrix derived from tier
- [x] Provider comparison list (read-only, static)
- [x] Shared presentation components
- [x] Honest "read-only" labeling

### Phase 1: Provider-aware state model

Make `adapter_type` authoritative and add validation infrastructure.
No UI editability yet.

- [ ] Add `PATCH /api/orchestration/agents/{id}/provider` endpoint
      (initially admin-only or dev-only)
- [ ] Implement `canActivateProvider()` validation
- [ ] Add `provider_changed_at` column to agents table
- [ ] Make provider comparison show "Available for this agent" vs
      "Not available" based on real environment/agent state
- [ ] Replace static `defaultAvailability` with runtime checks
      where adapters are registered

### Phase 2: Editable provider selection

Ship the actual selection UI, gated behind validation.

- [ ] Configuration tab: provider comparison becomes selectable
      (only for providers that pass `canActivateProvider()`)
- [ ] Confirmation dialog explaining:
      - What will change (execution backend, observability depth)
      - What will be reset (provider-specific config)
      - What will NOT change (agent identity, history)
- [ ] Provider switch lifecycle (block in-flight, archive state)
- [ ] Switch recorded as audit event
- [ ] Model selection validated against new provider's supported list

### Phase 3: Provider-specific configuration

Once provider selection works, expose provider-specific config
editing.

- [ ] OpenClaw: heartbeat interval, timeout, grace, workspace
- [ ] Paperclip: timeout, grace, board assignment
- [ ] Config fields dynamically shown based on selected provider
- [ ] Validation that config is complete before enabling execution

### Phase 4: Dynamic provider discovery

Replace static `PROVIDER_PRODUCT_DESCRIPTORS` with runtime discovery.

- [ ] Query adapter registry for registered providers
- [ ] Merge with product-level descriptors for planned providers
- [ ] Show connection health in provider comparison
- [ ] Support adding new providers without code changes

---

## 6. Edge Cases and Failure Modes

### Agent has no external ID for target provider

If an operator wants to switch an OpenClaw agent to Paperclip but the
agent has no `paperclip_agent_id`:
- Block the switch until a Paperclip agent link is established
- UI should explain: "This agent is not linked to a Paperclip agent"
- Future: auto-create Paperclip agent on demand (Phase 3+)

### Provider environment not configured

If Paperclip env vars are missing:
- Provider shows as "Unavailable" (not "Available")
- Switch is blocked with explanation
- No fake "planned" status for providers that are just misconfigured

### In-flight runs during provider switch

- Block provider switch if any heartbeat_runs have status
  `'queued'` or `'running'` for this agent
- UI should explain: "Cannot switch provider while runs are in flight"

### Model not supported by target provider

- Validate model against target provider's supported list
- If current model is unsupported, require model change as part of
  the switch flow
- Never silently switch to a model the operator didn't choose

### Session state incompatibility

- Session state (`agent_task_sessions`, `agent_runtime_state`) is
  provider-specific
- On switch: archive existing state, create fresh state for new
  provider
- Old state preserved for rollback but not migrated

---

## 7. Anti-Theater Rules

These rules govern what the UI and backend may and may not claim:

### UI rules

1. **No selection without save path.** Do not render a dropdown,
   radio button, or selectable card unless clicking it triggers a
   real PATCH that persists the choice.

2. **No "switching" verb without lifecycle.** Do not say "Switch
   to Paperclip" unless the backend has a provider switch endpoint
   that handles in-flight blocking, state archival, and validation.

3. **"Read-only" when read-only.** If a provider list is not
   editable, say so. Current label: "Provider comparison (read-only)"
   with note "Selection is not yet editable from this surface."

4. **Consequences before confirmation.** Before any provider switch,
   show what will change (observability depth, config reset) and what
   will not (identity, history).

5. **No "Available" for broken providers.** If env vars are missing
   or adapter is not connected, show "Unavailable" or "Not configured",
   not "Available."

### Backend rules

6. **`adapter_type` is the source of truth.** Do not infer provider
   from `openclaw_agent_id` / `paperclip_agent_id` existence. Those
   are link IDs, not provider selectors.

7. **Validation before mutation.** Every provider switch must pass
   `canActivateProvider()` before `adapter_type` is updated.

8. **No silent model changes.** Provider switch must not change the
   agent's model without operator confirmation.

9. **No session state migration.** Session state is provider-specific.
   Archive, don't migrate.

10. **Audit trail.** Every provider switch must be recorded with
    timestamp, old provider, new provider, and operator identity.

### Architecture rules

11. **Capability differences are features, not bugs.** Do not create
    a lowest-common-denominator abstraction that hides meaningful
    provider differences. Paperclip at Tier 1 is honest; pretending
    it has Tier 3 features is not.

12. **Static descriptors are labeled as such.** Product-level
    descriptors (`PROVIDER_PRODUCT_DESCRIPTORS`) are not runtime
    discovery. Do not rename them to sound dynamic until they are.

13. **Planned providers are clearly planned.** Hermes and BYO Webhook
    are on the roadmap. They are not partially available. Show them as
    "Planned" with no selection affordance.

---

## 8. What Remains Read-Only Even After Editability

Some things should never be editable through the provider selection
flow:

| Property | Reason |
|----------|--------|
| Observability tier | Consequence of provider, not a choice |
| Capability matrix | Derived from tier, not configurable |
| Past run provider | Historical truth, immutable |
| Provider's integration path | Architectural property of the provider |
| Run transcript provenance | Immutable record of what happened |
| Agent identity (name, role, personality) | Not provider-related |

---

## 9. Portable vs Provider-Specific Configuration

### Portable (survives provider switch)

- Agent identity: name, emoji, role, personality, skills
- Model selection (validated against new provider)
- Task history and run records
- Company/project assignment
- Reporting hierarchy

### Provider-specific (reset on provider switch)

- Session state (`agent_task_sessions`)
- Runtime state (`agent_runtime_state`)
- Heartbeat configuration (OpenClaw-specific)
- Board/issue linkage (Paperclip-specific)
- Workspace/agent directory (OpenClaw-specific)
- Provider-specific timeout/grace config (values may differ)

---

## 10. How Paperclip-Backed Agents Differ

Paperclip is a first-class provider, not a degraded fallback.
But it has real architectural differences:

| Aspect | OpenClaw | Paperclip |
|--------|----------|-----------|
| Session management | MC-owned via CLI | Paperclip-owned |
| Event streaming | WebSocket gateway (live) | Poll-based bridge sync |
| Observability tier | T3 (Action Detection) | T1 (Milestones) |
| Execution trigger | Direct CLI invocation | REST API wake |
| Comment source | Engine events + agent text | Paperclip issue comments |
| State persistence | MC DB (sessions, runtime) | Paperclip-side |
| Transcript depth | Partial (action-level) | Minimal (comments only) |
| Config source | MC DB + env | Paperclip API |

These differences are permanent architectural properties, not bugs
to fix. The UI should make them visible, not hide them.

---

## Appendix A: File Reference

| Concern | File |
|---------|------|
| Agent DB schema | `src/lib/orchestration/db.ts` (migration v31) |
| Agent service | `src/lib/orchestration/service/agent.ts` |
| Execution settings | `src/lib/orchestration/service/execution-settings.ts` |
| Execution routing | `src/lib/orchestration/engine/engine.ts` |
| Provider enum | `src/lib/orchestration/execution-provider.ts` |
| Adapter types | `src/lib/orchestration/adapters/types.ts` |
| Adapter registry | `src/lib/orchestration/adapters/registry.ts` |
| OpenClaw adapter | `src/lib/orchestration/adapters/openclaw-heartbeat.ts` |
| Paperclip adapter | `src/lib/orchestration/adapters/paperclip.ts` |
| Bridge sync | `src/lib/orchestration/bridge/sync.ts` |
| Bridge client | `src/lib/orchestration/bridge/client.ts` |
| Config page | `src/app/(dashboard)/.../configuration/page.tsx` |
| Run detail page | `src/app/(dashboard)/.../runs/[runId]/page.tsx` |
| Run events API | `src/app/api/.../runs/[runId]/events/route.ts` |
| Shared components | `src/components/orchestration/ProviderPresentation.tsx` |

## Appendix B: Glossary

| Term | Meaning |
|------|---------|
| Execution provider | Backend that runs agent sessions (openclaw, paperclip) |
| Adapter | MC-side integration module translating provider events to canonical format |
| Observability tier | Level of live event depth available (T0-T5) |
| Provider config | Provider-specific settings (timeouts, heartbeat, workspace) |
| Product descriptor | Static metadata about a provider (name, tier, status note) |
| Bridge sync | Poll-based data flow between MC and Paperclip |
| Provider switch | Changing an agent's execution provider |
| Capability matrix | 6-dimension grid of what a provider can show |
