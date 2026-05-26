# HiveRunner Runtime Dependencies

> Last updated: 2026-05-25

HiveRunner is local-first. A fresh clone can boot, create a workspace, create a
starter team, and use manual/local flows without any paid provider key or
autonomous runtime CLI.

Runtime dependencies are opt-in. Install or configure them only when you want
HiveRunner to hand work to that runtime.

## Dependency Classes

| Dependency | Class | Required For Boot? | What Missing Means |
|---|---|---:|---|
| HiveRunner local app | Core local boot | Yes | The app cannot run without Node/npm and local SQLite data. |
| Codex CLI | Optional runtime | No | Codex-backed autonomous agent runs are unavailable. |
| Claude Code CLI | Optional runtime | No | Claude-backed autonomous agent runs are unavailable. |
| Gemini CLI | Optional runtime | No | Gemini-backed autonomous agent runs are unavailable. |
| Gemini/Google API key | Optional provider key | No | Gemini Live voice and direct Google model-source routes are unavailable. |
| OpenAI API key | Optional provider key | No | Direct OpenAI model-source routes and optional AI avatar generation are unavailable. |
| Anthropic API key | Optional provider key | No | Direct Anthropic model-source routes are unavailable. Claude Code CLI auth is separate. |
| OpenRouter API key | Optional provider key | No | Broker model-source routes are unavailable. |
| HERMES CLI | Optional runtime | No | HERMES-backed local execution is unavailable. |
| OpenClaw CLI | Optional legacy/local runtime | No | OpenClaw-backed legacy/local workflows are unavailable. |
| External runner / Symphony command | Optional runtime | No | External-runner execution is unavailable unless configured. |

## Where To Check Readiness

- `/HIVE/runtime-inventory` shows local runtime dependency readiness.
- `/HIVE/hives` shows runtime and model-source readiness in the execution hive
  setup flow.
- Model-source credential modals distinguish runtime CLI auth from direct
  provider API keys.
- The runtimes API returns `runtimeDependencies` alongside detected local CLIs
  and attached agent runtime bindings.

## Operator Rules

1. Treat missing optional CLIs as expected until you need that runtime.
2. Treat missing provider keys as expected until you enable direct model-source,
   avatar, or voice features.
3. Do not install tools automatically from HiveRunner. Install and sign in to
   CLIs deliberately on the operator machine.
4. Keep runtime auth separate from direct provider keys. For example, Claude
   Code CLI login is separate from `ANTHROPIC_API_KEY`.
5. Confirm readiness from the runtime inventory before assigning autonomous work
   to a runtime-backed agent.

## Environment Variables

Common optional provider-key variables:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
CLAUDE_API_KEY=
GEMINI_API_KEY=
GOOGLE_API_KEY=
GOOGLE_AI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
OPENROUTER_API_KEY=
OLLAMA_HOST=
VLLM_BASE_URL=
VLLM_API_KEY=
```

Common optional external-runner variables:

```env
SYMPHONY_EXEC_COMMAND=
SYMPHONY_EXEC_ARGS=
HIVERUNNER_SYMPHONY_CODEX_COMMAND=
HIVERUNNER_SYMPHONY_CODEX_ARGS=
```

## M5 Status

M5 is addressed for share-readiness when a new operator can tell that missing
Codex, Claude, Gemini, HERMES, OpenClaw, external-runner commands, and provider
keys are optional/degraded states rather than local boot failures.

Remaining future work: a guided runtime setup wizard could install-check and
link directly to provider docs, but HiveRunner should not auto-install or
auto-enroll paid provider accounts.
