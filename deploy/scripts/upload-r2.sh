#!/usr/bin/env bash
# RouteFluxMap Deploy - Upload to Cloudflare R2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./upload-common.sh
source "$SCRIPT_DIR/upload-common.sh"

# Parse arguments
ACTION=""
# shellcheck disable=SC2034
SOURCE_DIR_ARG=""
FORCE_BACKUP=false
CLI_SKIP_LOCAL_BACKUP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --list-backups)
            ACTION="list"
            shift
            ;;
        --force-backup)
            FORCE_BACKUP=true
            shift
            ;;
        --no-local-backup)
            CLI_SKIP_LOCAL_BACKUP=true
            shift
            ;;
        --help|-h)
            print_help "$0" "R2"
            exit 0
            ;;
        --)
            shift
            if [[ $# -gt 0 ]]; then
                SOURCE_DIR_ARG="$1"
                shift
            fi
            break
            ;;
        -*)
            echo "❌ Error: Unknown option: $1" >&2
            exit 2
            ;;
        *)
            # shellcheck disable=SC2034
            SOURCE_DIR_ARG="$1"
            shift
            ;;
    esac
done

_r2_local_backup_reported=false
report_r2_local_backup_result() {
    local outcome="$1" tmp_file
    [[ -n "${ROUTEFLUXMAP_LOCAL_BACKUP_RESULT_FILE:-}" ]] || return 0
    tmp_file="${ROUTEFLUXMAP_LOCAL_BACKUP_RESULT_FILE}.tmp.$$"
    mkdir -p "$(dirname "$ROUTEFLUXMAP_LOCAL_BACKUP_RESULT_FILE")" 2>/dev/null || return 0
    if printf '%s\n' "$outcome" > "$tmp_file" 2>/dev/null && mv -f -- "$tmp_file" "$ROUTEFLUXMAP_LOCAL_BACKUP_RESULT_FILE" 2>/dev/null; then
        _r2_local_backup_reported=true
    else
        rm -f -- "$tmp_file" 2>/dev/null || true
    fi
    return 0
}

cleanup_r2_exit() {
    cleanup_local_backup_staging
    if [[ "${_r2_local_backup_reported:-false}" != "true" ]]; then
        report_r2_local_backup_result failed || true
    fi
}

trap cleanup_r2_exit EXIT
setup_common_vars
# shellcheck disable=SC2034
STORAGE_NAME="R2"
if [[ "$CLI_SKIP_LOCAL_BACKUP" == "true" ]]; then
    # shellcheck disable=SC2034
    SKIP_LOCAL_BACKUP=true
fi

# R2 configuration
R2_BUCKET_NAME="${R2_BUCKET:?R2_BUCKET must be set in config.env}"
BUCKET="r2-rfm:${R2_BUCKET_NAME}"

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

    if ! "$RCLONE" listremotes 2>/dev/null | grep -q "^r2-rfm:$"; then
        log "📦 Configuring rclone 'r2-rfm' remote..."
        "$RCLONE" config create r2-rfm s3 \
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

if [[ "$ACTION" == "list" ]]; then
    _r2_local_backup_reported=true
    ensure_r2_remote
    list_backups "$BUCKET" "$LOCAL_BACKUP_MARKER" "$R2_BACKUP_MARKER" "R2"
    exit 0
fi

[[ ! -d "$SOURCE_DIR" ]] && { echo "❌ Error: Source directory not found: $SOURCE_DIR"; exit 1; }

ensure_r2_remote

log "☁️  Cloudflare R2 Upload"
log "   Bucket: $R2_BUCKET_NAME"
log "   Parallel: $TRANSFERS transfers, $CHECKERS checkers"

create_local_backup "$BUCKET" "$LOCAL_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_LOCAL_BACKUP" || true
case "${_LOCAL_BACKUP_OUTCOME:-failed}" in
    created|already_done) report_r2_local_backup_result "$_LOCAL_BACKUP_OUTCOME" ;;
    skipped_*) report_r2_local_backup_result skipped ;;
    *) report_r2_local_backup_result failed ;;
esac
create_remote_backup "$BUCKET" "$R2_BACKUP_MARKER" "$FORCE_BACKUP" "$DAILY_R2_BACKUP" || true
upload_content "$BUCKET"
print_sync_summary
