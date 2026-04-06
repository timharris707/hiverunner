# Anthropic Provider Research

Written 2026-04-06 for Mission Control on `feat/mission-control-live-parity`.

## Recommendation

Recommendation: **A) CLI path only** for the current Mission Control integration.

Reasoning:

- Mission Control's real providers today are all process-wrapper or bridge-sync integrations. `claude --print --output-format stream-json` fits that architecture directly.
- `build-queue.ts` already executes Claude Code locally with `--permission-mode bypassPermissions`, so the operational dependency already exists in this repo.
- Claude Code CLI emits structured stream-json with assistant text, thinking blocks, tool calls/results, session ID, exact token usage, and exact `total_cost_usd`, which is enough to achieve an honest Tier 4 integration without introducing a new direct-HTTP runtime pattern.
- The Anthropic Messages API is viable, but it would make Mission Control itself an LLM runtime rather than an orchestrator of external runtimes. The feature gain is not strong enough to justify that architectural divergence yet.

Future option:

- Keep the Messages API as a future path if Mission Control later decides to own direct provider sessions, HTTP retries, server tools, or richer provider-specific runtime controls.

## Research Summary

### Existing Mission Control architecture

- `src/lib/orchestration/adapters/types.ts`: adapters declare provider identity, max tier, and static product truth.
- `src/lib/orchestration/adapters/codex.ts`: CLI-backed provider can honestly expose a no-op adapter when execution is bridged elsewhere.
- `src/lib/orchestration/codex-execution-bridge.ts`: execution bridge writes canonical `execution_runs` rows with `idempotency_key = buildId` and never throws.
- `src/lib/orchestration/service/provider-activation.ts`: activation depends on env readiness, external ID requirements, and model compatibility.
- `src/lib/orchestration/service/provider-switch.ts`: switch planning is generic once provider identity and activation logic are in place.
- `src/lib/orchestration/db.ts`: provider enum changes require SQLite table recreation.

### Claude Code CLI path

Sources:

- Paperclip local adapter docs: `/Users/timharris/.openclaw/workspace/projects/paperclip/docs/adapters/claude-local.md`
- Paperclip adapter execution args: `/Users/timharris/.openclaw/workspace/projects/paperclip/packages/adapters/claude-local/src/server/execute.ts`
- Paperclip Claude stdout parser: `/Users/timharris/.npm/_npx/43414d9b790239bb/node_modules/paperclipai/dist/index.js`

Observed CLI behavior from `stream-json`:

- `system/init`: model and `session_id`
- `assistant`: text blocks, thinking blocks, `tool_use` blocks
- `user`: `tool_result` blocks
- `result`: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, optional cache-creation tokens, `total_cost_usd`, subtype, errors, result text

Invocation pattern confirmed from Paperclip:

```sh
claude --print --output-format stream-json --verbose --permission-mode bypassPermissions --model <model> "<prompt>"
```

Architectural fit:

- Strong. This is a direct match for Mission Control's existing process-wrapper pattern.

### Anthropic Messages API path

Sources:

- [Messages API](https://docs.anthropic.com/en/api/messages)
- [Tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)

Observed API behavior:

- Streaming SSE events expose structured content blocks, including text/tool/thinking deltas.
- Usage includes exact token counts (`input_tokens`, `output_tokens`, cache fields).
- Cost is not returned directly in the Messages response; it must be derived from pricing.
- Stop reasons include tool use and pause-turn style control states.

Architectural fit:

- Weaker for Mission Control today. This would add a direct HTTP LLM runtime pattern that no current provider uses.

## Comparison

| Dimension | Claude Code CLI | Anthropic Messages API |
|-----------|-----------------|------------------------|
| Observability tier achievable | Tier 4 honestly today in MC; thinking is observable but no steering | Tier 4 honestly today in MC; same steering gap |
| Architectural pattern | Process wrapper, matches Codex/build-queue style | New direct HTTP runtime pattern |
| Live text streaming | Yes, via stream-json stdout | Yes, via SSE |
| Tool call / result events | Yes | Yes |
| Thinking / reasoning blocks | Yes | Yes |
| Token usage (exact) | Yes | Yes |
| Cost data | Exact (`total_cost_usd`) | Derived from pricing + exact tokens |
| Session management | CLI session ID emitted; CLI resume exists | App-managed conversation state |
| Model selection | CLI `--model` flag | Request `model` field |
| Setup complexity | Low-medium; uses existing `claude` runtime | Medium-high; new HTTP transport, auth, retries, tool loop ownership |
| Runtime dependency | Local Claude Code CLI + auth | Direct Anthropic API key |
| Run steering (pause/cancel) | Cancel by process kill only; no pause/resume | Abort request only unless MC builds more control semantics |

## Implementation Plan

1. Add `anthropic` to Mission Control's provider identity surface.
   - `src/lib/orchestration/adapters/types.ts`
   - `src/lib/orchestration/execution-provider.ts`
   - `src/lib/orchestration/service/provider-activation.ts`
   - `src/lib/orchestration/service/provider-switch.ts`

2. Add a provider adapter and execution bridge.
   - `src/lib/orchestration/adapters/anthropic.ts`
   - `src/lib/orchestration/anthropic-execution-bridge.ts`
   - `src/lib/orchestration/adapters/registry.ts`

3. Wire the existing Claude Code build path into the bridge.
   - `src/lib/build-queue.ts`
   - Switch builder Claude invocations to `--output-format stream-json --verbose`
   - Parse stdout incrementally for live events and final telemetry

4. Expand DB/provider surfaces.
   - `src/lib/orchestration/db.ts`
   - `src/app/api/orchestration/engine/runs/[runId]/events/route.ts`
   - `docs/provider-selection-contract.md`

5. Verify.
   - `npm run build`
   - Confirm `PROVIDER_PRODUCT_DESCRIPTORS` includes `anthropic`
   - Confirm activation logic reflects Claude Code CLI readiness rather than treating `ANTHROPIC_API_KEY` as the required runtime dependency
