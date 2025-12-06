#!/bin/bash

# RouteFluxMap Data Update Script
# Usage: ./scripts/cron-update.sh
# Add to cron: 0 */4 * * * /path/to/routefluxmap/scripts/cron-update.sh >> /var/log/routefluxmap-update.log 2>&1

set -e # Exit on error

# Navigate to project root
cd "$(dirname "$0")/.."

# Load environment variables
if [ -f config.env ]; then
  source config.env
  export $(grep -v '^#' config.env | xargs)
else
  echo "Warning: config.env not found"
fi

# Ensure PNPM is in path (adjust if needed for your server environment)
export PATH="/usr/local/bin:$PATH"

echo "========================================================"
echo "Starting RouteFluxMap update at $(date)"
echo "========================================================"

# 1. Fetch and process current data
echo "Fetching latest Tor relay data..."
npx tsx scripts/fetch-tor-data.ts

# 2. Process any historical CSVs (optional, if you drop files into data/historical_csv)
if [ -d "data/historical_csv" ] && [ "$(ls -A data/historical_csv/*.csv 2>/dev/null)" ]; then
    echo "Processing historical CSV files..."
    npx tsx scripts/convert-csv-to-json.ts
fi

# 3. Upload to Object Storage
# We upload the generated JSON files from public/data
echo "Uploading data to storage..."

DATE=$(date +%Y-%m-%d)
CURRENT_FILE="public/data/relays-${DATE}.json"
INDEX_FILE="public/data/index.json"
COUNTRIES_FILE="public/data/countries.geojson"

if [ -f "$CURRENT_FILE" ]; then
    echo "Uploading current data: $CURRENT_FILE"
    npx tsx scripts/upload-to-storage.ts "$CURRENT_FILE" "current/relays-${DATE}.json" "application/json"
    
    # Also update 'latest.json' pointer if needed, or just rely on index.json
fi

if [ -f "$INDEX_FILE" ]; then
    echo "Uploading index: $INDEX_FILE"
    npx tsx scripts/upload-to-storage.ts "$INDEX_FILE" "index.json" "application/json" "public, max-age=60"
fi

if [ -f "$COUNTRIES_FILE" ]; then
    echo "Uploading countries: $COUNTRIES_FILE"
    npx tsx scripts/upload-to-storage.ts "$COUNTRIES_FILE" "countries.geojson" "application/geo+json"
fi

echo "========================================================"
echo "Update completed successfully at $(date)"
echo "========================================================"
