#!/usr/bin/env bash
# RouteFluxMap - Backup Maintenance Script
# Compresses completed months into .tar.gz archives and prunes old daily backups.
#
# Usage:
#   ./backup-maintenance.sh                  # Auto: compress all completed months, prune current month
#   ./backup-maintenance.sh 12/25            # Compress December 2025 specifically
#   ./backup-maintenance.sh 01/26            # Compress January 2026 specifically
#   ./backup-maintenance.sh --dry-run        # Show what would be done without doing it
#   ./backup-maintenance.sh --dry-run 12/25  # Dry-run for a specific month
#
# Cron (1st of each month at 3am):
#   0 3 1 * * /path/to/deploy/scripts/backup-maintenance.sh >> /path/to/deploy/logs/backup-maintenance.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

[[ -f "$DEPLOY_DIR/config.env" ]] && source "$DEPLOY_DIR/config.env"

BACKUP_DIR="${BACKUP_DIR:-$HOME/routefluxmap-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-7}"
LOG_DIR="$DEPLOY_DIR/logs"
mkdir -p "$LOG_DIR"

DRY_RUN=false
TARGET_MONTH=""

# ============================================================================
# Parse Arguments
# ============================================================================
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --help|-h)
            echo "RouteFluxMap Backup Maintenance"
            echo ""
            echo "Compresses completed months into .tar.gz archives and enforces"
            echo "KEEP_BACKUPS=$KEEP_BACKUPS retention for the current month."
            echo ""
            echo "Usage: $0 [options] [MM/YY]"
            echo ""
            echo "Arguments:"
            echo "  MM/YY            Target a specific month (e.g. 12/25 for Dec 2025)"
            echo "                   Without this, processes all completed months automatically"
            echo ""
            echo "Options:"
            echo "  --dry-run        Show what would be done without making changes"
            echo "  --help, -h       Show this help"
            echo ""
            echo "What it does:"
            echo "  1. For each completed month with daily backups:"
            echo "     - Keeps the LAST daily backup of that month"
            echo "     - Compresses it into backup-YYYY-MM.tar.gz"
            echo "     - Removes all uncompressed daily backups for that month"
            echo "  2. For the current month:"
            echo "     - Keeps the most recent $KEEP_BACKUPS daily backups"
            echo "     - Removes older ones"
            echo ""
            echo "Config (from config.env):"
            echo "  KEEP_BACKUPS=$KEEP_BACKUPS"
            echo "  BACKUP_DIR=$BACKUP_DIR"
            exit 0
            ;;
        *)
            if [[ "$arg" =~ ^[0-9]{1,2}/[0-9]{2}$ ]]; then
                TARGET_MONTH="$arg"
            else
                echo "Unknown argument: $arg"
                echo "Use --help for usage"
                exit 1
            fi
            ;;
    esac
done

# ============================================================================
# Logging
# ============================================================================
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

dry() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] $1"
    fi
}

