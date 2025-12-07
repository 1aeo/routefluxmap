#!/usr/bin/env bash
# RouteFluxMap Deploy - Main Update Script
# Fetches data from Tor APIs, uploads to configured storage backends
# Cron: 0 */4 * * * /path/to/deploy/scripts/update.sh >> /path/to/deploy/logs/update.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

if [[ -f "$DEPLOY_DIR/config.env" ]]; then
    source "$DEPLOY_DIR/config.env"
else
    echo "Error: config.env not found in $DEPLOY_DIR"
    echo "Copy config.env.template to config.env and configure it"
    exit 1
fi

OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/public/data}"

# Storage configuration
STORAGE_ORDER="${STORAGE_ORDER:-r2,do}"
R2_ENABLED="${R2_ENABLED:-true}"
DO_ENABLED="${DO_ENABLED:-false}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "════════════════════════════════════════════════════════════════"
log "  RouteFluxMap Data Update"
log "════════════════════════════════════════════════════════════════"
log ""
log "  Storage order: $STORAGE_ORDER"
log "  Output dir:    $OUTPUT_DIR"
log ""

# Step 1: Fetch all data (relay data + country data + geolocation)
log "📡 Fetching Tor network data..."
cd "$PROJECT_DIR"

if npx tsx scripts/fetch-all-data.ts; then
    log "✅ Data fetch completed"
else
    log "❌ Data fetch failed"
    exit 1
fi

# Step 2: Upload to storage backends (parallel)
R2_PID=""
DO_PID=""

UPLOAD_START=$(date +%s)

if [[ "$R2_ENABLED" == "true" ]]; then
    log "🚀 Starting R2 upload..."
    stdbuf -oL "$SCRIPT_DIR/upload-r2.sh" "$OUTPUT_DIR" &
    R2_PID=$!
fi

if [[ "$DO_ENABLED" == "true" ]]; then
    log "🚀 Starting DO Spaces upload..."
    stdbuf -oL "$SCRIPT_DIR/upload-do.sh" "$OUTPUT_DIR" &
    DO_PID=$!
fi

# Wait for uploads to complete
UPLOAD_SUCCESS=false

if [[ -n "$R2_PID" ]]; then
    R2_EXIT=0
    wait "$R2_PID" || R2_EXIT=$?
    R2_DURATION=$(($(date +%s) - UPLOAD_START))
    R2_TIME=$(printf '%dm%02ds' $((R2_DURATION/60)) $((R2_DURATION%60)))
    if [[ "$R2_EXIT" == "0" ]]; then
        log "✅ R2 upload completed ($R2_TIME)"
        UPLOAD_SUCCESS=true
    else
        log "⚠️ R2 upload failed (exit $R2_EXIT, $R2_TIME)"
    fi
fi

if [[ -n "$DO_PID" ]]; then
    DO_EXIT=0
    wait "$DO_PID" || DO_EXIT=$?
    DO_DURATION=$(($(date +%s) - UPLOAD_START))
    DO_TIME=$(printf '%dm%02ds' $((DO_DURATION/60)) $((DO_DURATION%60)))
    if [[ "$DO_EXIT" == "0" ]]; then
        log "✅ DO Spaces upload completed ($DO_TIME)"
        UPLOAD_SUCCESS=true
    else
        log "⚠️ DO Spaces upload failed (exit $DO_EXIT, $DO_TIME)"
    fi
fi

# Check if at least one upload succeeded
if [[ "$UPLOAD_SUCCESS" == "true" ]]; then
    log "✅ Storage uploads completed"
else
    log "❌ All uploads failed"
    exit 1
fi

log ""
log "════════════════════════════════════════════════════════════════"
log "  ✅ Update complete!"
log "════════════════════════════════════════════════════════════════"

