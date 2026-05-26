# Cost Tracking

HiveRunner records execution usage and cost evidence when a runtime provider
returns enough information to calculate it.

## Current Behavior

- Execution runs can store provider, model, token, duration, and cost metadata.
- Cost views summarize recorded usage by workspace, agent, task, and run where
  data is available.
- Optional runtime integrations may provide richer usage details than manual
  or configure-later agents.

## Local Expectations

Cost tracking is best-effort for local installs. Missing provider credentials,
missing CLI telemetry, or manual runtimes can result in incomplete cost rows.
That is expected and should be shown as missing evidence, not fabricated cost.

## Validation

For changes touching cost recording or display:

```bash
npx tsc --noEmit --incremental false --pretty false
npm test
git diff --check
```

Use targeted cost-recorder or execution-run tests when the change touches only
that subsystem.
