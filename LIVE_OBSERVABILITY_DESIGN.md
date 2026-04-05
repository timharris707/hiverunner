# Mission Control: Provider-Agnostic Live Observability Design

> Architecture pass — 2026-04-05
> Branch: `feat/mission-control-live-parity`
> Commit: `26eedcb6`

---

## 1. Repo / Branch Verification

| Field | Value |
|-------|-------|
| Remote | `harris-autonomous/mission-control` |
| Branch | `feat/mission-control-live-parity` |
| Latest commit | `26eedcb6` — `feat: live mc-action detection` |
| Branch status | Up to date with `origin/feat/mission-control-live-parity` |
| Uncommitted | Working tree has modified files (routines WIP, RealtimeProvider, contracts, middleware) — no conflicts |

---

## 2. Current State Summary

### What MC has today on canonical surfaces

| Capability | Transport | Latency |
|------------|-----------|---------|
| Live assistant text streaming | Gateway WS → SSE | ~150ms |
| Lifecycle start/end/error events | Gateway WS → SSE | ~150ms |
| mc-action detection (create_task, hire, report, update, comment) | Client-side regex on streamed text | ~150ms + parse |
| Dashboard card glow/pulse | CSS driven by stream state | Immediate |
| Multi-entry scrollable transcript | Merged poll + stream entries | ~150ms stream, ~3s poll |
| "EXECUTED N ACTIONS" badge | Client-side count of detected mc-actions | Immediate |
| Snapshot polling (stats, agent status, highlights) | HTTP poll → React context | ~5s |
| Activity/comment polling | SSE poll endpoint | ~3s |
| Toast notifications | Driven by snapshot diff | ~5s |
| Sidebar live indicators | Driven by stream + snapshot | ~5s |
| Recency persistence after completion | localStorage cache | Survives reload |

### Current event kinds flowing through the system

```
assistant_delta | assistant_final | tool_start | tool_end
lifecycle_start | lifecycle_end   | lifecycle_error | error
action_detected (client-side only, from mc-action regex)
```

---

## 3. Current Limitation Summary

### A. Gateway privilege boundary

The OpenClaw gateway's `clearUnboundScopes` strips scopes from non-device-paired backend connections. MC connects as `role=operator` with `operator.read`, but `sessions.subscribe` (required for `session.tool` push events) is scoped out. This means:

- **Available**: `chat` channel events (assistant text), `sessions.changed` (lifecycle)
- **Not available**: `session.tool` events (structured tool_use / tool_result)

### B. Heartbeat agent text-encoded actions

Heartbeat agents do not emit structured `tool_use` / `tool_result` Claude API objects. Instead they emit `mc-action` JSON blocks inside assistant text:

```
\`\`\`mc-action
{"action":"create_task","title":"Build dashboard","priority":"P1"}
\`\`\`
```

This is parsed client-side via regex. It works but:
- No tool invocation timing (start/end)
- No tool input/output payloads
- No error/retry visibility
- No thinking/reasoning blocks
- Fragile if format changes

### C. Paperclip parity gaps

Paperclip exposes per-agent:
- Structured tool call history (invocation + result)
- Thinking/reasoning summaries
- Comment trail with author attribution
- Run timeline with duration and token usage
- Interactive run steering (pause, resume, cancel)

MC currently lacks:
- Structured tool call/result rendering
- Reasoning/thinking block visibility
- Interactive run control
- Per-tool timing and input/output inspection

### D. Provider lock-in risk

Current architecture is hardwired to:
- OpenClaw gateway WebSocket protocol (JSON-RPC, specific message shapes)
- Heartbeat session key pattern (`agent:{id}:heartbeat:{taskKey}`)
- `mc-action` text block format
- OpenClaw-specific event correlation (openclaw_agent_id → session mapping)

No abstraction layer exists between provider-specific event sources and the canonical rendering pipeline.

---

## 4. Canonical Mission Control Live Event Schema

This is the provider-agnostic event model that all provider adapters must produce and that the MC rendering layer consumes.

### Core schema

