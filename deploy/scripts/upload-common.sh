#!/usr/bin/env bash
# RouteFluxMap Deploy - Common Upload Functions
# Shared functions for R2 and DO Spaces upload scripts

# --- Logging ---

STORAGE_NAME=""

log() {
    if [[ -n "$STORAGE_NAME" ]]; then
        echo "[$(date '+%H:%M:%S')] [$STORAGE_NAME] $1"
    else
        echo "[$(date '+%H:%M:%S')] $1"
    fi
}

# --- Configuration ---

setup_common_vars() {
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
    DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
    PROJECT_DIR="$(dirname "$DEPLOY_DIR")"
    
    [[ -f "$DEPLOY_DIR/config.env" ]] && source "$DEPLOY_DIR/config.env"
    
    SOURCE_DIR="${SOURCE_DIR_ARG:-${OUTPUT_DIR:-$PROJECT_DIR/public/data}}"
    LOCAL_BACKUP_DIR="${BACKUP_DIR:-$HOME/routefluxmap-backups}"
    RCLONE="${RCLONE_PATH:-$HOME/bin/rclone}"
    TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
    TODAY=$(date '+%Y-%m-%d')
    
    LOG_DIR="$DEPLOY_DIR/logs"
    mkdir -p "$LOG_DIR"
    
    # Rclone settings (can be overridden per-backend)
    TRANSFERS="${RCLONE_TRANSFERS:-64}"
    CHECKERS="${RCLONE_CHECKERS:-128}"
    
    DAILY_LOCAL_BACKUP="${DAILY_LOCAL_BACKUP:-true}"
}

build_rclone_opts() {
    echo "--transfers=$TRANSFERS --checkers=$CHECKERS --fast-list --stats=10s --stats-one-line --log-level=NOTICE --retries=5 --retries-sleep=2s"
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

create_local_backup() {
    local bucket="$1"
    local marker_file="$2"
    local force_flag="${3:-false}"
    local daily_setting="${4:-true}"
    local rclone_opts
    rclone_opts=$(build_rclone_opts)
    
    if backup_needed "$marker_file" "$daily_setting" "$force_flag"; then
        log "📦 Creating local backup..."
        log "   Target: $LOCAL_BACKUP_DIR/backup-$TIMESTAMP"
        mkdir -p "$LOCAL_BACKUP_DIR/backup-$TIMESTAMP"
        $RCLONE sync "$bucket" "$LOCAL_BACKUP_DIR/backup-$TIMESTAMP" --exclude "_backups/**" $rclone_opts 2>&1 | while read -r line; do log "   $line"; done
        echo "$TODAY" > "$marker_file"
        log "   ✅ Local backup created"
        return 0
    else
        log "⏭️  Skipping local backup (already done today)"
        return 1
    fi
}

create_remote_backup() {
    local bucket="$1"
    local marker_file="$2"
    local force_flag="${3:-false}"
    local daily_setting="${4:-true}"
    local rclone_opts
    rclone_opts=$(build_rclone_opts)
    
    if backup_needed "$marker_file" "$daily_setting" "$force_flag"; then
        log "📦 Creating remote backup..."
        log "   Target: $bucket/_backups/$TIMESTAMP"
        $RCLONE sync "$bucket" "$bucket/_backups/$TIMESTAMP" --exclude "_backups/**" $rclone_opts 2>&1 | while read -r line; do log "   $line"; done
        echo "$TODAY" > "$marker_file"
        log "   ✅ Remote backup created"
        return 0
    else
        log "⏭️  Skipping remote backup (already done today)"
        return 1
    fi
}

upload_content() {
    local bucket="$1"
    local rclone_opts
    rclone_opts=$(build_rclone_opts)
    
    log "🚀 Uploading content..."
    log "   Source: $SOURCE_DIR"
    log "   Target: $bucket"
    
    local start_time=$(date +%s)
    $RCLONE sync "$SOURCE_DIR" "$bucket" --exclude "_backups/**" $rclone_opts 2>&1 | while read -r line; do log "   $line"; done
    local duration=$(($(date +%s) - start_time))
    
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
    
    echo "=== $storage_name Backup Status ==="
    echo
    echo "Local backups ($LOCAL_BACKUP_DIR):"
    if [[ -d "$LOCAL_BACKUP_DIR" ]]; then
        ls -1d "$LOCAL_BACKUP_DIR"/backup-* 2>/dev/null | tail -10 || echo "  (none)"
    else
        echo "  (directory not found)"
    fi
    echo
    echo "Remote backups ($bucket/_backups):"
    $RCLONE lsd "$bucket/_backups" 2>/dev/null | tail -10 || echo "  (none)"
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
    echo "  --list-backups    List available backups"
    echo "  --force-backup    Force backup even if done today"
    echo "  --help, -h        Show this help"
    echo
    echo "Arguments:"
    echo "  source_dir        Override source directory (default: \$OUTPUT_DIR)"
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

