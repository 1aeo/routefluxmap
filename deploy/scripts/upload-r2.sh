#!/usr/bin/env bash
# RouteFluxMap Deploy - Upload to Cloudflare R2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/upload-common.sh"

# Parse arguments
SOURCE_DIR_ARG=""
FORCE_BACKUP=false
case "${1:-}" in
    --list-backups|--force-backup|--help|-h) ;;
    *) SOURCE_DIR_ARG="${1:-}" ;;
esac

setup_common_vars
STORAGE_NAME="R2"

# R2 configuration
R2_BUCKET_NAME="${R2_BUCKET:?R2_BUCKET must be set in config.env}"
BUCKET="r2-rfm:${R2_BUCKET_NAME}"

LOCAL_BACKUP_MARKER="$LOG_DIR/last-local-backup-date"
R2_BACKUP_MARKER="$LOG_DIR/last-r2-backup-date"
DAILY_R2_BACKUP="${DAILY_R2_BACKUP:-true}"

ensure_r2_remote() {
    local r2_key="${R2_ACCESS_KEY_ID:-}"
    local r2_secret="${R2_SECRET_ACCESS_KEY:-}"
    local cf_account="${CLOUDFLARE_ACCOUNT_ID:-}"
    
    if [[ -z "$r2_key" ]] || [[ -z "$r2_secret" ]]; then
        echo "❌ Error: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set in config.env"
        exit 1
    fi
    
    ensure_rclone
    
    if ! $RCLONE listremotes 2>/dev/null | grep -q "^r2-rfm:$"; then
        log "📦 Configuring rclone 'r2-rfm' remote..."
        $RCLONE config create r2-rfm s3 \
            provider=Cloudflare \
            access_key_id="$r2_key" \
            secret_access_key="$r2_secret" \
            endpoint="https://${cf_account}.r2.cloudflarestorage.com" \
            acl=private \
            no_check_bucket=true \
            --non-interactive
        log "   ✅ Remote 'r2-rfm' configured"
    fi
}

# Handle arguments
case "${1:-}" in
    --list-backups)
        ensure_r2_remote
        list_backups "$BUCKET" "$LOCAL_BACKUP_MARKER" "$R2_BACKUP_MARKER" "R2"
        exit 0
        ;;
    --force-backup)
        FORCE_BACKUP=true
        SOURCE_DIR_ARG="${2:-}"
        setup_common_vars
        ;;
    --help|-h)
        print_help "$0" "R2"
        exit 0
        ;;
esac

[[ ! -d "$SOURCE_DIR" ]] && { echo "❌ Error: Source directory not found: $SOURCE_DIR"; exit 1; }

ensure_r2_remote

log "☁️  Cloudflare R2 Upload"
log "   Bucket: $R2_BUCKET_NAME"
log "   Parallel: $TRANSFERS transfers, $CHECKERS checkers"

create_local_backup "$BUCKET" "$LOCAL_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_LOCAL_BACKUP" || true
create_remote_backup "$BUCKET" "$R2_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_R2_BACKUP" || true
upload_content "$BUCKET"
print_sync_summary