```typescript
interface MCLiveEvent {
  /** Globally unique event ID (UUID or provider-assigned) */
  id: string;

  /** MC agent UUID (resolved by adapter) */
  agentId: string;

  /** MC run/execution UUID (resolved by adapter) */
  runId: string;

  /** MC company UUID */
  companyId: string;

  /** Canonical event kind */
  kind: MCLiveEventKind;

  /** Human-readable summary (for transcript rendering) */
  summary: string;

  /** Event timestamp (ms since epoch) */
  ts: number;

  /** Monotonic sequence for ordering/dedup (optional) */
  seq?: number;

  /** Provider identifier (e.g. "openclaw", "paperclip", "hermes") */
  provider: string;

  /** Kind-specific payload */
  payload: MCLiveEventPayload;

  /** Provider-specific extension data (opaque to core renderer) */
  providerMeta?: Record<string, unknown>;
}
```

### Event kinds

```typescript
type MCLiveEventKind =
  // Lifecycle
  | "run_start"
  | "run_end"
  | "run_error"

  // Assistant output
  | "assistant_text_delta"
  | "assistant_text_final"

  // Reasoning (when available)
  | "thinking_delta"
  | "thinking_summary"

  // Tool execution
  | "tool_call_start"
  | "tool_call_end"
  | "tool_result"

  // Agent-level actions (detected or structured)
  | "action_detected"

  // Collaboration artifacts
  | "comment_written"
  | "task_updated"
  | "report_written"

  // System
  | "error"
  | "heartbeat";
```

### Kind-specific payloads

```typescript
// ── Assistant text ──
interface AssistantTextDeltaPayload {
  delta: string;
  accumulatedText: string;
}

interface AssistantTextFinalPayload {
  text: string;
  tokenCount?: number;
}

// ── Thinking / Reasoning ──
interface ThinkingDeltaPayload {
  delta: string;
}

interface ThinkingSummaryPayload {
  summary: string;
}

// ── Tool calls ──
interface ToolCallStartPayload {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;  // may be redacted by provider
}

interface ToolCallEndPayload {
  toolCallId: string;
  toolName: string;
  durationMs?: number;
  success: boolean;
}

interface ToolResultPayload {
  toolCallId: string;
  toolName: string;
  output?: unknown;  // may be truncated or redacted
  isError: boolean;
  errorMessage?: string;
}

// ── Agent actions (from text detection or structured events) ──
interface ActionDetectedPayload {
  actionType: string;       // "create_task" | "hire_agent" | "report" | etc.
  actionDetail: Record<string, unknown>;
  source: "structured" | "text_detected";
}

// ── Collaboration ──
interface CommentWrittenPayload {
  taskKey?: string;
  body: string;
  commentType?: string;
}

interface TaskUpdatedPayload {
  taskKey: string;
  field: string;
  oldValue?: string;
  newValue: string;
}

interface ReportWrittenPayload {
  reportType?: string;
  summary: string;
}

// ── Lifecycle ──
interface RunStartPayload {
  invocationSource?: string;  // "timer" | "assignment" | "manual" | etc.
}

interface RunEndPayload {
  durationMs?: number;
  tokenUsage?: { input: number; output: number };
  result?: "success" | "partial" | "error";
}

interface RunErrorPayload {
  errorCode?: string;
  errorMessage: string;
  recoverable: boolean;
}

// ── System ──
interface ErrorPayload {
  errorCode?: string;
  errorMessage: string;
}

interface HeartbeatPayload {
  connectedSince: number;
}

// ── Union type ──
type MCLiveEventPayload =
  | AssistantTextDeltaPayload
  | AssistantTextFinalPayload
  | ThinkingDeltaPayload
  | ThinkingSummaryPayload
  | ToolCallStartPayload
  | ToolCallEndPayload
  | ToolResultPayload
  | ActionDetectedPayload
  | CommentWrittenPayload
  | TaskUpdatedPayload
  | ReportWrittenPayload
  | RunStartPayload
  | RunEndPayload
  | RunErrorPayload
  | ErrorPayload
  | HeartbeatPayload;
```

### Design rationale

