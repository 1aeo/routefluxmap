#!/usr/bin/env bash
# RouteFluxMap Deploy - Main Update Script
# Fetches data locally, uploads to storage backends incrementally during long runs
#
# Usage:
#   ./update.sh                          # Current day (fetch, then upload)
#   ./update.sh 24                       # Year 2024 (upload every 30 days)
#   ./update.sh 12/24                    # December 2024 (upload every 10 days)
#   ./update.sh 24 --parallel=8          # Year with 8 concurrent days
#   ./update.sh 24 --upload-interval=15  # Custom upload interval
#
# Cron (daily):
#   0 4 * * * /path/to/deploy/scripts/update.sh >> /path/to/deploy/logs/update.log 2>&1

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
# Parse Command Line Arguments
# ============================================================================
DATE_RANGE=""
PARALLEL=""
UPLOAD_INTERVAL=""
SHOW_HELP=false

for arg in "$@"; do
    case "$arg" in
        --parallel=*)
            PARALLEL="${arg#*=}"
            ;;
        --upload-interval=*)
            UPLOAD_INTERVAL="${arg#*=}"
            ;;
        --help|-h)
            SHOW_HELP=true
            ;;
        --*)
            echo "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            # Positional argument = date range
            DATE_RANGE="$arg"
            ;;
    esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
    echo "RouteFluxMap Update Script"
    echo ""
    echo "Usage: $0 [date_range] [options]"
    echo ""
    echo "Fetches Tor network data locally, uploads to storage backends incrementally."
    echo ""
    echo "Date Range (optional):"
    echo "  (none)      Current day only (default)"
    echo "  24          Entire year (2024)"
    echo "  12/24       Entire month (December 2024)"
    echo "  12/07/25    Specific day"
    echo ""
    echo "Options:"
    echo "  --parallel=N          Process N days concurrently (default: 12 for year, 8 for month)"
    echo "  --upload-interval=N   Upload to storage every N days (default: 30 for year, 10 for month, 0 for day)"
    echo "  --help, -h            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                              # Daily cron - fetch today, upload once"
    echo "  $0 24 --parallel=8              # Backfill 2024, upload every 30 days"
    echo "  $0 11/24 --upload-interval=5    # Backfill November, upload every 5 days"
    echo ""
    exit 0
fi

# ============================================================================
# Determine Run Mode and Defaults
# ============================================================================
# Detect mode from DATE_RANGE format: YY = year, MM/YY = month, MM/DD/YY = day
RUN_MODE="day"
if [[ -n "$DATE_RANGE" ]]; then
    SLASH_COUNT=$(echo "$DATE_RANGE" | tr -cd '/' | wc -c)
    if [[ "$SLASH_COUNT" -eq 0 ]]; then
        RUN_MODE="year"
    elif [[ "$SLASH_COUNT" -eq 1 ]]; then
        RUN_MODE="month"
    else
        RUN_MODE="day"
    fi
fi

# Set default upload interval based on mode
if [[ -z "$UPLOAD_INTERVAL" ]]; then
    case "$RUN_MODE" in
        year)  UPLOAD_INTERVAL=30 ;;
        month) UPLOAD_INTERVAL=10 ;;
        day)   UPLOAD_INTERVAL=0 ;;  # 0 = disabled, upload only at end
    esac
fi

# ============================================================================
# Lock File (prevent overlapping runs)
# ============================================================================
LOCK_FILE="$DEPLOY_DIR/logs/.update.lock"
mkdir -p "$DEPLOY_DIR/logs"

