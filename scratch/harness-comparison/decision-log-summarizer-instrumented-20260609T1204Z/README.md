# Instrumented Decision Log Summarizer

Small local benchmark utility for parsing markdown decision logs without modifying production runtime behavior.

## Extracted Fields

- Decision title from the first `#` heading, or `title` metadata if no heading exists.
- `status`, `owner`, `date`, `tags`, and optional `summary` from leading `---` metadata.
- Short summary from `summary` metadata when present, otherwise the first body paragraph.
- Warnings for malformed or unknown metadata instead of throwing.

## Instrumentation

Each parsed decision includes:

- source path when provided
- input byte and line count
- metadata field count
- warning count
- whether the summary came from metadata, body text, or no content

The multi-file report also includes file count, decision count, total input bytes, warning count, and elapsed local parse time in milliseconds.

## Usage

Run against included fixtures:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer-instrumented-20260609T1204Z/decision-log-summarizer.ts
```

Run against specific decision-log markdown files:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer-instrumented-20260609T1204Z/decision-log-summarizer.ts path/to/decision.md
```

Run focused validation:

```bash
node ./scripts/run-tsx.mjs scratch/harness-comparison/decision-log-summarizer-instrumented-20260609T1204Z/decision-log-summarizer.test.ts
```