- **`providerMeta`**: Escape hatch for provider-specific data (e.g. OpenClaw session keys, Paperclip issue IDs). Core renderer ignores this but provider-specific UI extensions can use it.
- **`source` in ActionDetectedPayload**: Distinguishes structured actions (from providers that emit them natively) from text-detected actions (the mc-action regex fallback). Renderer can display confidence indicators.
- **Thinking events are optional**: Many providers won't expose reasoning. The renderer must gracefully omit the thinking section when absent.
- **Tool payloads may be partial**: `input` and `output` are optional because some providers redact tool data, and text-detected actions have no tool I/O.

---

## 5. Provider Adapter Model

### Interface

```typescript
interface MCProviderAdapter {
  /** Unique provider identifier */
  readonly providerId: string;

  /** Human-readable name */
  readonly displayName: string;

  /** Maximum observability tier this provider can support */
  readonly maxTier: ObservabilityTier;

  /**
   * Connect to the provider's event source and begin emitting
   * canonical MCLiveEvent objects through the callback.
   *
   * Returns a disconnect function.
   */
  connect(
    config: ProviderConnectionConfig,
    onEvent: (event: MCLiveEvent) => void,
    onError: (error: ProviderError) => void,
  ): Promise<DisconnectFn>;

  /**
   * Resolve a provider-specific session/run identifier
   * to an MC agent + run mapping.
   */
  resolveMapping(
    providerRef: string,
    context: MappingContext,
  ): Promise<{ agentId: string; runId: string; companyId: string } | null>;

  /**
   * Return current connection health.
   */
  getStatus(): ProviderStatus;
}

type DisconnectFn = () => void;

interface ProviderConnectionConfig {
  companyId: string;
  credentials: Record<string, string>;
  options?: Record<string, unknown>;
}

interface ProviderStatus {
  connected: boolean;
  lastEventTs: number | null;
  activeSessionCount: number;
  tier: ObservabilityTier;
}
```

### Provider-specific adapters

#### A. OpenClaw Heartbeat Adapter (current primary)

**What it maps from**: Gateway WS events (chat, sessions.changed, session.tool)

| Source event | Maps to | Available today? |
|-------------|---------|-----------------|
| `chat` delta | `assistant_text_delta` | Yes |
| `chat` final | `assistant_text_final` | Yes |
| `sessions.changed` start | `run_start` | Yes |
| `sessions.changed` end | `run_end` | Yes |
| `sessions.changed` error | `run_error` | Yes |
| `session.tool` start | `tool_call_start` | No (scope blocked) |
| `session.tool` end | `tool_call_end` / `tool_result` | No (scope blocked) |
| mc-action text blocks | `action_detected` (source: `text_detected`) | Yes (regex fallback) |

**Max tier**: Tier 3 today (Tier 4 if scope restored)

**Key constraint**: Heartbeat session key pattern must match for event correlation. DB fallback for unknown sessions.

#### B. OpenClaw Direct/Session Adapter (future)

For non-heartbeat OpenClaw sessions (e.g. direct API calls, interactive sessions).

**Difference from heartbeat**: Session key pattern differs. May have full scope access if device-paired. Could support structured tool events natively.

**Max tier**: Tier 4-5 (if device-paired and scoped correctly)

#### C. Paperclip Adapter

**What it maps from**: Paperclip API polling (issue events, agent activity, comments)

| Source | Maps to |
|--------|---------|
| Issue status change | `task_updated` |
| Agent comment | `comment_written` |
| Agent run start (wake result) | `run_start` |
| Agent run complete | `run_end` |
| Agent run error | `run_error` |

**No streaming**: Paperclip integration is poll-based (HTTP API). No live text streaming, no tool events, no thinking blocks.

**Max tier**: Tier 1 (engine-side milestones via poll)

**Enhancement path**: If Paperclip exposes a webhook or SSE endpoint for agent activity, tier could rise to 2-3.

#### D. Hermes Adapter (future)

**Assumptions** (no current integration):
- Hermes likely provides its own event/streaming model
- May expose structured tool calls natively
- May have different auth/scope model
- Adapter would map Hermes-native events to MCLiveEvent

