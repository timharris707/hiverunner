# Decision Log Summarizer

Local benchmark utility for parsing markdown decision logs without changing production runtime behavior.

## What It Extracts

- Decision title from the first `#` heading.
- `status`, `owner`, `date`, `tags`, and optional `summary` from leading `---` metadata.
- A short summary from metadata when present, otherwise the first body paragraph.
- Warnings for malformed metadata lines instead of throwing.

## Usage

Run against the included fixtures:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer/decision-log-summarizer.ts
```

Run against specific decision-log markdown files:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer/decision-log-summarizer.ts path/to/decision.md
```

Run focused validation:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer/decision-log-summarizer.test.ts
```
