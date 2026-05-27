# HiveRunner Docs

This index is organized for people evaluating HiveRunner from a fresh GitHub
clone. Start with the operator docs first; the engineering notes are deeper
implementation records and compatibility references.

## Start Here

- [Repository README](../README.md) — what HiveRunner is, quickstart, first-run
  path, validation commands, and current boundaries.
- [Operations](OPERATIONS.md) — day-to-day local operation notes.
- [Auth modes](AUTH.md) — local-single-user versus optional Supabase auth.
- [Runtime dependencies](runtime-dependencies.md) — required, optional, and
  degraded runtime states.
- [Starter agent packs](starter-agent-packs.md) — bundled public-safe agent
  identities, avatars, and voice choices for first-run workspace setup.
- [Local-first boundary](local-first-boundary.md) — what the current public path
  supports and what it intentionally does not claim yet.

## Optional Features

- [Voice/avatar backend](voice-avatar-backend.md) — optional Pipecat/Tavus
  backend setup for users who provide their own keys/configuration.
- [Voice live-call contract](voice-live-call-contract.md) — voice route/runtime
  behavior contract.
- [Optional AI avatar generation](optional-ai-avatar-generation.md) — generated
  avatar behavior and fallbacks.
- [Avatar system](AVATAR_SYSTEM.md) — avatar UI/data model notes.
- [Model routing](MODEL-ROUTING.md) — provider/model routing notes.
- [Provider billing roadmap](provider-billing-roadmap.md) — cost/accounting
  direction.

## Architecture And Runtime References

- [Orchestration schema](orchestration-schema.md)
- [Orchestration engine decomposition](orchestration-engine-decomposition.md)
- [External runner contract](hiverunner-external-runner-contract.md)
- [HiveRunner Symphony runner](hiverunner-symphony-runner.md)
- [Two-lane runtime](two-lane-runtime.md)
- [Cost tracking](COST-TRACKING.md)
- [Model/source credential architecture](model-source-credential-architecture.md)
- [Design system standard](design-system-standard.md)
- [Theme spec](THEME_SPEC.md)
- [Company agent card reference](company-agent-card-reference.md)

## Engineering Notes And Compatibility Records

The [engineering-notes](engineering-notes/) directory contains dated audits,
investigations, signoffs, and legacy compatibility records. They are kept for
maintainers who need implementation history, but they are not required for a
first-run evaluation.

Some compatibility references intentionally mention older internal names or
legacy adapters because existing local SQLite data/import packages can still
contain those values. Those references should stay documented and scoped rather
than leak into the primary onboarding path.