# ============================================================================
# Compress a single month
# ============================================================================
compress_month() {
    local year_full="$1"  # e.g. 2025
    local month="$2"      # e.g. 12

    local month_prefix="backup-${year_full}-${month}-"
    local archive_name="backup-${year_full}-${month}.tar.gz"
    local archive_path="$BACKUP_DIR/$archive_name"

    # Find all daily backups for this month
    local -a month_backups=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && month_backups+=("$dir")
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${month_prefix}*" | sort)

    if [[ ${#month_backups[@]} -eq 0 ]]; then
        log "   No daily backups found for ${year_full}-${month}"
        return 0
    fi

    log "   Found ${#month_backups[@]} daily backup(s) for ${year_full}-${month}"

    # If archive already exists, just clean up any remaining uncompressed dirs
    if [[ -f "$archive_path" ]]; then
        log "   Archive already exists: $archive_name"
        if [[ ${#month_backups[@]} -gt 0 ]]; then
            local freed=0
            for dir in "${month_backups[@]}"; do
                local dir_size
                dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
                freed=$((freed + dir_size))
                if [[ "$DRY_RUN" == "true" ]]; then
                    dry "Would remove $(basename "$dir") (${dir_size}M)"
                else
                    rm -rf "$dir"
                    log "   🗑️  Removed $(basename "$dir") (${dir_size}M)"
                fi
            done
            log "   Freed ~${freed}M from leftover uncompressed backups"
        fi
        return 0
    fi

    # Pick the last (most recent) backup of the month to archive
    local last_backup="${month_backups[-1]}"
    local last_name
    last_name=$(basename "$last_backup")

    local total_size
    total_size=$(du -sh "$last_backup" 2>/dev/null | cut -f1)
    log "   📦 Compressing $last_name ($total_size) → $archive_name"

    if [[ "$DRY_RUN" == "true" ]]; then
        dry "Would compress $last_name → $archive_name"
        dry "Would remove ${#month_backups[@]} daily backup dirs"
        # Estimate freed space
        local est_freed=0
        for dir in "${month_backups[@]}"; do
            local s
            s=$(du -sm "$dir" 2>/dev/null | cut -f1)
            est_freed=$((est_freed + s))
        done
        dry "Estimated space freed: ~${est_freed}M (minus archive size)"
        return 0
    fi

    # Compress the last backup of the month
    local start_time
    start_time=$(date +%s)

    # Use gzip compression with tar, relative paths inside archive
    if tar -czf "$archive_path" -C "$BACKUP_DIR" "$last_name"; then
        local duration=$(( $(date +%s) - start_time ))
        local archive_size
        archive_size=$(du -sh "$archive_path" 2>/dev/null | cut -f1)
        log "   ✅ Archive created: $archive_name ($archive_size) in ${duration}s"

        # Remove ALL daily backups for this month
        local freed=0
        for dir in "${month_backups[@]}"; do
            local dir_size
            dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
            freed=$((freed + dir_size))
            rm -rf "$dir"
        done
        log "   🗑️  Removed ${#month_backups[@]} daily backups (freed ~${freed}M)"
    else
        log "   ❌ Compression failed! Leaving backups intact."
        rm -f "$archive_path"
        return 1
    fi
}

# ============================================================================
# Prune current month's backups (keep last N)
# ============================================================================
prune_current_month() {
    local year_full month
    year_full=$(date '+%Y')
    month=$(date '+%m')

    local month_prefix="backup-${year_full}-${month}-"
    local -a month_backups=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && month_backups+=("$dir")
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${month_prefix}*" | sort)

    local count=${#month_backups[@]}
    if [[ $count -le $KEEP_BACKUPS ]]; then
        log "   Current month (${year_full}-${month}): ${count} backups, keeping all (≤ $KEEP_BACKUPS)"
        return 0
    fi

    local to_remove=$((count - KEEP_BACKUPS))
    log "   Current month (${year_full}-${month}): ${count} backups, pruning ${to_remove} (keeping $KEEP_BACKUPS)"

    local freed=0
    for ((i=0; i<to_remove; i++)); do
        local dir="${month_backups[$i]}"
        local dir_size
        dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
        freed=$((freed + dir_size))
        if [[ "$DRY_RUN" == "true" ]]; then
            dry "Would remove $(basename "$dir") (${dir_size}M)"
        else
            rm -rf "$dir"
            log "   🗑️  Removed $(basename "$dir") (${dir_size}M)"
        fi
    done

    if [[ "$DRY_RUN" == "true" ]]; then
        dry "Would free ~${freed}M"
    else
        log "   Freed ~${freed}M"
    fi
}

# ============================================================================
# Main
# ============================================================================
log "════════════════════════════════════════════════════════════════"
log "  RouteFluxMap Backup Maintenance"
log "════════════════════════════════════════════════════════════════"
[[ "$DRY_RUN" == "true" ]] && log "  ⚠️  DRY RUN — no changes will be made"
log "  Backup dir:   $BACKUP_DIR"
log "  Keep backups: $KEEP_BACKUPS (current month)"
log ""

if [[ ! -d "$BACKUP_DIR" ]]; then
    log "❌ Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# Show current disk usage
BEFORE_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "📊 Current backup size: $BEFORE_SIZE"
log ""

if [[ -n "$TARGET_MONTH" ]]; then
    # Process a specific month (MM/YY format)
    MONTH_NUM=$(echo "$TARGET_MONTH" | cut -d'/' -f1)
    YEAR_SHORT=$(echo "$TARGET_MONTH" | cut -d'/' -f2)
    YEAR_FULL="20${YEAR_SHORT}"
    # Zero-pad month
    MONTH_NUM=$(printf '%02d' "$((10#$MONTH_NUM))")

    log "🎯 Processing specific month: ${YEAR_FULL}-${MONTH_NUM}"
    compress_month "$YEAR_FULL" "$MONTH_NUM"
else
    # Auto mode: find all months with daily backups, compress completed ones
    log "🔍 Scanning for completed months to compress..."
    CURRENT_YEAR_MONTH=$(date '+%Y-%m')

    # Get unique year-month combinations from backup directory names
    declare -A MONTHS_FOUND
    for dir in "$BACKUP_DIR"/backup-????-??-*; do
        [[ -d "$dir" ]] || continue
        local_name=$(basename "$dir")
        # Extract YYYY-MM from backup-YYYY-MM-DD_HHMMSS
        ym=$(echo "$local_name" | grep -oP 'backup-\K\d{4}-\d{2}')
        [[ -n "$ym" ]] && MONTHS_FOUND["$ym"]=1
    done

    if [[ ${#MONTHS_FOUND[@]} -eq 0 ]]; then
        log "   No daily backup directories found"
    else
        for ym in $(echo "${!MONTHS_FOUND[@]}" | tr ' ' '\n' | sort); do
            year_full="${ym:0:4}"
            month="${ym:5:2}"

            if [[ "$ym" == "$CURRENT_YEAR_MONTH" ]]; then
                log "📅 ${ym} (current month) — pruning to $KEEP_BACKUPS backups"
                prune_current_month
            else
                log "📅 ${ym} (completed) — compressing..."
                compress_month "$year_full" "$month"
            fi
            log ""
        done
    fi
fi

# Final summary
AFTER_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "════════════════════════════════════════════════════════════════"
log "  ✅ Maintenance complete"
log "  Before: $BEFORE_SIZE"
log "  After:  $AFTER_SIZE"
log "════════════════════════════════════════════════════════════════"

# Show what's in the backup directory now
log ""
log "📂 Backup directory contents:"
ls -lhd "$BACKUP_DIR"/backup-* "$BACKUP_DIR"/*.tar.gz 2>/dev/null | while read -r line; do
    log "   $line"
done
