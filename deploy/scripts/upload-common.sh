#!/usr/bin/env bash
# RouteFluxMap Deploy - Common Upload Functions
# Shared functions for R2 and DO Spaces upload scripts

# --- Logging ---

STORAGE_NAME=""
SKIP_LOCAL_BACKUP="${SKIP_LOCAL_BACKUP:-false}"
_LOCAL_BACKUP_STAGING=""
_LOCAL_BACKUP_LOCK_OPEN=false

log() {
    if [[ -n "$STORAGE_NAME" ]]; then
        echo "[$(date '+%H:%M:%S')] [$STORAGE_NAME] $1"
    else
        echo "[$(date '+%H:%M:%S')] $1"
    fi
}

cleanup_local_backup_staging() {
    if [[ -n "${_LOCAL_BACKUP_STAGING:-}" && -d "$_LOCAL_BACKUP_STAGING" ]]; then
        rm -rf -- "$_LOCAL_BACKUP_STAGING" 2>/dev/null || true
    fi
    _LOCAL_BACKUP_STAGING=""
    if [[ "${_LOCAL_BACKUP_LOCK_OPEN:-false}" == "true" ]]; then
        exec 7>&- 2>/dev/null || true
        _LOCAL_BACKUP_LOCK_OPEN=false
    fi
}

# --- Configuration ---

setup_common_vars() {
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
    DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
    PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

    if [[ -f "$DEPLOY_DIR/config.env" ]]; then
        # shellcheck source=/dev/null
        source "$DEPLOY_DIR/config.env"
    fi

    SOURCE_DIR="${SOURCE_DIR_ARG:-${OUTPUT_DIR:-$PROJECT_DIR/public/data}}"
    LOCAL_BACKUP_DIR="${BACKUP_DIR:-$HOME/routefluxmap-backups}"
    RCLONE="${RCLONE_PATH:-$HOME/bin/rclone}"
    TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
    TODAY=$(date '+%Y-%m-%d')

    LOG_DIR="$DEPLOY_DIR/logs"
    mkdir -p "$LOG_DIR"

    LOCAL_BACKUP_MARKER="${LOCAL_BACKUP_MARKER:-$LOG_DIR/last-local-backup-date}"
    LOCAL_BACKUP_LOCK_FILE="${LOCAL_BACKUP_LOCK_FILE:-$LOG_DIR/.local-backup.lock}"
    SKIP_LOCAL_BACKUP="${SKIP_LOCAL_BACKUP:-false}"

    # Rclone settings (can be overridden per-backend)
    TRANSFERS="${RCLONE_TRANSFERS:-64}"
    CHECKERS="${RCLONE_CHECKERS:-128}"

    DAILY_LOCAL_BACKUP="${DAILY_LOCAL_BACKUP:-true}"
}

build_rclone_opts() {
    RCLONE_OPTS=(
        "--transfers=$TRANSFERS"
        "--checkers=$CHECKERS"
        "--fast-list"
        "--stats=10s"
        "--stats-one-line"
        "--log-level=NOTICE"
        "--retries=5"
        "--retries-sleep=2s"
    )
}

run_rclone_logged() {
    local status=0
    "$RCLONE" "$@" 2>&1 | while IFS= read -r line; do log "   $line"; done || status=${PIPESTATUS[0]}
    return "$status"
}

write_marker_file() {
    local marker_file="$1"
    local value="$2"
    local marker_dir tmp_file

    marker_dir=$(dirname "$marker_file")
    mkdir -p "$marker_dir"
    tmp_file="${marker_file}.tmp.$$"
    if ! printf '%s\n' "$value" > "$tmp_file" || ! mv -f -- "$tmp_file" "$marker_file"; then
        rm -f -- "$tmp_file"
        log "   ❌ Failed to write marker file: $marker_file"
        return 1
    fi
}

# --- Backup Functions ---

backup_needed() {
    local marker_file="$1"
    local daily_setting="$2"
    local force_flag="${3:-false}"

    [[ "$force_flag" == "true" ]] && return 0
    [[ "$daily_setting" != "true" ]] && return 0

    if [[ -f "$marker_file" ]]; then
        [[ "$(cat "$marker_file" 2>/dev/null)" == "$TODAY" ]] && return 1
    fi
    return 0
}

_release_local_backup_lock() {
    if [[ "${_LOCAL_BACKUP_LOCK_OPEN:-false}" == "true" ]]; then
        exec 7>&- 2>/dev/null || true
        _LOCAL_BACKUP_LOCK_OPEN=false
    fi
}

