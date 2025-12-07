#!/usr/bin/env bash
# RouteFluxMap Deploy - Main Update Script
# Fetches data from Tor APIs, uploads to configured storage backends
# Cron: 0 */4 * * * /path/to/deploy/scripts/update.sh >> /path/to/deploy/logs/update.log 2>&1

set -euo pipefail

# ============================================================================
# Environment Setup (Required for cron which runs with minimal PATH)
# ============================================================================
export HOME="${HOME:-/home/tor}"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/bin:$HOME/.nvm/versions/node/$(ls -1 $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/node/bin:$PATH"

# Ensure node is available (try common locations)
if ! command -v node &>/dev/null; then
    for node_path in "$HOME/.nvm/versions/node"/*/bin "$HOME/.local/bin" "/usr/local/bin"; do
        if [[ -x "$node_path/node" ]]; then
            export PATH="$node_path:$PATH"
            break
        fi
    done
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

# ============================================================================
# Lock File (prevent overlapping runs)
# ============================================================================
LOCK_FILE="$DEPLOY_DIR/logs/.update.lock"
mkdir -p "$DEPLOY_DIR/logs"

cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

if [[ -f "$LOCK_FILE" ]]; then
    LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ Another update is running (PID $LOCK_PID), skipping"
        exit 0
    fi
    # Stale lock file, remove it
    rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"

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

# Step 1: Verify dependencies
if ! command -v node &>/dev/null; then
    log "❌ Node.js not found in PATH"
    log "   PATH=$PATH"
    log "   Ensure Node.js is installed and accessible"
    exit 1
fi

if ! command -v npx &>/dev/null; then
    log "❌ npx not found in PATH"
    exit 1
fi

log "📦 Using Node.js $(node --version)"

# Step 2: Fetch all data (relay data + country data + geolocation)
log "📡 Fetching Tor network data..."
cd "$PROJECT_DIR"

if npx tsx scripts/fetch-all-data.ts; then
    log "✅ Data fetch completed"
else
    log "❌ Data fetch failed"
    exit 1
fi

# Step 3: Upload to storage backends (parallel)
if [[ "$R2_ENABLED" != "true" ]] && [[ "$DO_ENABLED" != "true" ]]; then
    log "⚠️ No storage backends enabled (R2_ENABLED=$R2_ENABLED, DO_ENABLED=$DO_ENABLED)"
    log "   Data fetched successfully but not uploaded"
    log "   Set R2_ENABLED=true and/or DO_ENABLED=true in config.env"
    exit 0
fi

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