**Max tier**: Unknown — depends on Hermes event richness

#### E. Generic Webhook Adapter (BYO agent)

For external/bring-your-own agents that push events via webhook.

**Model**: MC exposes a webhook endpoint. External agents POST canonical or near-canonical events. Adapter normalizes and emits.

```
POST /api/orchestration/providers/{providerId}/webhook
Body: { kind, agentRef, runRef, payload, ... }
```

**Max tier**: Tier 0-3 depending on what the external agent sends. At minimum, post-run artifacts (Tier 0). With structured webhooks, up to Tier 3.

---

## 6. Transport and Privilege Model

### Transport options by layer

```
Provider → MC Server:
  - WebSocket (OpenClaw gateway — current)
  - HTTP polling (Paperclip bridge — current)
  - Webhook push (BYO agents — future)
  - Server-Sent Events (provider → MC server — future)

MC Server → Browser:
  - SSE (live-stream endpoint — current, primary)
  - WebSocket (snapshot broadcast — current, secondary)
  - HTTP polling (snapshot endpoint — current, fallback)
```

### Recommended transport architecture

```
┌─────────────────────────────────────────────────────┐
│                    MC Server                         │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Provider Adapter Registry           │   │
│  │  ┌─────────┐ ┌───────────┐ ┌──────────────┐ │   │
│  │  │OpenClaw │ │ Paperclip │ │ Webhook/BYO  │ │   │
│  │  │Adapter  │ │ Adapter   │ │ Adapter      │ │   │
│  │  └────┬────┘ └─────┬─────┘ └──────┬───────┘ │   │
│  │       │             │              │          │   │
│  │       ▼             ▼              ▼          │   │
│  │  ┌──────────────────────────────────────┐    │   │
│  │  │     Canonical Event Bus              │    │   │
│  │  │     (MCLiveEvent stream)             │    │   │
│  │  └───────────────┬──────────────────────┘    │   │
│  └──────────────────┼───────────────────────────┘   │
│                     │                                │
│        ┌────────────┼────────────┐                   │
│        ▼            ▼            ▼                   │
│   ┌────────┐  ┌──────────┐  ┌────────┐             │
│   │SSE out │  │WS bcast  │  │DB write│             │
│   │(live)  │  │(snapshot) │  │(audit) │             │
│   └───┬────┘  └────┬─────┘  └────────┘             │
└───────┼─────────────┼────────────────────────────────┘
        │             │
        ▼             ▼
    ┌──────────────────────┐
    │      Browser          │
    │  useLiveRunStream()   │
    │  RealtimeProvider     │
    └──────────────────────┘
```

### Privilege model

| Concern | Approach |
|---------|----------|
| **Company isolation** | Every MCLiveEvent carries `companyId`. SSE endpoint filters by company. No cross-tenant leakage. |
| **Provider credentials** | Stored per-company in DB or env vars. Never sent to browser. Adapter handles auth server-side. |
| **Scope minimization** | Each adapter requests minimum scopes. OpenClaw: `operator.read`. Paperclip: read-only API key. Webhook: HMAC signature verification. |
| **No scope overgranting** | Adapters declare their required scopes. Registry validates before connecting. |
| **Tenant-scoped streams** | SSE connections are per-company. Adapter registry maintains per-company adapter instances. |
| **Webhook security** | Inbound webhooks verified via HMAC signature + timestamp. Replay protection via nonce/idempotency key. |

---

## 7. Observability Tier Model

