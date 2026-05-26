# Model Source Credential Architecture

Status: draft implementation guardrail
Scope: Execution Hives, model-source routing, direct provider credentials, broker credentials

## Goal

HiveRunner needs model-source credentials for routes such as OpenRouter, OpenAI Direct, Anthropic Direct, Google Direct, self-hosted vLLM, and local model endpoints.

The product rule is simple:

- The browser can submit a credential value.
- The browser must never receive the credential value back.
- Runtime and routing UI should show only metadata: configured or missing, accepted secret names, source type, last checked time, and operational notes.
- Production storage must be server-side, encrypted, scoped, auditable, and rotatable.

## Current Local / Staging Behavior

The current implementation uses `src/lib/secrets.ts` as a local secret adapter:

- It reads environment variables first.
- It falls back to a local keychain helper.
- It writes new credentials through the local keychain helper.
- The model-source API returns only metadata, not secret values.

This is acceptable for local development and staging validation, but it is not the final production credential architecture for a hosted web application.

## Production Target

Production HiveRunner should use a managed credential store with these properties:

- Encrypt secrets at rest using a server-side KMS or equivalent.
- Scope credentials by tenant/company and, where needed, by project, runtime, or agent.
- Store metadata separately from secret values.
- Never serialize secret values into API responses.
- Audit create, replace, read-for-runtime, and delete operations.
- Support credential rotation and disabled/revoked states.
- Support least-privilege runtime access through short-lived server-side resolution.
- Prevent client-side route handlers from directly reading raw secrets.

## API Shape

The current `/api/orchestration/companies/[slug]/model-sources` API is intentionally close to the desired shape:

GET should return model-source inventory metadata:

- `id`
- `label`
- `kind`
- `status`
- `authSurface`
- `credentialSecretNames`
- `configuredSecretNames`
- `setupHint`
- `note`
- `lastCheckedAt`

POST should accept:

- `sourceId`
- one secret value or provider-specific credential payload

POST should return updated metadata only.

It should not return the stored value, a decrypted value, or any token derived from the value.

## Storage Adapter Boundary

The long-term code boundary should be:

- Model-source credential service resolves provider-specific credential names and status.
- Secret storage adapter handles actual persistence and retrieval.
- Runtime execution resolves credentials server-side only when launching a run.
- UI reads credential metadata and sends replacements, but never sees stored values.

`src/lib/secrets.ts` now exposes a `SecretStoreAdapter` boundary. The current adapter is `local-dev`; it keeps today's local behavior while making the production replacement point explicit.

Current local adapter sources:

- `environment`
- `keychain`

Future production adapter:

- `managed-secret-store`
- KMS-backed encrypted values
- tenant-scoped metadata rows
- audit events

## UI Rules

Execution Matrix and Model Source UI should:

- Show connected/missing/warning state.
- Show accepted secret names.
- Explain whether the route is runtime-managed, Hive-managed, direct provider, broker, local, or self-hosted.
- Let users replace a credential.
- Offer an explicit probe/test action when the provider supports a safe metadata-only check. Normal page load should not call provider APIs.
- Avoid making local keychain language the main product model.

## Runtime Rules

Runtime execution should:

- Receive only the credential material it needs for that run.
- Prefer short-lived scoped tokens when provider support exists.
- Record credential source metadata, not raw values, in execution runs.
- Mark failures caused by missing credentials clearly in task comments and run metadata.

## Current Provider Probes

The current probe action is explicit and server-side. It sends the configured credential only when the user clicks **Test connection** for a model source.

- OpenAI Direct: `GET /v1/models`
- Anthropic Direct: `GET /v1/models`
- Google Direct: `GET /v1beta/models`
- OpenRouter: `GET /api/v1/key`
- Ollama: `GET /api/tags` against the configured host
- vLLM: OpenAI-compatible `GET /v1/models` against the configured base URL

Probe responses are reduced to pass/warn/fail metadata, endpoint label, latency, and note. Raw credentials and provider response bodies are not returned to the browser.

## Open Follow-Ups

- Add a production `SecretStore` implementation behind `src/lib/secrets.ts` or a new orchestration-specific credential store.
- Add company-scoped credential metadata rows if/when HiveRunner becomes multi-tenant hosted software.
- Add credential delete/disable/rotate actions.
- Expand provider probes with optional model-catalog summaries once redaction rules are finalized.
- Decide whether model-source credentials are company-wide only or can be overridden by project/runtime/agent.