cleanup() {
    # Kill fetch process if still running
    if [[ -n "${FETCH_PID:-}" ]] && kill -0 "$FETCH_PID" 2>/dev/null; then
        log "⚠️ Stopping fetch process (PID $FETCH_PID)..."
        kill "$FETCH_PID" 2>/dev/null || true
    fi
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
INDEX_FILE="$OUTPUT_DIR/index.json"

# Storage configuration
R2_ENABLED="${R2_ENABLED:-true}"
DO_ENABLED="${DO_ENABLED:-false}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Get count of dates in index.json
get_date_count() {
    if [[ -f "$INDEX_FILE" ]]; then
        # Count dates array length using grep (works without jq)
        grep -o '"[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}"' "$INDEX_FILE" 2>/dev/null | wc -l || echo 0
    else
        echo 0
    fi
}

# Run storage uploads (R2 and DO in parallel)
run_uploads() {
    local label="$1"
    
    if [[ "$R2_ENABLED" != "true" ]] && [[ "$DO_ENABLED" != "true" ]]; then
        return 0
    fi
    
    log "🚀 $label..."
    local UPLOAD_START=$(date +%s)
    local R2_PID="" DO_PID=""
    
    if [[ "$R2_ENABLED" == "true" ]]; then
        "$SCRIPT_DIR/upload-r2.sh" "$OUTPUT_DIR" &
        R2_PID=$!
    fi
    
    if [[ "$DO_ENABLED" == "true" ]]; then
        "$SCRIPT_DIR/upload-do.sh" "$OUTPUT_DIR" &
        DO_PID=$!
    fi
    
    # Wait for uploads
    local SUCCESS=false
    if [[ -n "$R2_PID" ]]; then
        if wait "$R2_PID" 2>/dev/null; then
            SUCCESS=true
        fi
    fi
    if [[ -n "$DO_PID" ]]; then
        if wait "$DO_PID" 2>/dev/null; then
            SUCCESS=true
        fi
    fi
    
    local DURATION=$(($(date +%s) - UPLOAD_START))
    local TIME=$(printf '%dm%02ds' $((DURATION/60)) $((DURATION%60)))
    
    if [[ "$SUCCESS" == "true" ]]; then
        log "   ✓ Upload completed ($TIME)"
    else
        log "   ⚠ Upload failed ($TIME)"
    fi
}

# Backfill empty country files (Tor Metrics has ~3 day delay)
run_backfill() {
    log "🔄 Checking for country data to backfill..."
    if npx tsx scripts/fetch-all-data.ts --backfill-countries; then
        log "✅ Country backfill completed"
    else
        log "⚠️ Country backfill had issues (non-fatal)"
    fi
}

log "════════════════════════════════════════════════════════════════"
log "  RouteFluxMap Data Update"
log "════════════════════════════════════════════════════════════════"
log ""
log "  Mode:            $RUN_MODE"
log "  Date range:      ${DATE_RANGE:-current day}"
log "  Upload interval: ${UPLOAD_INTERVAL} days (0=end only)"
log "  Output dir:      $OUTPUT_DIR"
log "  R2 enabled:      $R2_ENABLED"
log "  DO enabled:      $DO_ENABLED"
log ""

# Step 1: Verify dependencies
if ! command -v node &>/dev/null; then
    log "❌ Node.js not found in PATH"
    exit 1
fi

log "📦 Using Node.js $(node --version)"

# Step 2: Build fetch command
cd "$PROJECT_DIR"
FETCH_OPTS=""
[[ -n "$DATE_RANGE" ]] && FETCH_OPTS="$FETCH_OPTS $DATE_RANGE"
[[ -n "$PARALLEL" ]] && FETCH_OPTS="$FETCH_OPTS --parallel=$PARALLEL"

# ============================================================================
# Step 3: Fetch with Incremental Uploads
# ============================================================================

# For year mode, run parallel processes for each quarter (4 concurrent Node.js processes)
if [[ "$RUN_MODE" == "year" ]]; then
    YEAR="20${DATE_RANGE}"
    log "🚀 PARALLEL YEAR MODE: Running 4 quarters concurrently"
    log ""
    
    INITIAL_COUNT=$(get_date_count)
    LAST_UPLOAD_COUNT=$INITIAL_COUNT
    
    # Start Q1-Q4 as parallel processes
    declare -a QUARTER_PIDS=()
    for Q in 1 2 3 4; do
        case $Q in
            1) MONTHS="01/01/${DATE_RANGE}-03/31/${DATE_RANGE}" ;;
            2) MONTHS="04/01/${DATE_RANGE}-06/30/${DATE_RANGE}" ;;
            3) MONTHS="07/01/${DATE_RANGE}-09/30/${DATE_RANGE}" ;;
            4) MONTHS="10/01/${DATE_RANGE}-12/31/${DATE_RANGE}" ;;
        esac
        
        log "   Starting Q${Q} ($MONTHS)..."
        npx tsx scripts/fetch-all-data.ts "$MONTHS" --parallel=8 &
        QUARTER_PIDS+=($!)
    done
    
    log ""
    log "   Q1 PID: ${QUARTER_PIDS[0]}"
    log "   Q2 PID: ${QUARTER_PIDS[1]}"
    log "   Q3 PID: ${QUARTER_PIDS[2]}"
    log "   Q4 PID: ${QUARTER_PIDS[3]}"
    log ""
    log "   Monitoring progress (upload every $UPLOAD_INTERVAL days)..."
    log ""
    
    # Monitor all quarters, upload periodically
    while true; do
        # Check if any quarter is still running
        RUNNING=0
        for PID in "${QUARTER_PIDS[@]}"; do
            if kill -0 "$PID" 2>/dev/null; then
                RUNNING=$((RUNNING + 1))
            fi
        done
        
        if [[ "$RUNNING" -eq 0 ]]; then
            break
        fi
        
        sleep 10
        
        CURRENT_COUNT=$(get_date_count)
        NEW_DAYS=$((CURRENT_COUNT - LAST_UPLOAD_COUNT))
        
        if [[ "$NEW_DAYS" -ge "$UPLOAD_INTERVAL" ]]; then
            log "📊 Progress: $CURRENT_COUNT dates (+$NEW_DAYS) - $RUNNING quarters still running"
            run_uploads "Incremental upload"
            LAST_UPLOAD_COUNT=$CURRENT_COUNT
        fi
    done
    
    # Check exit status of all quarters
    FAILED=0
    for i in 0 1 2 3; do
        EXIT_CODE=0
        wait "${QUARTER_PIDS[$i]}" || EXIT_CODE=$?
        if [[ "$EXIT_CODE" -ne 0 ]]; then
            log "   ⚠ Q$((i+1)) failed (exit $EXIT_CODE)"
            FAILED=$((FAILED + 1))
        else
            log "   ✓ Q$((i+1)) completed"
        fi
    done
    
    if [[ "$FAILED" -gt 0 ]]; then
        log "❌ $FAILED quarter(s) failed"
    else
        log "✅ All quarters completed successfully"
    fi
    
    run_backfill
    
    # Final upload
    FINAL_COUNT=$(get_date_count)
    TOTAL_NEW=$((FINAL_COUNT - INITIAL_COUNT))
    log "📊 Final: $FINAL_COUNT dates ($TOTAL_NEW new)"
    run_uploads "Final upload"

