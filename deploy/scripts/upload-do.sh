#!/usr/bin/env bash
# RouteFluxMap Deploy - Upload to DigitalOcean Spaces
#
# Note: DO Spaces CDN does NOT support cache invalidation/purging.
# Set DO_SPACES_CDN=true to use CDN (faster, up to 1hr stale)
# Set DO_SPACES_CDN=false to use origin (always fresh)

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
STORAGE_NAME="DO-Spaces"

# Override parallelism for DO Spaces (lower to avoid 503 rate limiting)
TRANSFERS="${DO_RCLONE_TRANSFERS:-32}"
CHECKERS="${DO_RCLONE_CHECKERS:-64}"

# DO Spaces configuration
DO_REGION="${DO_SPACES_REGION:-nyc3}"
DO_BUCKET_NAME="${DO_SPACES_BUCKET:?DO_SPACES_BUCKET must be set in config.env}"
BUCKET="spaces-rfm:${DO_BUCKET_NAME}"
DO_USE_CDN="${DO_SPACES_CDN:-false}"

LOCAL_BACKUP_MARKER="$LOG_DIR/last-do-local-backup-date"
DO_BACKUP_MARKER="$LOG_DIR/last-do-backup-date"
DAILY_DO_BACKUP="${DAILY_DO_BACKUP:-true}"

ensure_spaces_remote() {
    local do_key="${DO_SPACES_KEY:-}"
    local do_secret="${DO_SPACES_SECRET:-}"
    
    if [[ -z "$do_key" ]] || [[ -z "$do_secret" ]]; then
        echo "❌ Error: DO_SPACES_KEY and DO_SPACES_SECRET must be set in config.env"
        exit 1
    fi
    
    ensure_rclone
    
    if ! $RCLONE listremotes 2>/dev/null | grep -q "^spaces-rfm:$"; then
        log "📦 Configuring rclone 'spaces-rfm' remote..."
        $RCLONE config create spaces-rfm s3 \
            provider=DigitalOcean \
            access_key_id="$do_key" \
            secret_access_key="$do_secret" \
            endpoint="${DO_REGION}.digitaloceanspaces.com" \
            acl=public-read \
            no_check_bucket=true \
            --non-interactive
        log "   ✅ Remote 'spaces-rfm' configured"
    fi
}

# Handle arguments
case "${1:-}" in
    --list-backups)
        ensure_spaces_remote
        list_backups "$BUCKET" "$LOCAL_BACKUP_MARKER" "$DO_BACKUP_MARKER" "DO Spaces"
        exit 0
        ;;
    --force-backup)
        FORCE_BACKUP=true
        SOURCE_DIR_ARG="${2:-}"
        setup_common_vars
        ;;
    --help|-h)
        print_help "$0" "DO Spaces"
        exit 0
        ;;
esac

[[ ! -d "$SOURCE_DIR" ]] && { echo "❌ Error: Source directory not found: $SOURCE_DIR"; exit 1; }

ensure_spaces_remote

log "🌊 DigitalOcean Spaces Upload"
log "   Bucket: $DO_BUCKET_NAME ($DO_REGION)"
log "   Parallel: $TRANSFERS transfers, $CHECKERS checkers"
if [[ "$DO_USE_CDN" == "true" ]]; then
    log "   Mode: CDN (faster, may cache up to 1hr)"
else
    log "   Mode: Origin (always fresh)"
fi

create_local_backup "$BUCKET" "$LOCAL_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_LOCAL_BACKUP" || true
create_remote_backup "$BUCKET" "$DO_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_DO_BACKUP" || true
upload_content "$BUCKET"
print_sync_summary

