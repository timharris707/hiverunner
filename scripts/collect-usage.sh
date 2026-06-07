#!/bin/bash
# Collect usage wrapper script

cd "$(dirname "$0")/.." || exit 1

# Run with the repo-pinned TypeScript executor.
node ./scripts/run-tsx.mjs scripts/collect-usage.ts
