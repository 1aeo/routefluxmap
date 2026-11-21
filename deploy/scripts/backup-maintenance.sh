#!/usr/bin/env bash
# RouteFluxMap - Backup Maintenance Script
# Compresses completed months into .tar.gz archives and prunes old daily backups.
#
# Usage:
#   ./backup-maintenance.sh                  # Auto: prune current month, compress completed months
#   ./backup-maintenance.sh --prune-only     # Prune current month and stale temps only
#   ./backup-maintenance.sh 12/25            # Compress December 2025 specifically
#   ./backup-maintenance.sh 01/26            # Compress January 2026 specifically
#   ./backup-maintenance.sh --dry-run        # Show what would be done without doing it
#   ./backup-maintenance.sh --dry-run 12/25  # Dry-run for a specific month
#
# Cron (daily at 6:30am):
#   30 6 * * * flock -n /tmp/routefluxmap-backup-maintenance.lock /path/to/deploy/scripts/backup-maintenance.sh >> /path/to/deploy/logs/backup-maintenance.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

# Preserve caller environment overrides across config.env sourcing
_ENV_BACKUP_DIR="${BACKUP_DIR-}"
_ENV_KEEP_BACKUPS="${KEEP_BACKUPS-}"
_ENV_LOG_DIR="${LOG_DIR-}"
_ENV_LOCAL_BACKUP_LOCK_FILE="${LOCAL_BACKUP_LOCK_FILE-}"

if [[ -f "$DEPLOY_DIR/config.env" ]]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_DIR/config.env"
fi

[[ -n "$_ENV_BACKUP_DIR" ]] && BACKUP_DIR="$_ENV_BACKUP_DIR"
[[ -n "$_ENV_KEEP_BACKUPS" ]] && KEEP_BACKUPS="$_ENV_KEEP_BACKUPS"
[[ -n "$_ENV_LOG_DIR" ]] && LOG_DIR="$_ENV_LOG_DIR"
[[ -n "$_ENV_LOCAL_BACKUP_LOCK_FILE" ]] && LOCAL_BACKUP_LOCK_FILE="$_ENV_LOCAL_BACKUP_LOCK_FILE"

BACKUP_DIR="${BACKUP_DIR:-$HOME/routefluxmap-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-7}"
LOG_DIR="${LOG_DIR:-$DEPLOY_DIR/logs}"
LOCAL_BACKUP_LOCK_FILE="${LOCAL_BACKUP_LOCK_FILE:-$DEPLOY_DIR/logs/.local-backup.lock}"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

DRY_RUN=false
PRUNE_ONLY=false
TARGET_MONTH=""
CURRENT_TMP_ARCHIVE=""
_LOCK_OPEN=false

cleanup_on_exit() {
    if [[ -n "${CURRENT_TMP_ARCHIVE:-}" && -f "$CURRENT_TMP_ARCHIVE" ]]; then
        rm -f -- "$CURRENT_TMP_ARCHIVE" 2>/dev/null || true
    fi
    if [[ "${_LOCK_OPEN:-false}" == "true" ]]; then
        exec 8>&-
        _LOCK_OPEN=false
    fi
}
trap cleanup_on_exit EXIT

# ============================================================================
# Parse Arguments
# ============================================================================
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --prune-only) PRUNE_ONLY=true ;;
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
            echo "  --prune-only     Prune current month and stale temps; skip monthly compression"
            echo "  --dry-run        Show what would be done without making changes"
            echo "  --help, -h       Show this help"
            echo ""
            echo "What it does:"
            echo "  1. Cleans stale temp directories/archives older than 24 hours"
            echo "  2. For the current month:"
            echo "     - Keeps the most recent $KEEP_BACKUPS daily backups"
            echo "     - Removes older ones"
            echo "  3. For each completed month with daily backups (unless --prune-only):"
            echo "     - Removes earlier daily backups first to reclaim disk headroom"
            echo "     - Compresses the LAST daily backup into backup-YYYY-MM.tar.gz atomically"
            echo "     - Verifies integrity (gzip -t) before deleting the archived daily backup"
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

