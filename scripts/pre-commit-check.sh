#!/bin/bash
# Pre-commit Security Check
# Run this before committing to ensure no sensitive data leaks

set -e

echo "🔒 HiveRunner - Pre-Commit Security Check"
echo "================================================"
echo ""

FAILED=0

# Check 1: .env.local not staged
echo "✓ Checking .env.local is not staged..."
if git diff --cached --name-only | grep -q ".env.local"; then
  echo "❌ FAIL: .env.local is staged! This contains secrets."
  FAILED=1
else
  echo "✅ PASS"
fi

# Check 2: data/*.json files not staged (except .example)
echo ""
echo "✓ Checking data files are not staged..."
STAGED_DATA=$(git diff --cached --name-only | grep "^data/.*\.json$" | grep -v ".example.json" || true)
if [ -n "$STAGED_DATA" ]; then
  echo "❌ FAIL: Operational data files are staged:"
  echo "$STAGED_DATA"
  FAILED=1
else
  echo "✅ PASS"
fi

# Check 3: data/*.db files not staged
echo ""
echo "✓ Checking database files are not staged..."
STAGED_DB=$(git diff --cached --name-only | grep "^data/.*\.db$\|^data/.*\.sqlite" || true)
if [ -n "$STAGED_DB" ]; then
  echo "❌ FAIL: Database files are staged:"
  echo "$STAGED_DB"
  FAILED=1
else
  echo "✅ PASS"
fi

# Check 4: No hardcoded emails in staged files
echo ""
echo "✓ Checking for hardcoded email addresses..."
HARDCODED_EMAILS=$(git diff --cached | grep -E "^+" | grep -oE "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" | grep -v "example.com\|localhost\|openclaw.ai" || true)
if [ -n "$HARDCODED_EMAILS" ]; then
  echo "⚠️  WARNING: Found email addresses in staged changes:"
  echo "$HARDCODED_EMAILS"
  echo "   Make sure these are intentional and not personal data."
fi

# Check 5: No hardcoded passwords/secrets in staged files
echo ""
echo "✓ Checking for potential secrets in staged files..."
POTENTIAL_SECRETS=$(git diff --cached | grep -E "^+" | grep -iE "password.*=|secret.*=|api[_-]?key.*=|token.*=" | grep -v "ADMIN_PASSWORD\|AUTH_SECRET\|API_KEY\|placeholder\|example\|TODO" || true)
if [ -n "$POTENTIAL_SECRETS" ]; then
  echo "⚠️  WARNING: Found potential secrets in staged changes:"
  echo "$POTENTIAL_SECRETS"
  echo "   Review these carefully before committing."
fi

# Check 6: All .example files have corresponding real files (reminder)
echo ""
echo "✓ Checking .example files..."
for example_file in data/*.example.json; do
  real_file="${example_file%.example.json}.json"
  if [ ! -f "$real_file" ]; then
    echo "ℹ️  Note: $real_file doesn't exist yet (not an error, just FYI)"
  fi
done
echo "✅ All .example files accounted for"

echo ""
echo "================================================"

if [ $FAILED -eq 1 ]; then
  echo "❌ SECURITY CHECK FAILED"
  echo ""
  echo "Fix the issues above before committing."
  echo "To unstage sensitive files:"
  echo "  git reset HEAD <file>"
  exit 1
else
  echo "✅ SECURITY CHECK PASSED"
  echo ""
  echo "Safe to commit!"
  exit 0
fi
