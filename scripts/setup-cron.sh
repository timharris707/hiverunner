#!/bin/bash
# Setup cron job for hourly usage collection

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Cron entry (runs every hour at minute 0)
CRON_ENTRY="0 * * * * cd $PROJECT_DIR && npx tsx scripts/collect-usage.ts >> /var/log/hiverunner-usage.log 2>&1"

echo "Setting up cron job for usage collection..."
echo "Schedule: Every hour at minute 0"
echo "Command: $CRON_ENTRY"
echo

# Check if entry already exists
if crontab -l 2>/dev/null | grep -F "collect-usage.ts" > /dev/null; then
  echo "⚠️  Cron job already exists. Remove it first with:"
  echo "   crontab -e"
  echo "   (delete the line containing 'collect-usage.ts')"
  exit 1
fi

# Add to crontab
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✅ Cron job added successfully"
echo
echo "To verify:"
echo "  crontab -l"
echo
echo "To view logs:"
echo "  tail -f /var/log/hiverunner-usage.log"