if [[ "$PRUNE_ONLY" == "true" && -n "$TARGET_MONTH" ]]; then
    echo "Error: --prune-only cannot be combined with target month '$TARGET_MONTH'" >&2
    exit 2
fi

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

if [[ ! "$KEEP_BACKUPS" =~ ^[1-9][0-9]*$ ]]; then
    log "❌ Invalid KEEP_BACKUPS=$KEEP_BACKUPS (must be a positive integer)" >&2
    exit 2
fi

if [[ "$DRY_RUN" != "true" ]] && command -v flock >/dev/null 2>&1; then
    LOCK_FILE="$LOG_DIR/.backup-maintenance.lock"
    _old_umask=$(umask)
    umask 077
    exec 8>"$LOCK_FILE"
    umask "$_old_umask"
    chmod 600 "$LOCK_FILE"
    _LOCK_OPEN=true
    if ! flock -n 8; then
        exec 8>&-
        _LOCK_OPEN=false
        log "⏭️  Another backup-maintenance run is already in progress, skipping"
        exit 0
    fi
fi

# ============================================================================
# Clean stale temp artifacts (>24h old)
# ============================================================================
cleanup_stale_temps() {
    local item base run_dir_cleanup=true local_lock_open=false

    # Do not delete stale .tmp-backup-* dirs while a local backup holds LOCAL_BACKUP_LOCK_FILE
    # (rclone updates files inside subdirectories, leaving top-level dir mtime stale).
    if [[ -n "${LOCAL_BACKUP_LOCK_FILE:-}" && -f "$LOCAL_BACKUP_LOCK_FILE" ]] && command -v flock >/dev/null 2>&1; then
        exec 7>"$LOCAL_BACKUP_LOCK_FILE"
        local_lock_open=true
        if ! flock -n 7; then
            exec 7>&-
            local_lock_open=false
            run_dir_cleanup=false
            log "   ⏭️  Skipping stale temp backup cleanup (local backup lock is held)"
        fi
    fi

    if [[ "$run_dir_cleanup" == "true" ]]; then
        while IFS= read -r -d '' item; do
            base=$(basename "$item")
            if [[ "$DRY_RUN" == "true" ]]; then
                dry "Would remove stale temp directory $base"
            else
                rm -rf -- "$item"
                log "   🗑️  Removed stale temp directory: $base"
            fi
        done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name '.tmp-backup-*' -mmin +1440 -print0 2>/dev/null)
    fi

    if [[ "$local_lock_open" == "true" ]]; then
        exec 7>&-
    fi

    while IFS= read -r -d '' item; do
        base=$(basename "$item")
        if [[ "$DRY_RUN" == "true" ]]; then
            dry "Would remove stale temp archive $base"
        else
            rm -f -- "$item"
            log "   🗑️  Removed stale temp archive: $base"
        fi
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup-*.tar.gz.tmp.*' -mmin +1440 -print0 2>/dev/null)
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
    local tmp_archive="${archive_path}.tmp.$$"

    # Find all daily backups for this month
    local -a month_backups=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && month_backups+=("$dir")
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${month_prefix}*" ! -name '*.tmp.*' | sort)

    if [[ ${#month_backups[@]} -eq 0 ]]; then
        log "   No daily backups found for ${year_full}-${month}"
        return 0
    fi

    log "   Found ${#month_backups[@]} daily backup(s) for ${year_full}-${month}"

    # If archive already exists, verify integrity before deleting leftover daily dirs
    if [[ -f "$archive_path" ]]; then
        if gzip -t "$archive_path" >/dev/null 2>&1; then
            log "   Archive already exists (verified): $archive_name"
            local freed=0 dir dir_size
            for dir in "${month_backups[@]}"; do
                dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
                freed=$((freed + dir_size))
                if [[ "$DRY_RUN" == "true" ]]; then
                    dry "Would remove $(basename "$dir") (${dir_size}M)"
                else
                    rm -rf -- "$dir"
                    log "   🗑️  Removed $(basename "$dir") (${dir_size}M)"
                fi
            done
            [[ "$DRY_RUN" == "true" ]] || log "   Freed ~${freed}M from leftover uncompressed backups"
            return 0
        fi

        log "   ⚠️  Existing archive is corrupt: $archive_name — will rebuild from $(basename "${month_backups[${#month_backups[@]}-1]}")"
        if [[ "$DRY_RUN" == "true" ]]; then
            dry "Would rebuild corrupt $archive_name from $(basename "${month_backups[${#month_backups[@]}-1]}")"
            dry "Would remove ${#month_backups[@]} daily backup dirs"
            return 0
        fi
    fi

    # Pick the last (most recent) backup of the month to archive
    local last_backup="${month_backups[${#month_backups[@]}-1]}"
    local last_name
    last_name=$(basename "$last_backup")

    local total_size
    total_size=$(du -sh "$last_backup" 2>/dev/null | cut -f1)
    log "   📦 Compressing $last_name ($total_size) → $archive_name"

    if [[ "$DRY_RUN" == "true" ]]; then
        if (( ${#month_backups[@]} > 1 )); then
            dry "Would remove $(( ${#month_backups[@]} - 1 )) earlier daily backup dir(s) before compression"
        fi
        dry "Would compress $last_name → $archive_name"
        dry "Would remove $last_name after gzip -t verification"
        local est_freed=0 dir s
        for dir in "${month_backups[@]}"; do
            s=$(du -sm "$dir" 2>/dev/null | cut -f1)
            est_freed=$((est_freed + s))
        done
        dry "Estimated space freed: ~${est_freed}M (minus archive size)"
        return 0
    fi

    # Free earlier completed-month backups first so compression has disk headroom
    if (( ${#month_backups[@]} > 1 )); then
        local earlier_count=$(( ${#month_backups[@]} - 1 ))
        local i dir dir_size freed_earlier=0
        for ((i=0; i<earlier_count; i++)); do
            dir="${month_backups[$i]}"
            dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
            freed_earlier=$((freed_earlier + dir_size))
            rm -rf -- "$dir"
        done
        log "   🗑️  Removed $earlier_count earlier daily backup(s) first (freed ~${freed_earlier}M)"
    fi

    # Compress the last backup of the month atomically via temp archive
    local start_time
    start_time=$(date +%s)
    CURRENT_TMP_ARCHIVE="$tmp_archive"

    if tar -czf "$tmp_archive" -C "$BACKUP_DIR" "$last_name" && gzip -t "$tmp_archive" >/dev/null 2>&1; then
        if mv -f -- "$tmp_archive" "$archive_path"; then
            CURRENT_TMP_ARCHIVE=""
            local duration=$(( $(date +%s) - start_time ))
            local archive_size last_size
            archive_size=$(du -sh "$archive_path" 2>/dev/null | cut -f1)
            last_size=$(du -sm "$last_backup" 2>/dev/null | cut -f1)
            log "   ✅ Archive created and verified: $archive_name ($archive_size) in ${duration}s"
            rm -rf -- "$last_backup"
            log "   🗑️  Removed $last_name (freed ~${last_size}M)"
            return 0
        fi
    fi

    log "   ❌ Compression or verification failed! Leaving $last_name intact."
    rm -f -- "$tmp_archive"
    CURRENT_TMP_ARCHIVE=""
    return 1
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
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${month_prefix}*" ! -name '*.tmp.*' | sort)

    local count=${#month_backups[@]}
    if [[ $count -le $KEEP_BACKUPS ]]; then
        log "   Current month (${year_full}-${month}): ${count} backups, keeping all (≤ $KEEP_BACKUPS)"
        return 0
    fi

    local to_remove=$((count - KEEP_BACKUPS))
    log "   Current month (${year_full}-${month}): ${count} backups, pruning ${to_remove} (keeping $KEEP_BACKUPS)"

    local freed=0 i dir dir_size
    for ((i=0; i<to_remove; i++)); do
        dir="${month_backups[$i]}"
        dir_size=$(du -sm "$dir" 2>/dev/null | cut -f1)
        freed=$((freed + dir_size))
        if [[ "$DRY_RUN" == "true" ]]; then
            dry "Would remove $(basename "$dir") (${dir_size}M)"
        else
            rm -rf -- "$dir"
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
[[ "$PRUNE_ONLY" == "true" ]] && log "  ℹ️  PRUNE-ONLY mode (skipping monthly compression)"
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

cleanup_stale_temps

if [[ -n "$TARGET_MONTH" ]]; then
    # Process a specific month (MM/YY format)
    MONTH_RAW=$(echo "$TARGET_MONTH" | cut -d'/' -f1)
    YEAR_SHORT=$(echo "$TARGET_MONTH" | cut -d'/' -f2)
    if (( 10#$MONTH_RAW < 1 || 10#$MONTH_RAW > 12 )); then
        log "❌ Invalid month in '$TARGET_MONTH' (expected 01-12)" >&2
        exit 2
    fi
    YEAR_FULL="20${YEAR_SHORT}"
    MONTH_NUM=$(printf '%02d' "$((10#$MONTH_RAW))")

    log "🎯 Processing specific month: ${YEAR_FULL}-${MONTH_NUM}"
    compress_month "$YEAR_FULL" "$MONTH_NUM"
else
    # Prune current month first so excess daily backups are reclaimed before
    # any completed-month compression runs.
    CURRENT_YEAR_MONTH=$(date '+%Y-%m')
    log "📅 ${CURRENT_YEAR_MONTH} (current month) — pruning to $KEEP_BACKUPS backups"
    prune_current_month
    log ""

    if [[ "$PRUNE_ONLY" != "true" ]]; then
        log "🔍 Scanning for completed months to compress..."
        months_raw=""
        for dir in "$BACKUP_DIR"/backup-????-??-*; do
            [[ -d "$dir" ]] || continue
            local_name=$(basename "$dir")
            [[ "$local_name" == *.tmp.* ]] && continue
            if [[ "$local_name" =~ ^backup-([0-9]{4}-[0-9]{2})- ]]; then
                ym="${BASH_REMATCH[1]}"
                [[ "$ym" != "$CURRENT_YEAR_MONTH" ]] && months_raw+="${ym}"$'\n'
            fi
        done

        if [[ -z "$months_raw" ]]; then
            log "   No completed months with daily backups found"
        else
            for ym in $(printf '%s' "$months_raw" | LC_ALL=C sort -u); do
                year_full="${ym:0:4}"
                month="${ym:5:2}"
                log "📅 ${ym} (completed) — compressing..."
                compress_month "$year_full" "$month"
                log ""
            done
        fi
    fi
fi

# Final summary
AFTER_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "════════════════════════════════════════════════════════════════"
log "  ✅ Maintenance complete"
log "  Before: $BEFORE_SIZE"
log "  After:  $AFTER_SIZE"
log "════════════════════════════════════════════════════════════════"

# Show what's in the backup directory now (single glob avoids duplicate .tar.gz lines)
log ""
log "📂 Backup directory contents:"
shopt -s nullglob
backup_entries=("$BACKUP_DIR"/backup-*)
shopt -u nullglob
if (( ${#backup_entries[@]} > 0 )); then
    # shellcheck disable=SC2012
    ls -lhd "${backup_entries[@]}" 2>/dev/null | while IFS= read -r line; do
        log "   $line"
    done
else
    log "   (none)"
fi
