#!/bin/bash
# Collect usage wrapper script

cd "$(dirname "$0")/.." || exit 1

# Run with tsx (TypeScript executor)
npx tsx scripts/collect-usage.ts