elif [[ "$UPLOAD_INTERVAL" -eq 0 ]]; then
    # Simple mode: fetch, then upload once at end
    log "📡 Fetching data..."
    
    if npx tsx scripts/fetch-all-data.ts $FETCH_OPTS; then
        log "✅ Data fetch completed"
    else
        log "❌ Data fetch failed"
        exit 1
    fi
    
    run_backfill
    run_uploads "Uploading to storage"
else
    # Incremental mode: fetch in background, upload periodically
    log "📡 Starting data fetch (background)..."
    
    INITIAL_COUNT=$(get_date_count)
    LAST_UPLOAD_COUNT=$INITIAL_COUNT
    
    # Start fetch in background
    npx tsx scripts/fetch-all-data.ts $FETCH_OPTS &
    FETCH_PID=$!
    
    log "   Fetch PID: $FETCH_PID"
    log "   Initial date count: $INITIAL_COUNT"
    log "   Will upload every $UPLOAD_INTERVAL new days"
    log ""
    
    # Monitor and upload periodically
    while kill -0 "$FETCH_PID" 2>/dev/null; do
        sleep 10  # Check every 10 seconds
        
        CURRENT_COUNT=$(get_date_count)
        NEW_DAYS=$((CURRENT_COUNT - LAST_UPLOAD_COUNT))
        
        if [[ "$NEW_DAYS" -ge "$UPLOAD_INTERVAL" ]]; then
            log "📊 Progress: $CURRENT_COUNT dates (+$NEW_DAYS since last upload)"
            run_uploads "Incremental upload"
            LAST_UPLOAD_COUNT=$CURRENT_COUNT
        fi
    done
    
    # Check fetch exit status
    FETCH_EXIT=0
    wait "$FETCH_PID" || FETCH_EXIT=$?
    FETCH_PID=""
    
    if [[ "$FETCH_EXIT" -eq 0 ]]; then
        log "✅ Data fetch completed"
    else
        log "❌ Data fetch failed (exit $FETCH_EXIT)"
        exit 1
    fi
    
    run_backfill
    
    # Final upload (catches any remaining files)
    FINAL_COUNT=$(get_date_count)
    TOTAL_NEW=$((FINAL_COUNT - INITIAL_COUNT))
    log "📊 Final: $FINAL_COUNT dates ($TOTAL_NEW new)"
    run_uploads "Final upload"
fi

log ""
log "════════════════════════════════════════════════════════════════"
log "  ✅ Update complete!"
log "════════════════════════════════════════════════════════════════"
