# Provider Billing Roadmap

Status: active build plan  
Primary pages: `/NEV/costs`, `/NEV/runtimes`, `/NEV/agents/:agentId/configuration`

## Goal

HiveRunner must answer a practical operator question before work is routed:

> If I choose this runtime/provider, who bills me and how?

The answer must distinguish:

- API key or router usage that bills per token.
- Subscription-backed CLI/OAuth usage that is included in a plan until quota or overage rules apply.
- Local/free runtimes where tokens are usage telemetry but not vendor spend.
- Unknown or hybrid providers where HiveRunner can observe execution but cannot yet prove billing.

## Product Model

The system should expose the same billing truth in three places:

1. Costs is the audit and ledger surface.
   - Route: `/NEV/costs`
   - Files:
     - `src/app/(dashboard)/companies/[slug]/costs/page.tsx`
     - `src/app/api/orchestration/companies/[slug]/costs/route.ts`
     - `src/lib/orchestration/cost-ledger.ts`
   - Purpose: historical spend, provider/biller breakdowns, billing mix, recent cost events.

2. Runtimes is the connection truth surface.
   - Route: `/NEV/runtimes`
   - Files:
     - `src/app/(dashboard)/companies/[slug]/runtimes/page.tsx`
     - `src/app/api/orchestration/companies/[slug]/runtimes/route.ts`
   - Purpose: each detected or attached runtime shows connection type, auth surface, biller, and billing model.

3. Agent Configuration is the decision surface.
   - Route: `/NEV/agents/:agentId/configuration`
   - Files:
     - `src/app/(dashboard)/companies/[slug]/agents/[agentId]/configuration/page.tsx`
     - `src/app/api/orchestration/agents/[agentId]/provider/preflight/route.ts`
     - `src/lib/orchestration/service/provider-switch.ts`
   - Purpose: before switching an agent to Anthropic, Codex, Hermes, etc., the user sees the billing consequence.

## Current Foundation

Already added:

- `provider_connection_profiles`
  - Stores provider, connection type, billing model, biller, auth surface, confidence, and source.
- `cost_events`
  - Stores request-level provider, biller, billing type, model, token counts, cost, source, and confidence.
- Company-scoped Costs API:
  - `GET /api/orchestration/companies/:slug/costs`
- Runtime execution ledger writes:
  - New runs can write durable cost events.
- Costs page tabs:
  - Overview, Budgets, Providers, Billers, Finance.

## Required UX

### Runtime Billing Badge

Every runtime row/detail should show:

- `Metered API`
- `Subscription included`
- `Subscription overage`
- `Local/free`
- `Hybrid`
- `Unknown`

The detail panel should also show:

- Biller: `anthropic`, `chatgpt`, `openai`, `openrouter`, `google`, `local`, etc.
- Connection: `OAuth`, `env API key`, `API key`, `local CLI`, `router`, `local model`.
- Auth surface: `oauth`, `env`, `api-key`, `local-config`, `none`, `unknown`.
- Confidence: `reported`, `detected`, `inferred`, `confirmed`, `unknown`.

### Provider Switch Warning

The provider switch card should show the billing profile for the selected target provider before `Apply switch` is possible.

Examples:

- Anthropic with `ANTHROPIC_API_KEY` detected:
  - Biller: Anthropic
  - Billing: Metered API
  - Copy: "Runs through Anthropic API key. Token usage is expected to create billable API spend."

- Anthropic without API key, Claude Code CLI detected:
  - Biller: Anthropic
  - Billing: Subscription included
  - Copy: "Runs through local Claude Code subscription/OAuth path. Token usage is tracked; request cost is treated as included unless overage evidence is reported."

- Codex with OpenAI OAuth:
  - Biller: ChatGPT
  - Billing: Subscription included
  - Copy: "Runs through Codex CLI/OAuth path. Usage is tracked separately from metered API spend."

- Codex with `OPENAI_API_KEY` or OpenRouter base URL:
  - Biller: OpenAI or OpenRouter
  - Billing: Metered API
  - Copy: "Runs through API credentials. Token usage is expected to create billable API spend."

### Costs Provider Profiles

The Costs page should remain the audit view but link users back to the runtime/profile where the billing classification came from.

Needed additions:

- Source column: runtime detection, env detection, user confirmation, or accounting record.
- Last verified timestamp.
- A "confirm billing profile" action in a later phase.

## Backend Roadmap

### Phase 1: Surface Existing Profile Everywhere

Status: mostly implemented.

- Reuse `GET /api/orchestration/companies/:slug/costs` provider profiles on:
  - `/NEV/runtimes`
  - `/NEV/agents/:agentId/configuration`
- Add billing badges and biller/connection rows.
- Add target-provider billing warning before switch.
- Include locally detected CLI providers in profile sync, not just attached runtimes.

### Phase 2: Make Provider Profiles Editable/Confirmable

Add API:

- `PATCH /api/orchestration/companies/:slug/provider-profiles/:profileId`