```
Tier 0 ─── Post-run artifacts only
          (run record, final comments, status change)
          Source: DB polling after run completes
          Providers: Any (minimum viable)

Tier 1 ─── Engine-side in-flight milestones
          (run_start, run_end, run_error, task_updated)
          Source: Execution engine events, poll-based
          Providers: OpenClaw, Paperclip, any with run lifecycle API

Tier 2 ─── Live assistant text
          (assistant_text_delta, assistant_text_final)
          Source: Provider streaming (WS/SSE)
          Providers: OpenClaw (today), any with text streaming

Tier 3 ─── Action detection from live text
          (action_detected with source=text_detected)
          Source: Client-side or server-side regex/parser on streamed text
          Providers: OpenClaw heartbeat (today), any with parseable output

Tier 4 ─── Structured tool/result events
          (tool_call_start, tool_call_end, tool_result)
          Source: Provider-native structured events
          Providers: OpenClaw with session.tool scope (blocked today),
                     Hermes (likely), advanced BYO agents

Tier 5 ─── Full interactive streaming parity
          (Tier 4 + thinking blocks + run steering + pause/resume/cancel)
          Source: Full provider API integration
          Providers: OpenClaw device-paired sessions (future),
                     Hermes (possible), Paperclip (if they add it)
```

### Provider tier matrix

| Provider | Today | With fixes | Theoretical max |
|----------|-------|------------|-----------------|
| OpenClaw heartbeat | Tier 3 | Tier 4 (scope fix) | Tier 5 (device-pair + steering) |
| OpenClaw direct | — | Tier 4 | Tier 5 |
| Paperclip (poll) | Tier 1 | Tier 1 | Tier 2-3 (if they add streaming) |
| Hermes | — | — | Tier 4-5 (assumption) |
| BYO webhook | Tier 0 | Tier 1-3 | Tier 3 (structured webhooks) |

### Graceful degradation principle

The dashboard renders whatever tier is available:
- **Tier 0-1**: Static run card, status badge, post-run transcript
- **Tier 2**: Live streaming text block appears, cyan glow activates
- **Tier 3**: Action badges appear, detected actions populate transcript
- **Tier 4**: Tool call timeline renders, input/output inspection available
- **Tier 5**: Thinking panel, run control buttons (pause/resume/cancel)

Components conditionally render based on event availability, never on provider identity.

---

## 8. What Paperclip Appears to Have That MC Still Lacks

### Provider/runtime event source gaps

| Paperclip capability | MC status | Gap type |
|---------------------|-----------|----------|
| Structured tool call history | Missing — only text-detected actions | Provider event gap (scope blocked) |
| Tool input/output inspection | Missing entirely | Provider event gap |
| Thinking/reasoning summaries | Missing entirely | Provider event gap |
| Per-tool timing | Missing — no start/end pairs | Provider event gap |

### Transport gaps

| Paperclip capability | MC status | Gap type |
|---------------------|-----------|----------|
| Native event streaming from agent runtime | Partial — text only, no tools | Transport limitation |
| Multi-provider event aggregation | Missing — OpenClaw only for live | Architecture gap |

### Privilege/security gaps

| Paperclip capability | MC status | Gap type |
|---------------------|-----------|----------|
| Full session.tool scope access | Blocked by clearUnboundScopes | Gateway privilege gap |
| Device-paired session access | Not available for server-side connections | Architecture limitation |

### UI/rendering gaps

| Paperclip capability | MC status | Gap type |
|---------------------|-----------|----------|
| Tool call timeline component | Not built | UI gap |
| Thinking/reasoning panel | Not built | UI gap |
| Run steering (pause/resume/cancel) | Not built | UI + API gap |
| Tool input/output expandable detail | Not built | UI gap |
| Token usage per-turn breakdown | Not rendered (data partially available) | UI gap |

---

## 9. Recommended Next Implementation Milestone

### Milestone: Canonical Live Event Schema + Adapter Interface

**What**: Implement the `MCLiveEvent` type system and `MCProviderAdapter` interface, then refactor the existing gateway stream bridge to be the first adapter.

**Why this is highest-leverage**:

1. **Unlocks everything else**. Every subsequent feature (Hermes adapter, webhook adapter, structured tool rendering, thinking panel) depends on having a canonical event type that the renderer consumes. Without it, each new feature deepens the OpenClaw coupling.

2. **Minimal risk**. This is a refactor of existing working code, not new functionality. The gateway bridge already produces `RunStreamEvent` — the change wraps it in an adapter that outputs `MCLiveEvent` instead. The SSE endpoint and `useLiveRunStream` hook switch to consuming `MCLiveEvent`. Existing behavior is preserved.