create_local_backup() {
    local bucket="$1"
    local marker_file="${2:-$LOCAL_BACKUP_MARKER}"
    local force_flag="${3:-false}"
    local daily_setting="${4:-true}"
    local staging_dir final_dir status=0

    if [[ "${SKIP_LOCAL_BACKUP:-false}" == "true" && "$force_flag" != "true" ]]; then
        log "⏭️  Skipping local backup (disabled for this run)"
        return 1
    fi

    if ! backup_needed "$marker_file" "$daily_setting" "$force_flag"; then
        log "⏭️  Skipping local backup (already done today)"
        return 1
    fi

    if command -v flock >/dev/null 2>&1; then
        mkdir -p "$(dirname "$LOCAL_BACKUP_LOCK_FILE")"
        exec 7>"$LOCAL_BACKUP_LOCK_FILE"
        _LOCAL_BACKUP_LOCK_OPEN=true
        if ! flock -n 7; then
            _release_local_backup_lock
            log "⏭️  Skipping local backup (another local backup is already in progress)"
            return 1
        fi
        # Re-check after acquiring the lock in case a concurrent run just completed.
        if ! backup_needed "$marker_file" "$daily_setting" "$force_flag"; then
            _release_local_backup_lock
            log "⏭️  Skipping local backup (already done today)"
            return 1
        fi
    fi

    build_rclone_opts
    mkdir -p "$LOCAL_BACKUP_DIR"
    staging_dir="$LOCAL_BACKUP_DIR/.tmp-backup-${TIMESTAMP}-$$"
    final_dir="$LOCAL_BACKUP_DIR/backup-${TIMESTAMP}"
    if [[ -e "$final_dir" ]]; then
        final_dir="$LOCAL_BACKUP_DIR/backup-${TIMESTAMP}-$$"
    fi

    rm -rf -- "$staging_dir"
    mkdir -p "$staging_dir"
    _LOCAL_BACKUP_STAGING="$staging_dir"

    log "📦 Creating local backup..."
    log "   Target: $final_dir"
    run_rclone_logged sync "$bucket" "$staging_dir" --exclude "_backups/**" "${RCLONE_OPTS[@]}" || status=$?
    if [[ "$status" -ne 0 ]]; then
        rm -rf -- "$staging_dir"
        _LOCAL_BACKUP_STAGING=""
        _release_local_backup_lock
        log "   ❌ Local backup failed (rclone exit $status); today's backup is not marked done"
        return "$status"
    fi

    if ! mv -- "$staging_dir" "$final_dir"; then
        rm -rf -- "$staging_dir"
        _LOCAL_BACKUP_STAGING=""
        _release_local_backup_lock
        log "   ❌ Failed to finalize local backup: $final_dir"
        return 1
    fi
    _LOCAL_BACKUP_STAGING=""

    if ! write_marker_file "$marker_file" "$TODAY"; then
        _release_local_backup_lock
        return 1
    fi

    _release_local_backup_lock
    log "   ✅ Local backup created"
    return 0
}

create_remote_backup() {
    local bucket="$1"
    local marker_file="$2"
    local force_flag="${3:-false}"
    local daily_setting="${4:-true}"
    local status=0

    build_rclone_opts

    if backup_needed "$marker_file" "$daily_setting" "$force_flag"; then
        log "📦 Creating remote backup..."
        log "   Target: $bucket/_backups/$TIMESTAMP"
        run_rclone_logged sync "$bucket" "$bucket/_backups/$TIMESTAMP" --exclude "_backups/**" "${RCLONE_OPTS[@]}" || status=$?
        if [[ "$status" -ne 0 ]]; then
            log "   ❌ Remote backup failed (rclone exit $status); today's backup is not marked done"
            return "$status"
        fi
        write_marker_file "$marker_file" "$TODAY" || return 1
        log "   ✅ Remote backup created"
        return 0
    else
        log "⏭️  Skipping remote backup (already done today)"
        return 1
    fi
}

upload_content() {
    local bucket="$1"
    local start_time duration status=0

    build_rclone_opts

    log "🚀 Uploading content..."
    log "   Source: $SOURCE_DIR"
    log "   Target: $bucket"

    start_time=$(date +%s)
    run_rclone_logged sync "$SOURCE_DIR" "$bucket" --exclude "_backups/**" "${RCLONE_OPTS[@]}" || status=$?
    duration=$(($(date +%s) - start_time))
    if [[ "$status" -ne 0 ]]; then
        log "   ❌ Upload failed (rclone exit $status, ${duration}s)"
        return "$status"
    fi

    log "   ✅ Upload complete (${duration}s)"
}

print_sync_summary() {
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "✅ Sync completed at $(date '+%Y-%m-%d %H:%M:%S')"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

list_backups() {
    local bucket="$1"
    local local_marker="$2"
    local remote_marker="$3"
    local storage_name="$4"
    local -a local_list=()

    echo "=== $storage_name Backup Status ==="
    echo
    echo "Local backups ($LOCAL_BACKUP_DIR):"
    if [[ -d "$LOCAL_BACKUP_DIR" ]]; then
        shopt -s nullglob
        local_list=("$LOCAL_BACKUP_DIR"/backup-*)
        shopt -u nullglob
        if (( ${#local_list[@]} > 0 )); then
            printf '%s\n' "${local_list[@]}" | sort | tail -10
        else
            echo "  (none)"
        fi
    else
        echo "  (directory not found)"
    fi
    echo
    echo "Remote backups ($bucket/_backups):"
    "$RCLONE" lsd "$bucket/_backups" 2>/dev/null | tail -10 || echo "  (none)"
    echo
    echo "Last local backup: $(cat "$local_marker" 2>/dev/null || echo 'never')"
    echo "Last remote backup: $(cat "$remote_marker" 2>/dev/null || echo 'never')"
}

print_help() {
    local script_name="$1"
    local storage_name="$2"

    echo "RouteFluxMap - Upload to $storage_name"
    echo
    echo "Usage: $script_name [options] [source_dir]"
    echo
    echo "Options:"
    echo "  --list-backups      List available backups"
    echo "  --force-backup      Force backup even if done today"
    echo "  --no-local-backup   Skip local backup for this run"
    echo "  --help, -h          Show this help"
    echo
    echo "Arguments:"
    echo "  source_dir          Override source directory (default: \$OUTPUT_DIR)"
}

ensure_rclone() {
    local rclone_path="${RCLONE:-$HOME/bin/rclone}"

    if [[ ! -x "$rclone_path" ]]; then
        log "📥 Installing rclone..."
        mkdir -p "$(dirname "$rclone_path")"
        curl -sL https://rclone.org/install.sh | sudo bash -s beta
        # Or for user-local install:
        # curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip
        # unzip rclone-current-linux-amd64.zip
        # mv rclone-*-linux-amd64/rclone "$rclone_path"
        log "   ✅ rclone installed"
    fi
}