Allow user-confirmed fields:

- billing model
- biller
- auth surface
- confidence = `confirmed`
- notes/metadata

Rules:

- Confirmed profiles must not be overwritten by runtime detection.
- Detection may still update health and last-seen metadata.

Status: API and Costs-page confirmation UI implemented. Remaining work: richer notes/audit history and profile review entry points from Runtimes.

### Phase 3: Provider-Specific Detection

Add provider detectors behind `cost-ledger.ts` or a new `provider-billing-detection.ts`.

Status: first pass implemented. HiveRunner now separates local CLI/OAuth-style detection from environment API-key/router detection, records non-secret billing signals in profile metadata, and classifies ambiguous local CLI plus API-key cases as `hybrid` instead of guessing.

Codex:

- Detect `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENROUTER_API_KEY`.
- Detect local OAuth/config where safe.
- Distinguish `chatgpt subscription` from `openai metered api` from `openrouter metered router`.

Anthropic:

- Detect `ANTHROPIC_API_KEY`.
- Detect Claude Code CLI login/config without exposing secrets.
- Distinguish API key from Claude subscription path.

Gemini:

- Detect `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.
- Treat API-key path as metered unless profile is confirmed otherwise.

OpenRouter:

- Treat as metered API/router.
- Use request telemetry and manual/accounting finance events for spend posture.

Local providers:

- Mark local/free unless they call a remote provider internally.
- If hybrid, require explicit confirmation or adapter-reported billing data.

### Phase 4: Preflight Enforcement

Provider switch preflight should include billing profile output:

- `billingProfile`
- `billingWarnings`
- `requiresBillingConfirmation`

Status: implemented for provider switching. Preflight now returns current/target billing profiles, emits warning codes for metered, hybrid, and unknown billing, includes budget impact for billable or uncertain paths, and the mutation route refuses switches that require billing confirmation unless the UI sends an explicit confirmation flag.

Remaining work: richer budget-specific approval policies, such as "metered path over monthly budget requires manager approval" by role rather than the current provider-switch approval flow.

Potential guardrails:

- Metered API path over budget requires confirmation.
- Unknown/hybrid billing path requires confirmation.
- Subscription-included path can proceed but logs profile source/confidence.

### Phase 5: Account Finance Ledger

Request-level telemetry is not always the same as actual invoice truth.

Status: manual account-level finance events implemented. Costs now stores provider finance events separately from request-scoped `cost_events`, and the Finance tab can record usage charges, subscriptions, credits, adjustments, and account usage entries.

Store these as finance/account events separate from request-level `cost_events`.

Out of current scope:

- Provider invoice importers.
- Provider usage/cost API importers.
- Provider billing export ingestion.

Future option: automatic accounting integrations can add account-level finance events if they become useful. That should be treated as accounting sync/reconciliation, not as provider billing importer work.

### Phase 6: Budget Controls

Use `cost_events` plus account finance events for:

- Company monthly caps.
- Agent monthly caps.
- Project monthly caps.
- Biller-specific caps.
- Metered-only caps.
- Approval workflow before switching to a metered provider over threshold.

## Data Contract

Provider profile fields:

- `provider`: runtime/provider id.
- `displayName`: human label.
- `connectionType`: local CLI, API key, env API key, OAuth, subscription, router, local model, daemon, manual, unknown.
- `billingModel`: metered tokens, subscription included, subscription overage, credits, fixed, local free, hybrid, unknown.
- `biller`: account that charges the user.
- `authSurface`: api key, env, oauth, device login, setup token, local config, none, unknown.
- `confidence`: reported, detected, inferred, confirmed, unknown.
- `source`: runtime detection, env detection, adapter report, user confirmation, accounting record.

Cost event fields:

- `billingType`: metered API, subscription included, subscription overage, credits, fixed, local free, estimated, unknown.
- `costSource`: reported, estimated, subscription included, manual, unknown.
- `costCents`: zero for subscription-included/local-free request events unless overage is reported.

Finance event fields:

- `provider`: provider/account route associated with the finance movement.
- `biller`: entity that bills or credits the account.
- `eventType`: usage, subscription, credit, adjustment, or manual.
- `amount`: signed account movement; credits are stored negative.
- `source`: manual, estimated, or unknown.
- `periodStart`/`periodEnd`: optional billing period for subscriptions/accounting records.
- `externalId`: reserved for future external accounting sync idempotency.

## Immediate Build Order

1. Add billing profile badges to `/NEV/runtimes`.
2. Add billing profile warning to `/NEV/agents/:agentId/configuration` provider switch.
3. Add confirmed profile API and UI affordance.
4. Add provider-specific detectors for Anthropic and Codex.
5. Extend provider preflight route to return billing warnings and confirmation requirements.
6. Enforce confirmation in the provider switch UI and mutation route.
7. Add budget impact to metered/unknown switch preflight and approval payloads.
8. Add manual finance events for credits, subscriptions, adjustments, and account-level usage.