3. **Immediately testable**. After the refactor, the dashboard should render identically. Any regression is a bug in the adapter mapping, not in new logic.

4. **Small scope**. Estimated files touched:
   - `src/lib/orchestration/live-events.ts` (new — canonical types)
   - `src/lib/orchestration/adapters/types.ts` (new — adapter interface)
   - `src/lib/orchestration/adapters/openclaw-heartbeat.ts` (new — wraps gateway-stream-bridge)
   - `src/lib/orchestration/adapters/registry.ts` (new — adapter registry)
   - `src/lib/orchestration/gateway-stream-bridge.ts` (refactor — becomes internal to OpenClaw adapter)
   - `src/app/api/orchestration/engine/live-stream/route.ts` (refactor — subscribe to registry not bridge)
   - `src/hooks/useLiveRunStream.ts` (refactor — consume MCLiveEvent)

**What NOT to do in this milestone**:
- Do not build Hermes/webhook adapters yet (no demand)
- Do not build tool timeline UI (no data source yet)
- Do not attempt to fix the gateway scope limitation (that's an OpenClaw-side change)
- Do not refactor the Paperclip bridge into an adapter yet (separate milestone)

---

## 10. Files Reviewed / Evidence Sources

| File | Purpose |
|------|---------|
| `src/lib/orchestration/gateway-stream-bridge.ts` | WebSocket bridge, RunStreamEvent type, session correlation |
| `src/hooks/useLiveRunStream.ts` | SSE client, StreamEvent/AgentStreamState types, mc-action detection |
| `src/components/live/RealtimeProvider.tsx` | Snapshot polling, connection status |
| `src/lib/orchestration/types.ts` | Core orchestration types (Task, Agent, Company) |
| `src/lib/orchestration/execution-provider.ts` | Provider enum, selection logic |
| `src/lib/orchestration/bridge/types.ts` | Paperclip bridge types |
| `src/lib/orchestration/bridge/client.ts` | Paperclip HTTP client |
| `src/lib/orchestration/bridge/sync.ts` | Bidirectional task sync |
| `src/app/api/orchestration/engine/live-stream/route.ts` | SSE endpoint |
| `src/app/api/orchestration/events/stream/route.ts` | Activity/comment SSE |
| `src/lib/realtime-snapshot.ts` | Snapshot aggregation |
| `src/app/(dashboard)/companies/[slug]/dashboard/page.tsx` | Dashboard rendering, transcript, glow |
| `src/lib/orchestration/engine/engine.ts` | Execution engine, mc-action parsing |
| `server.js` | Tick loop, WS broadcast, gateway pre-warm |
| `ARCHITECTURE.md` | Product boundary definitions |
| `CANONICAL_ROUTES.md` | Canonical route inventory |
| `LEGACY_ROUTES.md` | Dead route cleanup map |

---

## 11. Git Status Summary

Branch `feat/mission-control-live-parity` is up to date with origin.

Working tree has unstaged modifications:
- `data/tasks.db-shm`, `data/tasks.db-wal` (SQLite WAL — runtime artifacts)
- `scripts/healthcheck_dev_service.sh`, `scripts/start_dev_service.sh` (dev scripts)
- `src/app/(dashboard)/companies/[slug]/routines/page.tsx` (routines WIP)
- `src/app/api/orchestration/companies/[slug]/agents/hire/route.ts`
- `src/components/live/RealtimeProvider.tsx`
- `src/lib/orchestration/contracts.ts`, `route-paths.ts`
- `src/middleware.ts`

Untracked: `src/app/api/orchestration/companies/[slug]/routines/`, `src/app/api/orchestration/routines/`, `src/lib/orchestration/service/routine.ts`

None of these conflict with the observability design work.

---

## 12. Commit Hash

`26eedcb6` — `feat: live mc-action detection — surface agent actions from streaming text in real-time`

---

## 13. Push Confirmation

No code changes made in this pass. Design document added as `LIVE_OBSERVABILITY_DESIGN.md`. Not pushed — awaiting review.
